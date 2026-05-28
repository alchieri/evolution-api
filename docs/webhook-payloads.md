# Payloads de webhooks

Este documento descreve o formato dos payloads enviados pela Evolution API para destinos de webhook via HTTP
`POST`. O envelope é montado pelo `WebhookController.emit`, enquanto os metadados de execução são preenchidos por
`sendDataWebhook` nos canais/serviços que disparam eventos.

## Envelope padrão

Todo evento enviado para webhook usa um objeto JSON com os campos abaixo:

| Campo         | Tipo esperado               | Descrição                                                                                    |
| ------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `event`       | `string`                    | Nome externo do evento, por exemplo `messages.upsert`.                                       |
| `instance`    | `string`                    | Nome da instância que originou o evento.                                                     |
| `data`        | `object`, `array` ou `null` | Payload específico do evento. O formato varia conforme o evento e o provedor WhatsApp usado. |
| `destination` | `string`                    | URL base configurada para o webhook local ou URL global calculada para o evento.             |
| `date_time`   | `string`                    | Data/hora ISO gerada no servidor no momento do disparo do evento.                            |
| `sender`      | `string` ou `null`          | WUID/número conectado da instância quando disponível.                                        |
| `server_url`  | `string`                    | URL pública do servidor configurada em `SERVER.URL`.                                         |
| `apikey`      | `string` ou `null`          | Chave da instância quando sua exposição estiver permitida; caso contrário, `null`.           |

Campos extras também podem ser adicionados no nível raiz quando o emissor passa o parâmetro `extra` para
`sendDataWebhook`. Exemplo: eventos de histórico podem incluir metadados adicionais como `messagingHistory` antes dos
campos padrão do envelope.

Exemplo genérico:

```json
{
  "event": "messages.upsert",
  "instance": "minha-instancia",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "BAE5F7A1A2B3C4D5"
    },
    "pushName": "Maria",
    "messageType": "conversation",
    "message": {
      "conversation": "Olá!"
    },
    "messageTimestamp": 1710000000
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:34:56.789Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

## Entrega por evento (`webhookByEvents`)

Quando `webhookByEvents` está habilitado no webhook local da instância, a URL configurada recebe o sufixo do evento
normalizado:

1. pontos (`.`) e hífens (`-`) são convertidos para `_` para a chave interna do evento;
2. a chave é convertida para minúsculas;
3. os `_` são convertidos para hífens (`-`) para formar o caminho HTTP.

Exemplos:

| Evento                      | Sufixo normalizado          | URL final com `webhookByEvents`                         |
| --------------------------- | --------------------------- | ------------------------------------------------------- |
| `messages.upsert`           | `messages-upsert`           | `https://example.com/webhook/messages-upsert`           |
| `group-participants.update` | `group-participants-update` | `https://example.com/webhook/group-participants-update` |
| `typebot.change-status`     | `typebot-change-status`     | `https://example.com/webhook/typebot-change-status`     |

O mesmo padrão existe para webhooks globais quando `WEBHOOK.GLOBAL.WEBHOOK_BY_EVENTS` está habilitado.

> Observação: o campo `destination` no corpo do payload representa a URL base configurada/calculada no envelope. A URL
> HTTP efetivamente chamada pode receber o sufixo normalizado quando a entrega por evento estiver ativa.

## Segurança da `apikey`

O campo `apikey` só recebe a chave da instância quando a configuração
`AUTHENTICATION.EXPOSE_IN_FETCH_INSTANCES` permite a exposição da chave. Quando essa exposição não está habilitada, o
valor enviado por `sendDataWebhook` é `null`.

Além disso, webhooks locais podem exigir autenticação por `apikey` nas configurações de webhook. Nesse caso, a entrega
pode usar uma `fallbackApiKey`, ou ser bloqueada se a chave for obrigatória e ausente.

## Variação do campo `data`

O formato de `data` não é único para todos os webhooks. Ele pode variar conforme:

- o evento emitido;
- o provedor WhatsApp usado: Baileys, Meta Business API ou Evolution channel;
- a transformação aplicada antes do envio, como normalização de contatos, chats, mensagens, grupos ou sessões de bot;
- configurações de armazenamento/base64 e recursos específicos de cada canal.

