# Deploy Evolution API no ECS Fargate (AWS)

Este guia usa o template `deploy/aws/evolution-api-ecs-fargate.yaml` para publicar a aplicação com ALB HTTPS, autoscaling e observabilidade.

## 1) Pré-requisitos

- Imagem publicada no ECR no formato:
  - `ACCOUNT.dkr.ecr.REGION.amazonaws.com/evolution-api:<tag>`
- VPC com:
  - subnets públicas (ALB)
  - subnets privadas (ECS task)
- RDS PostgreSQL disponível
- ElastiCache Redis disponível
- Certificado ACM válido na mesma região do ALB
- Secrets (Secrets Manager ou SSM Parameter Store) para:
  - `DATABASE_CONNECTION_URI` (com `sslmode=require`)
  - `AUTHENTICATION_API_KEY`

## 2) Criação dos secrets (exemplo)

> Ajuste os valores para o seu ambiente.

```bash
aws secretsmanager create-secret \
  --name prod/evolution-api/DATABASE_CONNECTION_URI \
  --secret-string 'postgresql://evolution_user:strong_password@mydb.cluster-xxxx.us-east-1.rds.amazonaws.com:5432/evolution_db?sslmode=require'

aws secretsmanager create-secret \
  --name prod/evolution-api/AUTHENTICATION_API_KEY \
  --secret-string 'YOUR_LONG_API_KEY'
```

## 3) Deploy do stack

```bash
aws cloudformation deploy \
  --stack-name evolution-api-prod \
  --template-file deploy/aws/evolution-api-ecs-fargate.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName=prod \
    VpcId=vpc-xxxxxxxx \
    PrivateSubnetIds='subnet-aaa,subnet-bbb' \
    AlbSubnetIds='subnet-ccc,subnet-ddd' \
    AlbCertificateArn='arn:aws:acm:us-east-1:123456789012:certificate/xxxx' \
    ContainerImage='123456789012.dkr.ecr.us-east-1.amazonaws.com/evolution-api:1.0.0' \
    ContainerPort=8080 \
    DesiredCount=1 \
    MinCapacity=1 \
    MaxCapacity=4 \
    DatabaseConnectionUriSecretArn='arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/evolution-api/DATABASE_CONNECTION_URI-xxxx' \
    AuthenticationApiKeySecretArn='arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/evolution-api/AUTHENTICATION_API_KEY-xxxx' \
    RedisUri='redis://my-redis.xxxxxx.use1.cache.amazonaws.com:6379/0' \
    TaskExecutionRoleArn='arn:aws:iam::123456789012:role/ecsTaskExecutionRole' \
    TaskRoleArn='arn:aws:iam::123456789012:role/evolution-api-task-role' \
    RdsSecurityGroupId='sg-rdsxxxx' \
    RedisSecurityGroupId='sg-redisxxxx'
```

## 4) Validações pós-deploy

### 4.1 Endpoint da API (healthcheck)

O Target Group usa `HealthCheckPath=/` por padrão (a API responde em `/`).

```bash
curl -i https://SEU_DOMINIO_OU_ALB/
```

### 4.2 Validar criação de instância WhatsApp (Baileys)

1. Criar instância com provider Baileys (`WHATSAPP-BAILEYS`):

```bash
curl -X POST 'https://SEU_DOMINIO_OU_ALB/instance/create' \
  -H 'Content-Type: application/json' \
  -H 'apikey: YOUR_LONG_API_KEY' \
  -d '{
    "instanceName": "minha-instancia",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

2. Conectar e obter QR code/status:

```bash
curl -X GET 'https://SEU_DOMINIO_OU_ALB/instance/connect/minha-instancia' \
  -H 'apikey: YOUR_LONG_API_KEY'
```

3. Consultar estado da conexão:

```bash
curl -X GET 'https://SEU_DOMINIO_OU_ALB/instance/connectionState/minha-instancia' \
  -H 'apikey: YOUR_LONG_API_KEY'
```

## 5) Observabilidade recomendada

O template já cria:

- Logs no CloudWatch (`awslogs`) em `/ecs/<env>/evolution-api`
- Alarmes para:
  - `HTTPCode_Target_5XX_Count` (erros)
  - `TargetResponseTime` (latência)
  - `RunningTaskCount` (task down/restart loop)
- Auto scaling por CPU e memória

Se quiser notificação, conecte cada alarme a um tópico SNS (subscription por e-mail, Slack ou webhook).
