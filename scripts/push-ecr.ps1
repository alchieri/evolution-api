#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

function Require-Env {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
    Write-Error "Environment variable '$Name' is required."
    exit 1
  }
}

Require-Env -Name 'AWS_REGION'
Require-Env -Name 'AWS_ACCOUNT_ID'
Require-Env -Name 'ECR_REPOSITORY'
Require-Env -Name 'IMAGE_TAG'

$awsRegion = $env:AWS_REGION
$awsAccountId = $env:AWS_ACCOUNT_ID
$ecrRepository = $env:ECR_REPOSITORY
$imageTag = $env:IMAGE_TAG
$stableTag = $env:STABLE_TAG

$ecrRegistry = "$awsAccountId.dkr.ecr.$awsRegion.amazonaws.com"
$ecrImageUri = "$ecrRegistry/$ecrRepository`:$imageTag"

Write-Host "[1/5] Ensuring ECR repository '$ecrRepository' exists..."
$null = aws ecr describe-repositories --repository-names "$ecrRepository" --region "$awsRegion" 2>$null
if ($LASTEXITCODE -ne 0) {
  aws ecr create-repository --repository-name "$ecrRepository" --region "$awsRegion" | Out-Null
}

Write-Host "[2/5] Logging in to ECR registry '$ecrRegistry'..."
$loginPassword = aws ecr get-login-password --region "$awsRegion"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($loginPassword)) {
  Write-Error 'Failed to retrieve ECR login password.'
  exit 1
}

$loginPassword | docker login --username AWS --password-stdin "$ecrRegistry"
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Docker login failed.'
  exit 1
}

Write-Host "[3/5] Building Docker image '$ecrRepository`:$imageTag'..."
docker build -t "$ecrRepository`:$imageTag" .
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Docker build failed.'
  exit 1
}

Write-Host "[4/5] Tagging image as '$ecrImageUri'..."
docker tag "$ecrRepository`:$imageTag" "$ecrImageUri"
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Docker tag failed.'
  exit 1
}

Write-Host "[5/5] Pushing image '$ecrImageUri'..."
docker push "$ecrImageUri"
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Docker push failed.'
  exit 1
}

if (-not [string]::IsNullOrWhiteSpace($stableTag)) {
  $stableImageUri = "$ecrRegistry/$ecrRepository`:$stableTag"

  Write-Host "Tagging and pushing stable image '$stableImageUri'..."
  docker tag "$ecrRepository`:$imageTag" "$stableImageUri"
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'Docker stable tag failed.'
    exit 1
  }

  docker push "$stableImageUri"
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'Docker stable push failed.'
    exit 1
  }
}

Write-Host "Done. Image published to $ecrImageUri."
