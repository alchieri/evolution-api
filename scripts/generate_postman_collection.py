#!/usr/bin/env python3
"""Generate a complete Postman collection from Evolution API route files."""

from __future__ import annotations

import json
import pathlib
import re
from typing import Dict, List, Tuple

ROOT = pathlib.Path(__file__).resolve().parents[1]

ROUTE_FILES = [
  'src/api/routes/index.router.ts',
  'src/api/routes/instance.router.ts',
  'src/api/routes/sendMessage.router.ts',
  'src/api/routes/chat.router.ts',
  'src/api/routes/group.router.ts',
  'src/api/routes/business.router.ts',
  'src/api/routes/template.router.ts',
  'src/api/routes/label.router.ts',
  'src/api/routes/proxy.router.ts',
  'src/api/routes/settings.router.ts',
  'src/api/routes/call.router.ts',
  'src/api/integrations/channel/whatsapp/baileys.router.ts',
  'src/api/integrations/channel/meta/meta.router.ts',
  'src/api/integrations/channel/evolution/evolution.router.ts',
  'src/api/integrations/event/webhook/webhook.router.ts',
  'src/api/integrations/event/websocket/websocket.router.ts',
  'src/api/integrations/event/rabbitmq/rabbitmq.router.ts',
  'src/api/integrations/event/sqs/sqs.router.ts',
  'src/api/integrations/event/nats/nats.router.ts',
  'src/api/integrations/event/kafka/kafka.router.ts',
  'src/api/integrations/event/pusher/pusher.router.ts',
  'src/api/integrations/chatbot/chatwoot/routes/chatwoot.router.ts',
  'src/api/integrations/chatbot/openai/routes/openai.router.ts',
  'src/api/integrations/chatbot/typebot/routes/typebot.router.ts',
  'src/api/integrations/chatbot/dify/routes/dify.router.ts',
  'src/api/integrations/chatbot/evolutionBot/routes/evolutionBot.router.ts',
  'src/api/integrations/chatbot/flowise/routes/flowise.router.ts',
  'src/api/integrations/chatbot/n8n/routes/n8n.router.ts',
  'src/api/integrations/chatbot/evoai/routes/evoai.router.ts',
  'src/api/integrations/storage/s3/routes/s3.router.ts',
]

BASE_BY_FILE = {
  'index.router.ts': '',
  'instance.router.ts': '/instance',
  'sendMessage.router.ts': '/message',
  'chat.router.ts': '/chat',
  'group.router.ts': '/group',
  'business.router.ts': '/business',
  'template.router.ts': '/template',
  'label.router.ts': '/label',
  'proxy.router.ts': '/proxy',
  'settings.router.ts': '/settings',
  'call.router.ts': '/call',
  'baileys.router.ts': '/baileys',
  'meta.router.ts': '',
  'evolution.router.ts': '',
  'webhook.router.ts': '/webhook',
  'websocket.router.ts': '/websocket',
  'rabbitmq.router.ts': '/rabbitmq',
  'sqs.router.ts': '/sqs',
  'nats.router.ts': '/nats',
  'kafka.router.ts': '/kafka',
  'pusher.router.ts': '/pusher',
  'chatwoot.router.ts': '/chatwoot',
  'openai.router.ts': '/openai',
  'typebot.router.ts': '/typebot',
  'dify.router.ts': '/dify',
  'evolutionBot.router.ts': '/evolutionBot',
  'flowise.router.ts': '/flowise',
  'n8n.router.ts': '/n8n',
  'evoai.router.ts': '/evoai',
  's3.router.ts': '/s3',
}

GROUP_ORDER = [
  'Geral',
  'Instance',
  'Message',
  'Chat',
  'Group',
  'Business',
  'Template',
  'Label',
  'Proxy',
  'Settings',
  'Call',
  'Baileys',
  'Webhooks Canal',
  'Eventos',
  'Chatbots',
  'S3',
]

ROUTER_PATH_RE = re.compile(r"\.(get|post|put|patch|delete)\(this\.routerPath\('([^']+)'(?:,\s*(false|true))?\)")
LITERAL_RE = re.compile(r'\.(get|post|put|patch|delete)\(("|\')(/[^"\']+)\2')


