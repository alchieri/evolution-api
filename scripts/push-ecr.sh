#!/usr/bin/env bash

set -euo pipefail

require_env() {
  local name="$1"

  if [[ -z "${!name:-}" ]]; then
    echo "Error: environment variable '$name' is required." >&2
    exit 1
  fi
}

require_env AWS_REGION
require_env AWS_ACCOUNT_ID
require_env ECR_REPOSITORY
require_env IMAGE_TAG

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo "[1/5] Ensuring ECR repository '${ECR_REPOSITORY}' exists..."
if ! aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  aws ecr create-repository --repository-name "${ECR_REPOSITORY}" --region "${AWS_REGION}"
fi

echo "[2/5] Logging in to ECR registry '${ECR_REGISTRY}'..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

echo "[3/5] Building Docker image '${ECR_REPOSITORY}:${IMAGE_TAG}'..."
docker build -t "${ECR_REPOSITORY}:${IMAGE_TAG}" .

echo "[4/5] Tagging image as '${ECR_IMAGE_URI}'..."
docker tag "${ECR_REPOSITORY}:${IMAGE_TAG}" "${ECR_IMAGE_URI}"

echo "[5/5] Pushing image '${ECR_IMAGE_URI}'..."
docker push "${ECR_IMAGE_URI}"

if [[ -n "${STABLE_TAG:-}" ]]; then
  STABLE_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${STABLE_TAG}"

  echo "Tagging and pushing stable image '${STABLE_IMAGE_URI}'..."
  docker tag "${ECR_REPOSITORY}:${IMAGE_TAG}" "${STABLE_IMAGE_URI}"
  docker push "${STABLE_IMAGE_URI}"
fi

echo "Done. Image published to ${ECR_IMAGE_URI}."