Considere os exemplos abaixo como formatos representativos dos campos mais comuns, não como contratos rígidos para todos
os provedores.

## Eventos disponíveis

A lista abaixo usa os valores externos definidos no enum `Events`.

| Chave do enum               | Valor externo               |
| --------------------------- | --------------------------- |
| `APPLICATION_STARTUP`       | `application.startup`       |
| `INSTANCE_CREATE`           | `instance.create`           |
| `INSTANCE_DELETE`           | `instance.delete`           |
| `QRCODE_UPDATED`            | `qrcode.updated`            |
| `CONNECTION_UPDATE`         | `connection.update`         |
| `STATUS_INSTANCE`           | `status.instance`           |
| `MESSAGES_SET`              | `messages.set`              |
| `MESSAGES_UPSERT`           | `messages.upsert`           |
| `MESSAGES_EDITED`           | `messages.edited`           |
| `MESSAGES_UPDATE`           | `messages.update`           |
| `MESSAGES_DELETE`           | `messages.delete`           |
| `SEND_MESSAGE`              | `send.message`              |
| `SEND_MESSAGE_UPDATE`       | `send.message.update`       |
| `CONTACTS_SET`              | `contacts.set`              |
| `CONTACTS_UPSERT`           | `contacts.upsert`           |
| `CONTACTS_UPDATE`           | `contacts.update`           |
| `PRESENCE_UPDATE`           | `presence.update`           |
| `CHATS_SET`                 | `chats.set`                 |
| `CHATS_UPDATE`              | `chats.update`              |
| `CHATS_UPSERT`              | `chats.upsert`              |
| `CHATS_DELETE`              | `chats.delete`              |
| `GROUPS_UPSERT`             | `groups.upsert`             |
| `GROUPS_UPDATE`             | `groups.update`             |
| `GROUP_PARTICIPANTS_UPDATE` | `group-participants.update` |
| `CALL`                      | `call`                      |
| `TYPEBOT_START`             | `typebot.start`             |
| `TYPEBOT_CHANGE_STATUS`     | `typebot.change-status`     |
| `LABELS_EDIT`               | `labels.edit`               |
| `LABELS_ASSOCIATION`        | `labels.association`        |
| `CREDS_UPDATE`              | `creds.update`              |
| `MESSAGING_HISTORY_SET`     | `messaging-history.set`     |
| `REMOVE_INSTANCE`           | `remove.instance`           |
| `LOGOUT_INSTANCE`           | `logout.instance`           |

## Exemplos de payloads

Os exemplos abaixo mostram o envelope completo e um `data` representativo para eventos importantes.

### `messages.upsert`

```json
{
  "event": "messages.upsert",
  "instance": "minha-instancia",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "BAE5F7A1A2B3C4D5"
    },
    "pushName": "Maria",
    "messageType": "conversation",
    "message": {
      "conversation": "Olá!"
    },
    "messageTimestamp": 1710000000,
    "instanceId": "inst_123"
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:34:56.789Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `messages.update`

```json
{
  "event": "messages.update",
  "instance": "minha-instancia",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": true,
      "id": "3A9EB01234567890"
    },
    "status": "READ",
    "messageId": "db-message-id",
    "update": {
      "status": 4
    }
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:35:10.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `messages.delete`

```json
{
  "event": "messages.delete",
  "instance": "minha-instancia",
  "data": {
    "remoteJid": "5511999999999@s.whatsapp.net",
    "fromMe": true,
    "id": "3A9EB01234567890",
    "status": "DELETED"
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:36:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `send.message`

```json
{
  "event": "send.message",
  "instance": "minha-instancia",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": true,
      "id": "3A9EB0ABCDEF1234"
    },
    "message": {
      "conversation": "Mensagem enviada pela API"
    },
    "messageType": "conversation",
    "messageTimestamp": 1710000100,
    "status": "PENDING"
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:37:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `connection.update`