def classify(path: str) -> str | None:
  if path.startswith('/instance'):
    return 'Instance'
  if path.startswith('/message'):
    return 'Message'
  if path.startswith('/chat/'):
    return 'Chat'
  if path.startswith('/group'):
    return 'Group'
  if path.startswith('/business'):
    return 'Business'
  if path.startswith('/template'):
    return 'Template'
  if path.startswith('/label'):
    return 'Label'
  if path.startswith('/proxy'):
    return 'Proxy'
  if path.startswith('/settings'):
    return 'Settings'
  if path.startswith('/call'):
    return 'Call'
  if path.startswith('/baileys'):
    return 'Baileys'
  if path in {'/webhook/meta', '/webhook/evolution'}:
    return 'Webhooks Canal'
  if path.startswith(('/webhook/', '/websocket/', '/rabbitmq/', '/sqs/', '/nats/', '/kafka/', '/pusher/')):
    return 'Eventos'
  if path.startswith(('/openai/', '/typebot/', '/dify/', '/chatwoot/', '/evolutionBot/', '/flowise/', '/n8n/', '/evoai/')):
    return 'Chatbots'
  if path.startswith('/s3/'):
    return 'S3'
  return None


def normalize_path(path: str) -> str:
  fixed = path
  for variable in [
    'instanceName',
    'openaiCredsId',
    'openaiBotId',
    'typebotId',
    'difyId',
    'evolutionBotId',
    'flowiseId',
    'n8nId',
    'evoaiId',
  ]:
    fixed = fixed.replace(f':{variable}', f'{{{{{variable}}}}}')
  return f'{{{{baseUrl}}}}{fixed}'


def description(group: str, path: str) -> str:
  lines = [
    f'Endpoint do grupo {group}.',
    'Ajuste o payload e query params conforme os schemas da rota.',
  ]
  if '/:instanceName' in path:
    lines.append('Rota multi-tenant: requer `instanceName` no path.')
  if path not in {'/', '/webhook/meta', '/webhook/evolution'}:
    lines.append('Autenticação: enviar header `apikey`.')
  return '\n'.join(lines)


def build_collection() -> Dict:
  groups: Dict[str, List[Tuple[str, str]]] = {group: [] for group in GROUP_ORDER}

  def add(group: str, method: str, path: str) -> None:
    item = (method, path)
    if item not in groups[group]:
      groups[group].append(item)

  for relative_file in ROUTE_FILES:
    file_path = ROOT / relative_file
    content = file_path.read_text(encoding='utf-8')
    file_name = pathlib.Path(relative_file).name
    base = BASE_BY_FILE[file_name]

    for method, route_path, param_flag in ROUTER_PATH_RE.findall(content):
      full_path = (f'{base}/{route_path}').replace('//', '/')
      if param_flag != 'false':
        full_path += '/:instanceName'

      group = classify(full_path)
      if group:
        add(group, method.upper(), full_path)

    if file_name == 'index.router.ts':
      for method, _, literal_path in LITERAL_RE.findall(content):
        if literal_path in {'/', '/verify-creds', '/metrics'}:
          add('Geral', method.upper(), literal_path)

  collection = {
    'info': {
      'name': 'Evolution API - Collection Completa (PT-BR)',
      'description': 'Collection completa gerada automaticamente a partir das rotas do projeto.',
      'schema': 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    'auth': {'type': 'noauth'},
    'variable': [
      {'key': 'baseUrl', 'value': 'http://localhost:8080'},
      {'key': 'apikey', 'value': 'SUA_API_KEY'},
      {'key': 'instanceName', 'value': 'minha-instancia'},
      {'key': 'openaiCredsId', 'value': '1'},
      {'key': 'openaiBotId', 'value': '1'},
      {'key': 'typebotId', 'value': '1'},
      {'key': 'difyId', 'value': '1'},
      {'key': 'evolutionBotId', 'value': '1'},
      {'key': 'flowiseId', 'value': '1'},
      {'key': 'n8nId', 'value': '1'},
      {'key': 'evoaiId', 'value': '1'},
    ],
    'item': [],
  }

  for group_name in GROUP_ORDER:
    folder = {'name': group_name, 'item': []}
    for method, raw_path in groups[group_name]:
      endpoint = {
        'name': f'{method} {raw_path}',
        'request': {
          'method': method,
          'header': []
          if raw_path in {'/', '/webhook/meta', '/webhook/evolution'}
          else [{'key': 'apikey', 'value': '{{apikey}}'}],
          'description': description(group_name, raw_path),
          'url': normalize_path(raw_path),
        },
        'response': [],
      }

      if method in {'POST', 'PUT', 'PATCH'}:
        endpoint['request']['body'] = {
          'mode': 'raw',
          'raw': '{}',
          'options': {'raw': {'language': 'json'}},
        }

      folder['item'].append(endpoint)

    collection['item'].append(folder)

  return collection


def main() -> None:
  collection = build_collection()
  output_file = ROOT / 'postman.evolution-api.completa.collection.json'
  output_file.write_text(json.dumps(collection, ensure_ascii=False, indent=2), encoding='utf-8')

  total = sum(len(folder['item']) for folder in collection['item'])
  print(f'Collection criada em: {output_file}')
  print(f'Total de endpoints: {total}')


if __name__ == '__main__':
  main()
