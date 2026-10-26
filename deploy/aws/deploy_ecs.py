"""Deploy one Evolution session owner, with the same drain-first sequence for rollback."""

import argparse
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time


POLICY = {
    "minimumHealthyPercent": 0,
    "maximumPercent": 100,
    # ECS automatic rollback can start another session owner. Roll back below instead.
    "deploymentCircuitBreaker": {"enable": True, "rollback": False},
}


def log(message):
    print(datetime.datetime.now(datetime.timezone.utc).isoformat(), message, flush=True)


class AwsCli:
    def __init__(self, region):
        self.region = region

    def __call__(self, *args):
        result = subprocess.run(
            ["aws", *args, "--region", self.region, "--output", "json", "--no-cli-pager"],
            capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout) if result.stdout.strip() else {}


class Deployment:
    def __init__(self, aws, cluster, service, container, timeout=900, poll=5):
        self.aws = aws
        self.cluster = cluster
        self.name = service
        self.container = container
        self.timeout = timeout
        self.poll = poll

    def service(self):
        result = self.aws("ecs", "describe-services", "--cluster", self.cluster, "--services", self.name)
        if result.get("failures") or len(result.get("services", [])) != 1:
            raise RuntimeError("ECS service was not found")
        return result["services"][0]

    def update(self, **values):
        args = ["ecs", "update-service", "--cluster", self.cluster, "--service", self.name]
        for key, value in values.items():
            flag = "--" + key.replace("_", "-")
            if isinstance(value, bool):
                if value:
                    args.append(flag)
            else:
                args.extend([flag, json.dumps(value) if isinstance(value, dict) else str(value)])
        self.aws(*args)

    def live_tasks(self):
        refs = set()
        # Draining tasks have desiredStatus STOPPED while their process can still be alive.
        for status in ("RUNNING", "STOPPED"):
            refs.update(self.aws(
                "ecs", "list-tasks", "--cluster", self.cluster, "--service-name", self.name,
                "--desired-status", status,
            )["taskArns"])
        tasks = []
        refs = sorted(refs)
        for start in range(0, len(refs), 100):
            response = self.aws("ecs", "describe-tasks", "--cluster", self.cluster, "--tasks", *refs[start:start + 100])
            if response.get("failures"):
                raise RuntimeError("Could not verify all previous tasks")
            tasks.extend(task for task in response["tasks"] if task["lastStatus"] != "STOPPED")
        return tasks

    def wait(self, predicate, description):
        log(description)
        deadline = time.monotonic() + self.timeout
        heartbeat = time.monotonic() + 45
        while not predicate():
            if time.monotonic() >= deadline:
                raise TimeoutError(description)
            if time.monotonic() >= heartbeat:
                log("Still waiting: " + description)
                heartbeat = time.monotonic() + 45
            time.sleep(self.poll)

    def preflight(self):
        service = self.service()
        if service["status"] != "ACTIVE" or service.get("deploymentController", {}).get("type") != "ECS":
            raise RuntimeError("An active service with the ECS deployment controller is required")
        if (service["desiredCount"], service["runningCount"], service["pendingCount"]) != (1, 1, 0):
            raise RuntimeError("Start with exactly one stable replica")
        if len(service["deployments"]) != 1 or service["deployments"][0].get("rolloutState") != "COMPLETED":
            raise RuntimeError("Another deployment is in progress")
        tasks = self.live_tasks()
        if len(tasks) != 1 or tasks[0]["lastStatus"] != "RUNNING":
            raise RuntimeError("Extra or draining session owners must be stopped first")
        scaling = self.aws(
            "application-autoscaling", "describe-scalable-targets", "--service-namespace", "ecs",
            "--resource-ids", f"service/{self.cluster}/{self.name}",
            "--scalable-dimension", "ecs:service:DesiredCount",
        )
        if scaling.get("ScalableTargets"):
            raise RuntimeError("Disable service autoscaling before deploying shared WhatsApp sessions")
        return service

    def configure(self, service):
        current = service.get("deploymentConfiguration", {})
        # The ALB requires five 30-second successes. Allow startup plus that full window.
        grace = max(service.get("healthCheckGracePeriodSeconds", 0), 300)
        if (any(current.get(key) != value for key, value in POLICY.items())
                or service.get("availabilityZoneRebalancing") != "DISABLED"
                or service.get("healthCheckGracePeriodSeconds", 0) != grace):
            self.update(
                deployment_configuration=POLICY, availability_zone_rebalancing="DISABLED",
                health_check_grace_period_seconds=grace,
            )
        log("Single-replica guardrails configured without forcing a deployment")

    def idle(self, revision, stable=True):
        service = self.service()
        if service["taskDefinition"] != revision:
            raise RuntimeError("The service revision changed outside this deployment")
        return (
            (service["desiredCount"], service["runningCount"], service["pendingCount"]) == (0, 0, 0)
            and (not stable or (
                len(service["deployments"]) == 1
                and service["deployments"][0].get("rolloutState") == "COMPLETED"
            ))
            and not self.live_tasks()
        )

    def ready(self, revision):
        service = self.service()
        if service["taskDefinition"] != revision:
            raise RuntimeError("The service revision changed outside this deployment")
        if any(d.get("rolloutState") == "FAILED" for d in service["deployments"]):
            raise RuntimeError("The new deployment failed its ECS health checks")
        tasks = self.live_tasks()
        ecs_ready = (
            (service["desiredCount"], service["runningCount"], service["pendingCount"]) == (1, 1, 0)
            and len(service["deployments"]) == 1
            and service["deployments"][0].get("rolloutState") == "COMPLETED"
            and len(tasks) == 1 and tasks[0]["lastStatus"] == "RUNNING"
            and tasks[0]["taskDefinitionArn"] == revision
        )
        if not ecs_ready:
            return False
        addresses = {
            detail["value"]
            for task in tasks
            for attachment in task.get("attachments", [])
            for detail in attachment.get("details", [])
            if detail.get("name") == "privateIPv4Address"
        }
        for load_balancer in service.get("loadBalancers", []):
            health = self.aws(
                "elbv2", "describe-target-health",
                "--target-group-arn", load_balancer["targetGroupArn"],
            )
            expected_port = load_balancer.get("containerPort")
            if not any(
                item.get("Target", {}).get("Id") in addresses
                and (expected_port is None or item.get("Target", {}).get("Port") == expected_port)
                and item.get("TargetHealth", {}).get("State") == "healthy"
                for item in health.get("TargetHealthDescriptions", [])
            ):
                return False
        return True

    def replace(self, revision):
        previous = self.service()["taskDefinition"]
        self.update(desired_count=0)
        # A failed deployment can retain FAILED/ACTIVE records at zero replicas.
        # Drain all processes first; the next revision removes those stale records.
        self.wait(lambda: self.idle(previous, stable=False), "Waiting for every previous task to reach STOPPED")
        if revision != previous:
            # Never combine a revision change and scale-up in the same UpdateService call.
            self.update(task_definition=revision)
        elif any(d.get("rolloutState") == "FAILED" for d in self.service()["deployments"]):
            self.update(force_new_deployment=True)
        self.wait(lambda: self.idle(revision), "Waiting for the selected revision to stabilize at zero replicas")
        self.update(desired_count=1)
        self.wait(lambda: self.ready(revision), "Waiting for exactly one healthy task on the selected revision")

    def register(self, image, revision, cpu=None, memory=None):
        task = self.aws("ecs", "describe-task-definition", "--task-definition", revision)["taskDefinition"]
        allowed = self.aws("ecs", "register-task-definition", "--generate-cli-skeleton", "input")
        definition = copy.deepcopy({key: value for key, value in task.items() if key in allowed})
        matches = [c for c in definition["containerDefinitions"] if c["name"] == self.container]
        if len(matches) != 1:
            raise RuntimeError("The selected container was not found in the current task definition")
        changed = False
        if image is not None and matches[0]["image"] != image:
            matches[0]["image"] = image
            matches[0].get("dockerLabels", {}).pop("org.opencontainers.image.revision", None)
            changed = True
        if cpu is not None:
            size_changed = (
                task.get("cpu") != str(cpu) or task.get("memory") != str(memory)
                or matches[0].get("cpu") != int(cpu) or matches[0].get("memory") != int(memory)
            )
            definition["cpu"] = str(cpu)
            definition["memory"] = str(memory)
            matches[0]["cpu"] = int(cpu)
            matches[0]["memory"] = int(memory)
            changed |= size_changed
        if not changed:
            return revision
        # Keep environment values and secret references out of command arguments and logs.
        with tempfile.TemporaryDirectory(prefix="evolution-task-") as directory:
            path = Path(directory) / "task.json"
            path.write_text(json.dumps(definition))
            path.chmod(0o600)
            return self.aws(
                "ecs", "register-task-definition", "--cli-input-json", "file://" + str(path),
            )["taskDefinition"]["taskDefinitionArn"]

    def deploy(self, image=None, force=False, cpu=None, memory=None):
        service = self.preflight()
        previous = service["taskDefinition"]
        selected = previous
        if image is not None:
            match = re.fullmatch(r"(\d{12})\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?/(.+)@(sha256:[a-f0-9]{64})", image)
            if not match:
                raise ValueError("Use an immutable ECR repository@sha256 image")
            images = self.aws(
                "ecr", "batch-get-image", "--registry-id", match[1],
                "--repository-name", match[2], "--image-ids", "imageDigest=" + match[3],
            )
            if images.get("failures") or len(images.get("images", [])) != 1:
                raise RuntimeError("The requested image does not exist in ECR")
        if image is not None or cpu is not None:
            selected = self.register(image, previous, cpu, memory)
        self.configure(service)
        if selected == previous and not force:
            log("No task replacement is needed")
            return
        try:
            self.replace(selected)
        except BaseException:
            log("Deployment failed; restoring the previous revision with the same drain-first sequence")
            self.replace(previous)
            raise
        log("Deployment completed with exactly one session owner: " + selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", required=True)
    parser.add_argument("--cluster", required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--container", required=True)
    parser.add_argument("--timeout", type=int, default=900, help="Timeout in seconds for each deployment phase")
    parser.add_argument("--image", help="Immutable ECR repository@sha256 image")
    parser.add_argument("--configure-only", action="store_true", help="Apply guardrails without replacing tasks")
    parser.add_argument("--cpu", type=int, help="Task and application container CPU units")
    parser.add_argument("--memory", type=int, help="Task and application container memory in MiB")
    parser.add_argument("--force", action="store_true", help="Replace tasks even if the image has not changed")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("Use a positive timeout")
    if (args.cpu is None) != (args.memory is None):
        parser.error("Use --cpu and --memory together")
    if args.cpu is not None and (args.cpu <= 0 or args.memory <= 0):
        parser.error("Use positive --cpu and --memory values")
    if args.configure_only and any((args.image, args.force, args.cpu, args.memory)):
        parser.error("--configure-only cannot be combined with a replacement")
    if args.force and args.image is None:
        parser.error("--force requires --image")
    if not args.configure_only and args.image is None and args.cpu is None:
        parser.error("Use --image, --cpu with --memory, or --configure-only")
    os.umask(0o077)
    import fcntl
    key = hashlib.sha256(f"{args.region}/{args.cluster}/{args.service}".encode()).hexdigest()[:24]
    with (Path(tempfile.gettempdir()) / f"evolution-ecs-{key}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(_signum, _frame):
            raise InterruptedError("Deployment interrupted")
        signal.signal(signal.SIGTERM, interrupted)
        Deployment(AwsCli(args.region), args.cluster, args.service, args.container, args.timeout).deploy(
            args.image, args.force, args.cpu, args.memory,
        )


if __name__ == "__main__":
    main()
