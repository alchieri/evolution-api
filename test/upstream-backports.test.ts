import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BusinessStartupService } from '@api/integrations/channel/meta/whatsapp.business.service';
import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { buildInteractiveBizNode } from '@api/integrations/channel/whatsapp/helpers/interactiveMessage.helper';
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service';
import { chatbotController } from '@api/server.module';
import { createJid } from '@utils/createJid';

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
  const deliveryOrder: string[] = [];
  let persistedMessage: any;
  const service: any = Object.create(BusinessStartupService.prototype);

  Object.assign(service, {
    configService: {
      get: (key: string) =>
        ({
          CHATWOOT: { ENABLED: true },
          OPENAI: { ENABLED: false },
          S3: { ENABLE: false },
        })[key] ?? {},
    },
    instance: { id: 'instance-a', name: 'alpha' },
    instanceId: 'instance-a',
    chatwootService: {
      eventWhatsapp: async (event: string) => {
        if (event === 'messages.upsert') deliveryOrder.push('chatwoot');
        return { id: 101, inbox_id: 202, conversation_id: 303 };
      },
    },
    localChatwoot: { enabled: true },
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
        create: async ({ data }: any) => {
          persistedMessage = data;
          return { id: 'message-row' };
        },
      },
    },
    sendDataWebhook: (event: string) => {
      if (event === 'messages.upsert') deliveryOrder.push('webhook');
    },
  });

  const originalEmit = chatbotController.emit;
  chatbotController.emit = async () => {
    deliveryOrder.push('chatbot');
  };

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
  assert.deepEqual(deliveryOrder, ['chatwoot', 'webhook', 'chatbot']);
  assert.equal(persistedMessage.chatwootMessageId, 101);
  assert.equal(persistedMessage.chatwootInboxId, 202);
  assert.equal(persistedMessage.chatwootConversationId, 303);
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

test('newsletter JIDs are preserved and channel discovery is paginated', async () => {
  assert.equal(createJid('120363123456789@newsletter'), '120363123456789@newsletter');

  const service: any = Object.create(BaileysStartupService.prototype);
  Object.assign(service, {
    instance: { id: 'instance-a', name: 'alpha' },
    instanceId: 'instance-a',
    prismaRepository: {
      message: {
        findMany: async () => [
          { key: { remoteJid: '111@newsletter' }, messageTimestamp: 30 },
          { key: { remoteJid: '5511999999999@s.whatsapp.net' }, messageTimestamp: 20 },
          { key: { remoteJid: '111@newsletter' }, messageTimestamp: 10 },
          { key: { remoteJid: '222@newsletter' }, messageTimestamp: 5 },
        ],
      },
    },
  });

  assert.deepEqual(await service.fetchChannels({ page: 2, offset: 1 }), {
    total: 2,
    pages: 2,
    currentPage: 2,
    offset: 1,
    records: [{ remoteJid: '222@newsletter', lastMessageTimestamp: 5 }],
  });
});

test('stored poll votes are aggregated by the latest vote per user', async () => {
  const service: any = Object.create(BaileysStartupService.prototype);
  const pollKey = { id: 'poll-1', remoteJid: 'group@g.us' };
  const pollCreation = {
    key: pollKey,
    message: {
      messageContextInfo: { messageSecret: Buffer.alloc(32) },
      pollCreationMessage: { name: 'Lunch', options: [{ optionName: 'A' }, { optionName: 'B' }] },
    },
  };

  Object.assign(service, {
    client: { user: { id: '5511000000000@s.whatsapp.net' } },
    getMessage: async (_key: unknown, full: boolean) => (full ? pollCreation : pollCreation.message),
    instance: { wuid: '5511000000000@s.whatsapp.net' },
    instanceId: 'instance-a',
    prismaRepository: {
      message: {
        findMany: async () => [
          {
            key: { remoteJid: 'group@g.us', participant: '5511999999999@s.whatsapp.net' },
            message: {
              pollUpdateMessage: {
                pollCreationMessageKey: pollKey,
                vote: { selectedOptions: ['A'] },
              },
            },
            messageTimestamp: 10,
          },
          {
            key: { remoteJid: 'group@g.us', participant: '5511999999999@s.whatsapp.net' },
            message: {
              pollUpdateMessage: {
                pollCreationMessageKey: pollKey,
                vote: { selectedOptions: ['B'] },
              },
            },
            messageTimestamp: 20,
          },
        ],
      },
    },
  });

  const result = await service.baileysDecryptPollVote(pollKey);
  assert.equal(result.poll.totalVotes, 1);
  assert.deepEqual(result.poll.results.A, { votes: 0, voters: [] });
  assert.deepEqual(result.poll.results.B, { votes: 1, voters: ['5511999999999@s.whatsapp.net'] });
});

test('carousel relays an interactive message with the required biz node', async () => {
  const calls: any[] = [];
  const service: any = Object.create(BaileysStartupService.prototype);
  Object.assign(service, {
    generateRandomId: () => 'button-id',
    mapKeyType: new Map(),
    sendMessageWithTyping: async (...args: any[]) => {
      calls.push(args);
      return { key: { id: 'message-id' } };
    },
  });

  await service.carouselMessage({
    number: '5511999999999',
    body: 'Offers',
    cards: [{ body: 'Offer A', buttons: [{ type: 'reply', displayText: 'Choose' }] }],
  });

  assert.equal(calls[0][1].interactiveMessage.body.text, 'Offer A');
  assert.deepEqual(calls[0][4], [buildInteractiveBizNode()]);
});

test('Chatwoot LID and order caches remain isolated by instance', async () => {
  const service: any = Object.create(ChatwootService.prototype);
  Object.assign(service, {
    LID_CACHE_TTL_MS: 3_600_000,
    ORDER_CACHE_TTL_MS: 30_000,
    lidToPhoneMap: new Map(),
    processedOrderIds: new Map(),
    logger: silentLogger,
  });

  service.saveLidMapping('alpha', '123@lid', '5511000000001@s.whatsapp.net');
  service.saveLidMapping('beta', '123@lid', '5511000000002@s.whatsapp.net');

  assert.equal(
    await service.resolveLidToPhone({ instanceName: 'alpha' }, { remoteJid: '123@lid' }),
    '5511000000001@s.whatsapp.net',
  );
  assert.equal(
    await service.resolveLidToPhone({ instanceName: 'beta' }, { remoteJid: '123@lid' }),
    '5511000000002@s.whatsapp.net',
  );

  const order = {
    orderMessage: {
      orderId: 'same-order',
      orderTitle: 'Product',
      itemCount: 1,
      totalAmount1000: 10_000,
      totalCurrencyCode: 'BRL',
    },
  };
  assert.match(service.getConversationMessage(order, 'alpha'), /same-order/);
  assert.equal(service.getConversationMessage(order, 'alpha'), undefined);
  assert.match(service.getConversationMessage(order, 'beta'), /same-order/);
});