```json
{
  "event": "connection.update",
  "instance": "minha-instancia",
  "data": {
    "instance": "minha-instancia",
    "state": "open",
    "statusReason": 200,
    "wuid": "5511888888888@s.whatsapp.net",
    "profileName": "Minha Empresa",
    "profilePictureUrl": "https://pps.whatsapp.net/example.jpg"
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:38:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `qrcode.updated`

```json
{
  "event": "qrcode.updated",
  "instance": "minha-instancia",
  "data": {
    "qrcode": {
      "instance": "minha-instancia",
      "pairingCode": "ABCD-1234",
      "code": "2@qr-code-content",
      "base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
    }
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:39:00.000Z",
  "sender": null,
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `contacts.upsert`

```json
{
  "event": "contacts.upsert",
  "instance": "minha-instancia",
  "data": [
    {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "pushName": "Maria",
      "profilePicUrl": null,
      "instanceId": "inst_123"
    }
  ],
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:40:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `chats.upsert`

```json
{
  "event": "chats.upsert",
  "instance": "minha-instancia",
  "data": [
    {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "instanceId": "inst_123",
      "name": "Maria",
      "unreadMessages": 0
    }
  ],
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:41:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `groups.upsert`

```json
{
  "event": "groups.upsert",
  "instance": "minha-instancia",
  "data": [
    {
      "id": "120363000000000000@g.us",
      "subject": "Grupo de Atendimento",
      "subjectOwner": "5511888888888@s.whatsapp.net",
      "subjectTime": 1710000200,
      "creation": 1700000000,
      "owner": "5511888888888@s.whatsapp.net",
      "participants": [
        {
          "id": "5511999999999@s.whatsapp.net",
          "admin": null
        }
      ]
    }
  ],
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:42:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `group-participants.update`

```json
{
  "event": "group-participants.update",
  "instance": "minha-instancia",
  "data": {
    "id": "120363000000000000@g.us",
    "participants": ["5511999999999@s.whatsapp.net"],
    "action": "add",
    "participantsData": [
      {
        "jid": "5511999999999@s.whatsapp.net",
        "phoneNumber": "5511999999999",
        "name": "Maria",
        "imgUrl": "https://pps.whatsapp.net/example.jpg"
      }
    ]
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:43:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `call`

```json
{
  "event": "call",
  "instance": "minha-instancia",
  "data": {
    "event": "CB:call",
    "packet": {
      "attrs": {
        "from": "5511999999999@s.whatsapp.net",
        "id": "call-id-123"
      },
      "content": []
    }
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:44:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `typebot.start`

```json
{
  "event": "typebot.start",
  "instance": "minha-instancia",
  "data": {
    "remoteJid": "5511999999999@s.whatsapp.net",
    "url": "https://typebot.example.com",
    "typebot": "atendimento",
    "variables": [
      {
        "name": "nome",
        "value": "Maria"
      }
    ],
    "sessionId": "session_123"
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:45:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `typebot.change-status`

```json
{
  "event": "typebot.change-status",
  "instance": "minha-instancia",
  "data": {
    "remoteJid": "5511999999999@s.whatsapp.net",
    "status": "opened",
    "session": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "sessionId": "session_123",
      "createdAt": 1710000300
    }
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:46:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `instance.create`

```json
{
  "event": "instance.create",
  "instance": "minha-instancia",
  "data": {
    "instanceName": "minha-instancia",
    "instanceId": "inst_123"
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:47:00.000Z",
  "sender": null,
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `instance.delete`

```json
{
  "event": "instance.delete",
  "instance": "minha-instancia",
  "data": {
    "instanceName": "minha-instancia",
    "instanceId": "inst_123"
  },
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:48:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `remove.instance`

```json
{
  "event": "remove.instance",
  "instance": "minha-instancia",
  "data": null,
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:49:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```

### `logout.instance`

```json
{
  "event": "logout.instance",
  "instance": "minha-instancia",
  "data": null,
  "destination": "https://example.com/webhook",
  "date_time": "2026-05-28T12:50:00.000Z",
  "sender": "5511888888888@s.whatsapp.net",
  "server_url": "https://api.example.com",
  "apikey": "EVOLUTION_INSTANCE_API_KEY"
}
```
