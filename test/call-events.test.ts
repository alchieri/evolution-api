import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callingCapabilities, dispatchCallEvents, unsupportedCall } from '../src/utils/call-events';

test('every event in a call batch is delivered and provider LID is preserved', async () => {
  const calls = [
    { id: '1', from: '123@lid', status: 'offer' },
    { id: '2', from: '456@s.whatsapp.net', status: 'timeout' },
  ];
  const published: string[] = [];
  const rejected: string[] = [];
  await dispatchCallEvents(calls, {
    reject: async (call) => {
      rejected.push(call.id);
    },
    publish: (call) => {
      published.push(call.id);
    },
  });
  assert.deepEqual(published, ['1', '2']);
  assert.deepEqual(rejected, ['1']);
  assert.equal(calls[0].from, '123@lid');
});

test('unavailable calling never reports a fake success', () => {
  assert.equal(callingCapabilities.initiate, false);
  assert.throws(unsupportedCall, (error: { status: number }) => error.status === 501);
});

test('one automatic rejection failure does not discard the rest of the batch', async () => {
  const published: string[] = [];
  await assert.rejects(
    dispatchCallEvents(
      [
        { id: '1', from: '123@lid', status: 'offer' },
        { id: '2', from: '456@lid', status: 'timeout' },
      ],
      {
        reject: async () => {
          throw new Error('socket unavailable');
        },
        publish: (call) => {
          published.push(call.id);
        },
      },
    ),
  );
  assert.deepEqual(published, ['1', '2']);
});
