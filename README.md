<p align="center">
  <a href="https://evolutionfoundation.com.br">
    <img src="./public/hover-evolution.png" alt="Evolution Foundation" />
  </a>
</p>

<h1 align="center">Evolution API</h1>

<p align="center">
  Open-source REST API for WhatsApp and multi-channel messaging — part of the Evolution Foundation ecosystem.
</p>

<p align="center">
  <a href="https://github.com/evolution-foundation/evolution-api/releases/latest"><img src="https://img.shields.io/github/v/release/evolution-foundation/evolution-api?include_prereleases&label=version&color=00ffa7" alt="Latest version" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0" /></a>
  <a href="https://docs.evolutionfoundation.com.br"><img src="https://img.shields.io/badge/Docs-evolutionfoundation.com.br-00ffa7" alt="Documentation" /></a>
  <a href="https://evolutionfoundation.com.br/community"><img src="https://img.shields.io/badge/Community-Join%20us-white" alt="Community" /></a>
  <a href="https://hub.docker.com/r/evoapicloud/evolution-api"><img src="https://img.shields.io/badge/Docker-evoapicloud-blue" alt="Docker image" /></a>
</p>

<p align="center">
  <a href="https://evolutionfoundation.com.br">Website</a> &middot;
  <a href="https://docs.evolutionfoundation.com.br">Documentation</a> &middot;
  <a href="https://evolutionfoundation.com.br/community">Community</a> &middot;
  <a href="mailto:suporte@evofoundation.com.br">Support</a>
</p>

---

## About

**Evolution API** is a powerful, production-ready REST API for WhatsApp and multi-channel messaging. Originally focused on WhatsApp, it has grown into a comprehensive platform supporting multiple messaging providers and integrations.

Today, Evolution API supports both the Baileys-based WhatsApp Web API and the official WhatsApp Cloud API, plus integrations with Typebot, Chatwoot, Dify, OpenAI, RabbitMQ, Apache Kafka, Amazon SQS, Socket.io, Amazon S3 / MinIO, and more.

