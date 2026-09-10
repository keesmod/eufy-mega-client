import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorization,
  versionRequest,
  versionResponse,
  cbcEncrypt,
  cbcDecrypt,
  handshake,
  decodeHandshake,
  signature,
  dataRecord,
  decodeData,
  RecordReader,
} from '../scripts/research/e15-peer-wire.mjs';
const key = Buffer.from('0123456789abcdef');
const iv = Buffer.alloc(16, 7);
const token = {
  credential: 'synthetic-credential-only-123',
  username: 'synthetic-user',
  sessionId: 'synthetic-session',
};
test('application requests match independent original-artifact observations', () => {
  const b = authorization('a'.repeat(32));
  assert.equal(b.length, 104);
  assert.equal(b.readUInt32LE(), 0x12345678);
  assert.equal(b.subarray(8, 40).toString().replaceAll('\0', ''), 'admin');
  assert.equal(
    versionRequest(65536).toString('hex'),
    '7856341200000100000000000a0000000400000000000100',
  );
  const response = versionRequest(65536);
  response.writeUInt32LE(1, 8);
  response.writeUInt32LE(0x10002, 20);
  assert.deepEqual(versionResponse(response, 65536), { major: 1, minor: 2 });
  for (const offset of [0, 4, 8, 12, 14, 16]) {
    const wrong = Buffer.from(response);
    wrong[offset] ^= 1;
    assert.throws(() => versionResponse(wrong, 65536));
  }
  assert.throws(() => versionResponse(Buffer.concat([response, Buffer.alloc(1)]), 65536));
});
test('CBC rejects damaged ciphertext and enforces payload bounds', () => {
  for (const size of [0, 1, 16, 104, 1300]) {
    const plain = Buffer.alloc(size, 9);
    assert.deepEqual(cbcDecrypt(key, cbcEncrypt(key, iv, plain)), plain);
  }
  const encrypted = cbcEncrypt(key, iv, Buffer.alloc(16));
  encrypted[31] ^= 1;
  assert.throws(() => cbcDecrypt(key, encrypted));
  assert.throws(() => cbcEncrypt(key, iv, Buffer.alloc(1301)));
});
test('carrier handshake binds phase, token identities, IV, encrypted body and HMAC', () => {
  const data = { method: 'complete', statuscode: 200 };
  const encoded = handshake(token, 3, data, iv);
  assert.deepEqual(decodeHandshake(token, encoded, 3), data);
  for (let i = 0; i < encoded.length; i++) {
    const wrong = Buffer.from(encoded);
    wrong[i] ^= 1;
    assert.throws(() => decodeHandshake(token, wrong, 3));
  }
  assert.throws(() => decodeHandshake({ ...token, sessionId: 'old-session' }, encoded, 3));
  assert.throws(() => decodeHandshake(token, encoded, 1));
  assert.notEqual(signature(token, 'account', 'fresh'), signature(token, 'account', 'stale'));
});
test('data authentication precedes KCP processing', () => {
  const kcp = Buffer.alloc(24, 3),
    encoded = dataRecord(key, kcp);
  assert.deepEqual(decodeData(key, encoded), kcp);
  for (let i = 0; i < encoded.length; i++) {
    const wrong = Buffer.from(encoded);
    wrong[i] ^= 1;
    assert.throws(() => decodeData(key, wrong));
  }
});
test('bounded TCP accumulator handles every split and coalesced records', () => {
  const a = dataRecord(key, Buffer.alloc(24)),
    b = dataRecord(key, Buffer.alloc(48));
  const stream = Buffer.concat([a, b]);
  for (let i = 0; i <= stream.length; i++) {
    const r = new RecordReader();
    assert.deepEqual([...r.push(stream.subarray(0, i)), ...r.push(stream.subarray(i))], [a, b]);
  }
  const r = new RecordReader();
  assert.throws(() => r.push(Buffer.from('f600ffff', 'hex')));
  const fresh = new RecordReader();
  fresh.push(a.subarray(0, 3));
  fresh.clear();
  assert.deepEqual(fresh.push(b), [b]);
});

