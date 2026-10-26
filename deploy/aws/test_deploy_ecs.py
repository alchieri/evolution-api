import contextlib
import copy
import io
import json
from pathlib import Path
import unittest

from deploy_ecs import Deployment, POLICY


OLD = "arn:aws:ecs:us-east-1:123456789012:task-definition/evolution:1"
NEW = "arn:aws:ecs:us-east-1:123456789012:task-definition/evolution:2"
OLD_IMAGE = "123456789012.dkr.ecr.us-east-1.amazonaws.com/evolution-api@sha256:" + "a" * 64
NEW_IMAGE = "123456789012.dkr.ecr.us-east-1.amazonaws.com/evolution-api@sha256:" + "b" * 64


class FakeEcs:
    """Model the gap between ECS runningCount=0 and actual process termination."""

    def __init__(self):
        self.revision = OLD
        self.desired = 1
        self.policy = {"minimumHealthyPercent": 100, "maximumPercent": 200}
        self.az = "ENABLED"
        self.grace = 0
        self.tasks = [self.task("old", OLD)]
        self.calls = []
        self.events = []
        self.zero_observed = False
        self.allow_stop = True
        self.failed_revision = None
        self.failed_seen = False
        self.scalers = []
        self.image_exists = True
        self.registered = None
        self.load_balancer = False
        self.target_health_checks = 0

    @staticmethod
    def task(name, revision):
        return {
            "taskArn": name, "taskDefinitionArn": revision,
            "lastStatus": "RUNNING", "desiredStatus": "RUNNING", "ticks": 2,
            "attachments": [{"details": [{"name": "privateIPv4Address", "value": "10.0.0.10"}]}],
        }

    def __call__(self, *args):
        self.calls.append(args)
        operation = args[1]
        if operation == "describe-scalable-targets":
            return {"ScalableTargets": self.scalers}
        if operation == "batch-get-image":
            return {"images": [{}] if self.image_exists else []}
        if operation == "describe-target-health":
            self.target_health_checks += 1
            state = "healthy" if self.target_health_checks >= 2 else "initial"
            return {"TargetHealthDescriptions": [{
                "Target": {"Id": "10.0.0.10", "Port": 8080},
                "TargetHealth": {"State": state},
            }]}
        if operation == "describe-services":
            if self.desired == 0:
                self.zero_observed = True
            running = sum(t["desiredStatus"] == "RUNNING" for t in self.tasks)
            if self.desired and self.revision == self.failed_revision:
                self.failed_seen = True
            state = "FAILED" if self.failed_seen and self.revision == self.failed_revision else "COMPLETED"
            deployments = [{"rolloutState": state}]
            if state == "FAILED":
                deployments.append({"rolloutState": "COMPLETED"})
            service = {
                "status": "ACTIVE", "deploymentController": {"type": "ECS"},
                "taskDefinition": self.revision, "desiredCount": self.desired,
                "runningCount": running, "pendingCount": 0,
                "deployments": deployments, "deploymentConfiguration": copy.deepcopy(self.policy),
                "availabilityZoneRebalancing": self.az, "healthCheckGracePeriodSeconds": self.grace,
            }
            if self.load_balancer:
                service["loadBalancers"] = [{"targetGroupArn": "target-group", "containerPort": 8080}]
            return {"services": [service]}
        if operation == "list-tasks":
            status = args[args.index("--desired-status") + 1]
            return {"taskArns": [t["taskArn"] for t in self.tasks if t["desiredStatus"] == status]}
        if operation == "describe-tasks":
            result = copy.deepcopy(self.tasks)
            for task in self.tasks:
                if task["lastStatus"] == "DEACTIVATING" and self.allow_stop:
                    task["ticks"] -= 1
                    if task["ticks"] <= 0:
                        task["lastStatus"] = "STOPPED"
                        self.events.append(("stopped", task["taskDefinitionArn"]))
            return {"tasks": result}
        if operation == "describe-task-definition":
            return {"taskDefinition": {
                "family": "evolution", "taskDefinitionArn": OLD, "cpu": "512", "memory": "1024",
                "executionRoleArn": "execution-role", "networkMode": "awsvpc",
                "containerDefinitions": [{
                    "name": "evolution-api-container", "image": OLD_IMAGE,
                    "cpu": 512, "memory": 1024,
                    "environmentFiles": [{"value": "arn:aws:s3:::bucket/evolution.env", "type": "s3"}],
                    "dockerLabels": {"org.opencontainers.image.revision": "old-revision"},
                }],
            }}
        if operation == "register-task-definition":
            if "--generate-cli-skeleton" in args:
                return dict.fromkeys(["family", "cpu", "memory", "executionRoleArn", "networkMode", "containerDefinitions"])
            path = Path(args[args.index("--cli-input-json") + 1].removeprefix("file://"))
            assert path.stat().st_mode & 0o777 == 0o600
            self.registered = json.loads(path.read_text())
            return {"taskDefinition": {"taskDefinitionArn": NEW}}
        if operation == "update-service":
            options = list(args[2:])
            force = "--force-new-deployment" in options
            if force:
                options.remove("--force-new-deployment")
                self.failed_seen = False
            values = {options[i][2:]: options[i + 1] for i in range(0, len(options), 2)}
            # This atomic update reproduced the production race: it must never be used.
            assert not ("task-definition" in values and "desired-count" in values)
            if "deployment-configuration" in values:
                self.policy = json.loads(values["deployment-configuration"])
                self.az = values["availability-zone-rebalancing"]
                self.grace = int(values["health-check-grace-period-seconds"])
            if "task-definition" in values:
                assert self.desired == 0 and all(t["lastStatus"] == "STOPPED" for t in self.tasks)
                self.revision = values["task-definition"]
                self.zero_observed = False
                self.events.append(("revision-at-zero", self.revision))
            if "desired-count" in values:
                self.desired = int(values["desired-count"])
                if self.desired == 0:
                    for task in self.tasks:
                        if task["desiredStatus"] == "RUNNING":
                            task.update(desiredStatus="STOPPED", lastStatus="DEACTIVATING")
                else:
                    assert self.zero_observed, "The selected revision must stabilize at zero first"
                    assert all(t["lastStatus"] == "STOPPED" for t in self.tasks), "Session owners overlapped"
                    self.tasks.append(self.task(str(len(self.tasks)), self.revision))
                    self.events.append(("started", self.revision))
            return {}
        raise AssertionError(args)