Evolution API began as a WhatsApp controller API based on [CodeChat](https://github.com/code-chat-br/whatsapp-api), which in turn implemented the [Baileys](https://github.com/WhiskeySockets/Baileys) library. We continue to acknowledge CodeChat for laying the groundwork.

## Part of the Evolution Foundation ecosystem

Evolution API is one of the messaging engines maintained by Evolution Foundation. It is used as a WhatsApp provider by the [Evo CRM Community](https://github.com/evolution-foundation/evo-crm-community) and other projects in the ecosystem.

---

## Connection Types

Evolution API supports multiple connection types to WhatsApp:

### WhatsApp API — Baileys
A free API based on WhatsApp Web, leveraging the [Baileys library](https://github.com/WhiskeySockets/Baileys). Suitable for multi-service chats, service bots, and WhatsApp-integrated systems. Note: this method relies on the web version of WhatsApp and may have limitations compared to official APIs.

### WhatsApp Cloud API
The official API provided by Meta. Designed for businesses with higher messaging volumes and stronger integration support, including end-to-end encryption, advanced analytics, and customer service tools. Requires compliance with Meta's policies and may incur per-message costs.

---

## Integrations

Evolution API integrates natively with many platforms:

- **[Typebot](https://typebot.io/)** — conversational bots with trigger management
- **[Chatwoot](https://www.chatwoot.com/)** — customer service platform
- **[RabbitMQ](https://www.rabbitmq.com/)** — event streaming via AMQP
- **[Apache Kafka](https://kafka.apache.org/)** — real-time event streaming and processing
- **[Amazon SQS](https://aws.amazon.com/sqs/)** — cloud-based message queuing
- **[Socket.io](https://socket.io/)** — real-time WebSocket events
- **[Dify](https://dify.ai/)** — AI agent workflows
- **[OpenAI](https://openai.com/)** — AI capabilities including audio-to-text conversion
- **Amazon S3 / [MinIO](https://min.io/)** — media file storage

---

## Quick Start

### Prerequisites

- **Node.js** 20+
- **PostgreSQL** or **MySQL**
- **Valkey** (recommended for distributed caching)

### Installation

```bash
git clone git@github.com:evolution-foundation/evolution-api.git
cd evolution-api

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database, Valkey, and API key
```

## Manual Recovery Endpoint (Layer B / Layer C)

This section is intended for API clients that consume manual recovery operations.

### Endpoint summary

- `POST /instance/recovery/:instanceName` starts a manual recovery operation.
- `GET /instance/recovery/:operationId/:instanceName` returns operation status.
- The recovery flow is **asynchronous**:
  - `POST` returns `202 Accepted` with `operationId`.
  - The actual execution continues in background and must be tracked via `GET` status endpoint.

### Operational impact by layer

- **Layer B (hard reconnect, no session reset)**:
  - Forces reconnect/restart flow without recycling credentials/session.
  - Lower disruption profile when session is healthy but transport/socket is unstable.
- **Layer C (session recycle)**:
  - Performs logout + credential/session recycle + new connect attempt.
  - May require a **new QR code scan** depending on provider/account state.
  - Requires explicit confirmation header: `x-recovery-confirmation: true` (or `CONFIRM_LAYER_C`).

### Request examples

#### Layer B request

```bash
curl --request POST \
  --url http://localhost:8080/instance/recovery/my-instance \
  --header 'Content-Type: application/json' \
  --header 'apikey: <YOUR_API_KEY>' \
  --data '{
    "layer": "B",
    "reason": "Transport reconnect after repeated socket instability",
    "force": false
  }'
```

#### Layer B response (`202 Accepted`)

```json
{
  "instanceName": "my-instance",
  "layer": "B",
  "status": "accepted",
  "operationId": "my-instance:B:1715800000000"
}
```

#### Layer C request

```bash
curl --request POST \
  --url http://localhost:8080/instance/recovery/my-instance \
  --header 'Content-Type: application/json' \
  --header 'apikey: <YOUR_API_KEY>' \
  --header 'x-recovery-confirmation: true' \
  --data '{
    "layer": "C",
    "reason": "Credential/session recycle after persistent auth inconsistency",
    "force": true
  }'
```

#### Layer C response (`202 Accepted`)

```json
{
  "instanceName": "my-instance",
  "layer": "C",
  "status": "accepted",
  "operationId": "my-instance:C:1715800001000"
}
```

### Status tracking (mandatory)

Use the `operationId` from `POST` response:

```bash
curl --request GET \
  --url http://localhost:8080/instance/recovery/my-instance:C:1715800001000/my-instance \
  --header 'apikey: <YOUR_API_KEY>'
```

Example status response:

```json
{
  "status": "running",
  "layer": "C",
  "startedAt": "2026-05-20T10:30:00.000Z",
  "finishedAt": null,
  "errorMessage": null
}
```

Possible values for `status`: `accepted`, `running`, `completed`, `failed`.

### When to use each layer

- Prefer **Layer B** first when:
  - Instance is known and exists.
  - You need fast reconnect with minimal user impact.
  - There are transient connection issues without evidence of credential corruption.
- Use **Layer C** when:
  - Layer B did not restore stability.
  - There are persistent auth/session inconsistencies.
  - You are operationally ready for possible QR re-authentication.

### Common errors and how to act

- **`409 Conflict`**: another recovery is already in progress for the same instance.
  - Action: read the `operationInProgress` payload and poll status endpoint until completion.
  - Then decide whether a new operation is still needed.
- **`422 Unprocessable Entity`**: semantic payload issue (for example integration/client contract mismatch).
  - Action: validate `layer` (`B` or `C`), `reason` length/format, and required confirmation for Layer C.
  - Re-send request only after fixing payload semantics.
- **`404 Not Found`**:
  - Instance not found on `POST` recovery.
  - `operationId` not found for given instance on `GET` status.
  - Action: confirm `instanceName`, keep strict mapping between operation and instance, and retry with correct identifiers.

### Database setup

```bash
# Set the database provider
export DATABASE_PROVIDER=postgresql  # or mysql

# Generate Prisma client
npm run db:generate

# Deploy migrations
npm run db:deploy
```

### Running

```bash
# Development with hot reload
npm run dev:server

# Production build and run
npm run build
npm run start:prod
```

### Docker

```bash
docker pull evoapicloud/evolution-api:latest
docker run -p 8080:8080 --env-file .env evoapicloud/evolution-api:latest
```

---

## Architecture

Evolution API is built with a multi-provider, event-driven architecture:

```
Client / CRM
     ↓
Evolution API
  ├── Channel Integrations (Baileys / Cloud API)
  ├── Chatbot Integrations (Typebot, Chatwoot, OpenAI, Dify, Flowise, N8N)
  ├── Event Integrations (WebSocket, RabbitMQ, SQS, NATS, Pusher)
  └── Storage Integrations (S3, MinIO)
```

Built with **Node.js 20+**, **TypeScript 5+**, and **Express.js**, it provides extensive integrations with chatbots, CRM systems, and messaging platforms.

### Multi-database support
PostgreSQL and MySQL via Prisma ORM with provider-specific schemas and migrations.

### Authentication
- API key-based authentication via `apikey` header
- Instance-specific tokens for WhatsApp connection authentication
- Webhook signature validation for external integrations

### Message queue support
RabbitMQ, Amazon SQS, NATS, Pusher and WebSocket for events. Configurable per instance.

### Media handling
Local storage or S3/MinIO. Automatic media download from WhatsApp. Optional audio transcription via OpenAI.

---

## Documentation

| Resource | Link |
|---|---|
| Website | [evolutionfoundation.com.br](https://evolutionfoundation.com.br) |
| Documentation | [docs.evolutionfoundation.com.br](https://docs.evolutionfoundation.com.br) |
| Community | [evolutionfoundation.com.br/community](https://evolutionfoundation.com.br/community) |
| Docker Hub | [evoapicloud/evolution-api](https://hub.docker.com/r/evoapicloud/evolution-api) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Security | [SECURITY.md](./SECURITY.md) |

---

## Hosting

Deploy Evolution API with optimized infrastructure through our HostGator partnership:

[**Evolution API VPS — HostGator**](https://evolution-api.com/vps-evolution-api)

---

## Telemetry

Evolution API collects anonymous telemetry data (routes used, most accessed routes, API version) to help improve the service. **No sensitive or personal data is collected.** This information helps us identify improvements and provide a better experience for users.

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to submit issues, propose features, and open pull requests.

Join our [community](https://evolutionfoundation.com.br/community) to discuss ideas and collaborate.

---

## Security

For security issues, **do not open a public issue**. Email **suporte@evofoundation.com.br** or use GitHub's private vulnerability reporting. See [SECURITY.md](./SECURITY.md) for details.

---

## Acknowledgments

- [CodeChat](https://github.com/code-chat-br/whatsapp-api) — original WhatsApp API foundation
- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web library

---

## License

Evolution API is licensed under the Apache License 2.0, with additional brand-protection conditions (LOGO/copyright preservation and Usage Notification requirement). See [LICENSE](./LICENSE) for full details.

For licensing inquiries, contact **suporte@evofoundation.com.br**.

## Trademarks

"Evolution Foundation", "Evolution" and "Evolution API" are trademarks of Evolution Foundation. See [TRADEMARKS.md](./TRADEMARKS.md) for the brand assets policy.

Third-party attributions are documented in [NOTICE](./NOTICE).

## Publish Docker image to AWS ECR

You can publish the root `Dockerfile` image to AWS ECR with helper scripts for Linux/macOS (`bash`) and Windows (`PowerShell`).

### Linux / macOS (bash)

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=123456789012
export ECR_REPOSITORY=evolution-api
export IMAGE_TAG=v2.3.1-prod
# optional stable tag
export STABLE_TAG=prod

./scripts/push-ecr.sh
```

### Windows (PowerShell)

```powershell
$env:AWS_REGION = 'us-east-1'
$env:AWS_ACCOUNT_ID = '123456789012'
$env:ECR_REPOSITORY = 'evolution-api'
$env:IMAGE_TAG = 'v2.3.1-prod'
# optional stable tag
$env:STABLE_TAG = 'prod'

./scripts/push-ecr.ps1
```

The script performs this flow automatically:

1. Creates the ECR repository when it does not exist.
2. Logs in to ECR.
3. Builds `Dockerfile` from repository root.
4. Tags image with ECR URI.
5. Pushes image to ECR.
6. Optionally tags/pushes a stable tag (`STABLE_TAG`).

## Deploy to AWS ECS Fargate

A complete CloudFormation template for ECS Fargate deployment is available at:

- `deploy/aws/evolution-api-ecs-fargate.yaml`
- `deploy/aws/README-ecs-fargate.md`

This setup includes:

- ECS Task Definition using image `ACCOUNT.dkr.ecr.REGION.amazonaws.com/evolution-api:<tag>`
- Container port `8080`
- Default image `entrypoint/command` preserved
- Environment + Secrets split (`DATABASE_CONNECTION_URI` and `AUTHENTICATION_API_KEY` via `secrets`)
- Private subnets for tasks, ALB + Target Group + HTTPS listener with ACM
- Autoscaling by CPU and memory with min 1 task
- CloudWatch logs (`awslogs`) and alarms (5xx, latency, running tasks)
- Existing ElastiCache Valkey and PostgreSQL wiring for production
  (`sslmode=require` in database URI). The template does not create a cache
  cluster and must not be used to restore Redis OSS.

---

<p align="center">
  Made by <a href="https://evolutionfoundation.com.br">Evolution Foundation</a> · © 2026
</p>
