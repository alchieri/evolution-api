# Deploy Evolution API no ECS Fargate (AWS)

Este guia usa o template `deploy/aws/evolution-api-ecs-fargate.yaml` para publicar a aplicação com ALB HTTPS e observabilidade. A aplicação mantém uma única réplica, pois duas tasks com o mesmo armazenamento de sessões podem disputar a conexão WhatsApp.

## 1) Pré-requisitos

- Imagem publicada no ECR no formato:
  - `ACCOUNT.dkr.ecr.REGION.amazonaws.com/evolution-api:<tag>`
- VPC com:
  - subnets públicas (ALB)
  - subnets privadas (ECS task)
- RDS PostgreSQL disponível
- replication group ElastiCache Valkey existente; este template não cria
  cluster de cache
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
    DatabaseConnectionUriSecretArn='arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/evolution-api/DATABASE_CONNECTION_URI-xxxx' \
    AuthenticationApiKeySecretArn='arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/evolution-api/AUTHENTICATION_API_KEY-xxxx' \
    ValkeyUri='redis://my-valkey.xxxxxx.use1.cache.amazonaws.com:6379/0' \
    TaskExecutionRoleArn='arn:aws:iam::123456789012:role/ecsTaskExecutionRole' \
    TaskRoleArn='arn:aws:iam::123456789012:role/evolution-api-task-role' \
    RdsSecurityGroupId='sg-rdsxxxx' \
    ValkeySecurityGroupId='sg-valkeyxxxx'
```

`CACHE_REDIS_*` e o esquema `redis://` são nomes mantidos pelo contrato do
cliente/protocolo da Evolution API. O engine permitido em produção/AWS é
Valkey. Não crie Redis OSS e não use snapshots pré-migração como rollback de
engine.

## Atualizações de imagem e rollback

Use Python 3 e AWS CLI, com credenciais autorizadas para o serviço e o ECR. Publique a imagem antes da troca e informe o digest imutável:

```bash
python3 deploy/aws/deploy_ecs.py \
  --region us-east-1 \
  --cluster evolution-api \
  --service evolution-api-service \
  --container evolution-api-container \
  --image '105364216461.dkr.ecr.us-east-1.amazonaws.com/evolution-api@sha256:DIGEST_DE_64_CARACTERES'
```

O script verifica a imagem no ECR, preserva a configuração da task atual e executa três fases separadas:

1. Reduz a escala para zero e espera todas as tasks chegarem a `STOPPED`, inclusive as que estão em `DEACTIVATING` com estado desejado `STOPPED`.
2. Altera apenas a revisão e aguarda o serviço estabilizar nessa revisão com zero tasks e um único deployment.
3. Aumenta apenas a escala para uma réplica e verifica a revisão e a estabilidade da task resultante.

Não combine `--task-definition` e `--desired-count 1` na mesma chamada de `UpdateService`: o ECS pode recriar uma task da revisão antiga enquanto inicia a revisão nova. O rollback do script segue as mesmas três fases. O rollback automático do ECS fica desativado para que não contorne essa sequência; o circuit breaker continua detectando falhas.

O deploy exige uma janela de reconexão, que inclui a drenagem do ALB. O timeout padrão é de 900 segundos por fase. A mesma imagem já ativa não reinicia tasks; use `--force` somente para solicitar essa substituição.

Para aplicar somente os limites, sem interromper a task atual:

```bash
python3 deploy/aws/deploy_ecs.py \
  --region us-east-1 --cluster evolution-api --service evolution-api-service \
  --container evolution-api-container --configure-only
```

O template e o script usam `minimumHealthyPercent=0`, `maximumPercent=100` e desativam o rebalanceamento entre zonas. O script recusa serviços com autoscaling registrado ou outro deployment em andamento. O template não cria autoscaling e aceita somente zero ou uma réplica.

Execute uma implantação por vez. O script mantém um lock local por serviço; em CI, serialize os jobs em um único grupo de concorrência e use `cancel-in-progress: false`. Para atualizar a imagem via CloudFormation, faça a mesma sequência em atualizações separadas: `DesiredCount=0` e tasks encerradas, imagem nova ainda com `DesiredCount=0`, depois `DesiredCount=1`.

Permissões operacionais: `ecs:DescribeServices`, `ecs:ListTasks`, `ecs:DescribeTasks`, `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `iam:PassRole` restrito às roles da task, `ecr:BatchGetImage` e `application-autoscaling:DescribeScalableTargets`.

Valide a regressão da sequência antes de alterar o script:

```bash
python3 -m unittest discover -s deploy/aws -p 'test_*.py'
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
- Uma réplica fixa, sem autoscaling de sessões compartilhadas

Se quiser notificação, conecte cada alarme a um tópico SNS (subscription por e-mail, Slack ou webhook).