import { TrialKcp } from '../scripts/research/e15-peer-kcp.mjs';
test('KCP sends one auth and one query with no retries, suppresses duplicate data', () => {
  const sender = new TrialKcp(),
    receiver = new TrialKcp();
  const a = sender.send(Buffer.from('auth'), 123),
    b = sender.send(Buffer.from('query'), 124);
  assert.throws(() => sender.send(Buffer.from('retry'), 125));
  assert.deepEqual(receiver.receive(b).messages, []);
  assert.deepEqual(receiver.receive(a).messages, [Buffer.from('auth'), Buffer.from('query')]);
  assert.deepEqual(receiver.receive(a).messages, []);
  const wrong = Buffer.from(a);
  wrong.writeUInt32LE(1);
  assert.throws(() => receiver.receive(wrong));
  receiver.close();
  assert.throws(() => receiver.receive(a));
});
test('KCP rejects oversized, truncated and invalid fragment sequences', () => {
  const sender = new TrialKcp(),
    receiver = new TrialKcp();
  const a = sender.send(Buffer.alloc(24), 123);
  a[5] = 2;
  const b = sender.send(Buffer.alloc(24), 124);
  b[5] = 0;
  receiver.receive(a);
  assert.throws(() => receiver.receive(b));
  for (const bytes of [Buffer.alloc(23), Buffer.from(a.subarray(0, 25))])
    assert.throws(() => new TrialKcp().receive(bytes));
});

import { signalEnvelope, decodeSignal } from '../scripts/research/e15-linux-peer.mjs';
test('GCM response admission binds fresh time, peer, session and relay identity', () => {
  const header = Buffer.alloc(12);
  header.write('2.3');
  const expected = {
    from: 'synthetic-peer',
    to: 'synthetic-account',
    sessionid: 'new-session',
    moto_id: '',
  };
  const now = 1700000000000;
  const message = { header: { ...expected, type: 'answer' }, msg: {} };
  const payload = signalEnvelope(key, header, message, now);
  assert.deepEqual(decodeSignal(key, payload, expected, now), message);
  for (const field of Object.keys(expected))
    assert.throws(() => decodeSignal(key, payload, { ...expected, [field]: 'wrong' }, now));
  assert.throws(() => decodeSignal(key, payload, expected, now + 61000));
  for (const offset of [4, 13, payload.length - 1]) {
    const changed = Buffer.from(payload);
    changed[offset] ^= 1;
    assert.throws(() => decodeSignal(key, changed, expected, now));
  }
});

test('private provisioning rejects missing expiry and foreign routes before I/O', async () => {
  const { validateInputs, matchingToken } = await import('../scripts/research/e15-linux-peer.mjs');
  const now = 1000000;
  const input = {
    expiresAt: now + 120000,
    accountUid: 'synthetic-user',
    peer: 'synthetic-peer',
    localKey: '0123456789abcdef',
    password: 'synthetic-password',
    motoId: '',
    preconnect: false,
    iceTokens: [],
    mqtt: { clientId: 'example/mb/synthetic-user' },
    mqttHeader: '322e33000000000000000000',
    subscribeTopics: ['smart/mb/in/synthetic-peer'],
    publishTopic: 'smart/mb/out/synthetic-peer',
    tcpToken: {
      credential: 'synthetic-credential-only',
      username: 'synthetic-user',
      urls: ['tcp4:example.invalid:443'],
    },
  };
  assert.doesNotThrow(() => validateInputs(input, now));
  for (const patch of [
    { expiresAt: undefined },
    { expiresAt: '1200000' },
    { expiresAt: now },
    { subscribeTopics: ['smart/mb/in/+'] },
    { publishTopic: 'smart/mb/out/foreign' },
    { localKey: 'short' },
    { peer: '' },
  ]) {
    assert.throws(() => validateInputs({ ...input, ...patch }, now), /invalid-private-inputs/);
  }
  assert.throws(() => validateInputs(null, now));
  const expected = { ...input.tcpToken, domain: 'example.invalid', sessionId: 'fresh' };
  const reordered = Object.fromEntries(Object.entries(expected).reverse());
  assert.equal(matchingToken(reordered, expected), true);
  assert.equal(matchingToken({ ...reordered, sessionId: 'old' }, expected), false);
  assert.equal(Boolean(matchingToken(undefined, expected)), false);
});
