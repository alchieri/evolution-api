import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessRecipient, businessRemoteId } from '../src/utils/whatsappBusinessIdentity';
test('BSUID and parent BSUID stay opaque in outbound and inbound identities', () => {
  for (const id of ['BR.AbC123', 'US.ENT.XyZ123']) {
    assert.deepEqual(businessRecipient(id), { recipient: id });
    assert.equal(businessRemoteId(id), id);
  }
  assert.deepEqual(businessRecipient('+55 (11) 99999-8888'), {to: '5511999998888'});
  assert.equal(businessRemoteId('5511999998888'), '5511999998888@s.whatsapp.net');
  assert.throws(() => businessRecipient('broken.Id123'));
});