class FastDeployment(Deployment):
    def wait(self, predicate, description):
        for _ in range(8):
            if predicate():
                return
        raise TimeoutError(description)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        self.aws = FakeEcs()
        self.deployer = FastDeployment(self.aws, "cluster", "service", "evolution-api-container")

    def test_deploy_waits_for_stopped_processes_and_new_revision_at_zero(self):
        self.deployer.deploy(NEW_IMAGE)
        self.assertEqual(self.aws.events, [("stopped", OLD), ("revision-at-zero", NEW), ("started", NEW)])
        self.assertEqual(self.aws.desired, 1)
        self.assertEqual(self.aws.policy, POLICY)
        self.assertEqual(self.aws.az, "DISABLED")
        self.assertEqual(self.aws.grace, 300)

    def test_rollback_also_stops_failed_revision_before_starting_old_revision(self):
        self.aws.failed_revision = NEW
        with self.assertRaisesRegex(RuntimeError, "health checks"):
            self.deployer.deploy(NEW_IMAGE)
        self.assertEqual(self.aws.events, [
            ("stopped", OLD), ("revision-at-zero", NEW), ("started", NEW),
            ("stopped", NEW), ("revision-at-zero", OLD), ("started", OLD),
        ])
        self.assertEqual(self.aws.revision, OLD)
        self.assertEqual(self.aws.desired, 1)

    def test_timeout_never_starts_a_second_owner_even_during_rollback(self):
        self.aws.allow_stop = False
        with self.assertRaises(TimeoutError):
            self.deployer.deploy(NEW_IMAGE)
        self.assertFalse(any(event[0] == "started" for event in self.aws.events))

    def test_draining_task_is_detected_even_with_desired_status_stopped(self):
        self.aws.tasks.append({**self.aws.task("draining", OLD), "desiredStatus": "STOPPED", "lastStatus": "DEACTIVATING"})
        with self.assertRaisesRegex(RuntimeError, "Extra or draining"):
            self.deployer.deploy(NEW_IMAGE)
        self.assertFalse(any(call[1] == "update-service" for call in self.aws.calls))

    def test_autoscaling_is_rejected_before_any_changes(self):
        self.aws.scalers = [{"MaxCapacity": 4}]
        with self.assertRaisesRegex(RuntimeError, "autoscaling"):
            self.deployer.deploy(NEW_IMAGE)
        self.assertFalse(any(call[1] == "update-service" for call in self.aws.calls))

    def test_missing_image_leaves_existing_service_untouched(self):
        self.aws.image_exists = False
        with self.assertRaisesRegex(RuntimeError, "does not exist"):
            self.deployer.deploy(NEW_IMAGE)
        self.assertFalse(any(call[1] == "update-service" for call in self.aws.calls))

    def test_configuration_and_same_image_do_not_replace_tasks(self):
        for image in (None, OLD_IMAGE):
            with self.subTest(image=image):
                self.deployer.deploy(image)
                self.assertFalse(self.aws.events)
        self.assertEqual(self.aws.tasks[0]["lastStatus"], "RUNNING")

    def test_registration_preserves_roles_and_environment_file(self):
        self.deployer.deploy(NEW_IMAGE)
        definition = self.aws.registered
        self.assertEqual(definition["executionRoleArn"], "execution-role")
        self.assertEqual(definition["cpu"], "512")
        self.assertNotIn("taskDefinitionArn", definition)
        container = definition["containerDefinitions"][0]
        self.assertEqual(container["image"], NEW_IMAGE)
        self.assertEqual(container["environmentFiles"][0]["value"], "arn:aws:s3:::bucket/evolution.env")
        self.assertNotIn("org.opencontainers.image.revision", container["dockerLabels"])

    def test_resize_updates_task_and_container_without_changing_image_or_environment(self):
        self.deployer.deploy(cpu=256, memory=512)
        definition = self.aws.registered
        self.assertEqual(("256", "512"), (definition["cpu"], definition["memory"]))
        container = definition["containerDefinitions"][0]
        self.assertEqual((256, 512), (container["cpu"], container["memory"]))
        self.assertEqual(OLD_IMAGE, container["image"])
        self.assertEqual("arn:aws:s3:::bucket/evolution.env", container["environmentFiles"][0]["value"])
        self.assertEqual(self.aws.events, [
            ("stopped", OLD), ("revision-at-zero", NEW), ("started", NEW),
        ])

    def test_deploy_waits_for_load_balancer_target_health(self):
        self.aws.load_balancer = True
        self.deployer.deploy(cpu=256, memory=512)
        self.assertGreaterEqual(self.aws.target_health_checks, 2)

    def test_forced_same_image_restart_still_waits_for_zero_replicas(self):
        self.deployer.deploy(OLD_IMAGE, force=True)
        self.assertEqual(self.aws.events, [("stopped", OLD), ("started", OLD)])


if __name__ == "__main__":
    unittest.main()
