import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BusinessStartupService } from '@api/integrations/channel/meta/whatsapp.business.service';
import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { chatbotController } from '@api/server.module';

const silentLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  log: () => undefined,
  verbose: () => undefined,
  warn: () => undefined,
};

test('Meta contact updates remain scoped to the current instance', async () => {
  const remoteJid = '5511999999999@s.whatsapp.net';
  const contacts = [
    { instanceId: 'instance-a', remoteJid, pushName: 'Alice A' },
    { instanceId: 'instance-b', remoteJid, pushName: 'Alice B' },
  ];
  const updateCalls: any[] = [];
  const service: any = Object.create(BusinessStartupService.prototype);

  Object.assign(service, {
    configService: {
      get: (key: string) =>
        ({
          CHATWOOT: { ENABLED: false },
          OPENAI: { ENABLED: false },
          S3: { ENABLE: false },
        })[key] ?? {},
    },
    instance: { id: 'instance-a', name: 'alpha' },
    instanceId: 'instance-a',
    localChatwoot: { enabled: false },
    localSettings: { readMessages: false },
    localWebhook: { enabled: false, webhookBase64: false },
    logger: silentLogger,
    prismaRepository: {
      contact: {
        findFirst: async ({ where }: any) =>
          contacts.find((contact) => contact.instanceId === where.instanceId && contact.remoteJid === where.remoteJid),
        updateMany: async ({ where, data }: any) => {
          updateCalls.push({ where, data });
          contacts.forEach((contact) => {
            if (contact.remoteJid === where.remoteJid && contact.instanceId === where.instanceId) {
              contact.pushName = data.pushName;
            }
          });
        },
      },
      message: {
        create: async () => ({ id: 'message-row' }),
      },
    },
    sendDataWebhook: () => undefined,
  });

  const originalEmit = chatbotController.emit;
  chatbotController.emit = async () => undefined;

  try {
    await service.messageHandle(
      {
        contacts: [{ profile: { name: 'Updated Alice', phone: '5511999999999' }, wa_id: '5511999999999' }],
        messages: [
          {
            from: '5511999999999',
            id: 'wamid-1',
            text: { body: 'hello' },
            timestamp: '1710000000',
            type: 'text',
          },
        ],
        metadata: { display_phone_number: '5511888888888', phone_number_id: 'phone-number-id' },
      },
      {},
      {},
    );
  } finally {
    chatbotController.emit = originalEmit;
  }

  assert.deepEqual(updateCalls[0]?.where, { instanceId: 'instance-a', remoteJid });
  assert.equal(contacts[0].pushName, 'Updated Alice');
  assert.equal(contacts[1].pushName, 'Alice B');
});

test('logout continues cleanup when the socket logout fails', async () => {
  const updates: any[] = [];
  const service: any = Object.create(BaileysStartupService.prototype);

  Object.assign(service, {
    client: {
      end: () => undefined,
      logout: async () => {
        throw new Error('dead socket');
      },
      ws: { close: () => undefined },
    },
    configService: {
      get: (key: string) =>
        ({
          CACHE: { REDIS: { ENABLED: false, SAVE_INSTANCES: false } },
          DATABASE: { SAVE_DATA: { INSTANCE: false } },
          PROVIDER: { ENABLED: false },
        })[key],
    },
    endSession: false,
    instance: { id: 'instance-row', name: 'alpha' },
    instanceId: 'instance-a',
    logger: silentLogger,
    messageProcessor: { onDestroy: () => undefined },
    prismaRepository: {
      instance: { update: async (args: any) => updates.push(args) },
      session: { findFirst: async () => null },
    },
    stateConnection: { state: 'open' },
  });

  await service.logoutInstance();

  assert.equal(service.endSession, true);
  assert.deepEqual(service.stateConnection, { state: 'close', statusReason: 401 });
  assert.deepEqual(updates, [{ where: { id: 'instance-a' }, data: { connectionStatus: 'close' } }]);
});

test('optional Baileys methods preserve LID support and protocol arguments', async () => {
  const receipts: any[] = [];
  const memberModes: any[] = [];
  const service: any = Object.create(BaileysStartupService.prototype);

  Object.assign(service, {
    client: {
      groupMemberAddMode: async (...args: any[]) => memberModes.push(args),
      sendReceipts: async (...args: any[]) => receipts.push(args),
      signalRepository: {
        lidMapping: { getLIDForPN: async () => '123456789@lid' },
      },
    },
    logger: silentLogger,
  });

  assert.deepEqual(await service.getLid('5511999999999'), {
    wuid: '5511999999999@s.whatsapp.net',
    lid: '123456789@lid',
  });

  await service.markMessageAsPlayed({
    playedMessages: [
      { fromMe: false, id: 'lid-message', remoteJid: '123456789@lid' },
      { fromMe: false, id: 'newsletter-message', remoteJid: '123@newsletter' },
    ],
  });
  await service.updateMemberAddMode({ groupJid: '120363000000000000@g.us', mode: 'admin_add' });

  assert.deepEqual(receipts, [[[{ remoteJid: '123456789@lid', fromMe: false, id: 'lid-message' }], 'played']]);
  assert.deepEqual(memberModes, [['120363000000000000@g.us', 'admin_add']]);
});
