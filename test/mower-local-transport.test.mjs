import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { inspect } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyClient } from '../dist/index.js';
import {
  Command,
  FrameReader,
  decodeFrame,
  decodeStatus,
  deriveSessionKey,
  encodeFrame,
  localKeyBytes,
  sessionKeyFinish,
  splitReturnCode,
  verifySessionKeyResponse,
  MAX_FRAME_LENGTH,
} from '../dist/mowers/local/frame.js';
import { fakeMower, localKey, deviceId } from './fixtures/local-mower.mjs';
import { cloud, credentials, memory, mowerClient } from './fixtures/mower-cloud.mjs';

const key = Buffer.from(localKey);

async function settled(peer) {
  for (let i = 0; i < 400 && peer.live; i++) await delay(5);
}
function resources() {
  const info = process.getActiveResourcesInfo();
  return {
    sockets: info.filter((name) => name === 'TCPSocketWrap').length,
    timers: info.filter((name) => name === 'Timeout').length,
  };
}
const local = (peer, extra = {}) => ({ host: peer.host, port: peer.port, ...extra });

test('frame vectors match the independently reproduced tinytuya 1.20.0 encoding', () => {
  // Reference bytes reproduced with tinytuya 1.20.0 (MIT). See docs/MOWER_TRANSPORT_PROVENANCE.md.
  const nonce = Buffer.from('000102030405060708090a0b', 'hex');
  const clientNonce = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  const deviceNonce = Buffer.from('101112131415161718191a1b1c1d1e1f', 'hex');
  assert.equal(
    encodeFrame(key, 7, Command.DP_QUERY_NEW, Buffer.from('{}'), nonce).toString('hex'),
    '00006699000000000007000000100000001e000102030405060708090a0bca65c2b788946f3b72a9ef08a69eaa9b080500009966',
  );
  assert.equal(
    encodeFrame(key, 1, Command.SESSION_KEY_START, clientNonce, nonce).toString('hex'),
    '00006699000000000001000000030000002c000102030405060708090a0bb11947acb679d71648ec9ef5b0573a4c6a9472c33542e49659af4a2f703eac2a00009966',
  );
  const finish = sessionKeyFinish(key, deviceNonce);
  assert.equal(
    finish.toString('hex'),
    '1a844d808b240cae681e5f1bd729331cdd2934256f760ad85ce409016f0bcc10',
  );
  assert.equal(
    encodeFrame(key, 2, Command.SESSION_KEY_FINISH, finish, nonce).toString('hex'),
    '00006699000000000002000000050000003c000102030405060708090a0bab9c082f3958ddbf28fbcbe56b73075f9a16f9d8ab977139c1b06e7902f0590ce0c889f895abd5d27a6606935000d29900009966',
  );
  assert.equal(
    deriveSessionKey(key, clientNonce, deviceNonce).toString('hex'),
    'a10855bfa26cc10150f584eeac4a2453',
  );
  const proof = Buffer.from(
    '000102030405060708090a0b0c0d0e0f' +
      '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  );
  assert.throws(() => verifySessionKeyResponse(key, clientNonce, proof), {
    code: 'mower_local_authentication_failed',
  });
  const reply = Buffer.from(
    '000066990000000000090000001000000040000102030405060708090a0bb11845afc95eb56133c7ae859e6b1679334db898b9cd5985f8222e1c4fc1b74fb7014c08f17e142a388d4bc1843646d91a04b80c00009966',
    'hex',
  );
  const decoded = decodeFrame(key, reply);
  assert.deepEqual([decoded.sequence, decoded.command], [9, Command.DP_QUERY_NEW]);
  const { accepted, data } = splitReturnCode(decoded.plaintext);
  assert.equal(accepted, true);
  assert.deepEqual(decodeStatus(data), { dps: { 1: true }, deviceId: 'SYN' });
});

test('frame codec round trips, rejects every tampered byte and enforces bounds', () => {
  for (const size of [0, 1, 2, 48, 1000, 4046]) {
    const plain = Buffer.alloc(size, 0x5a);
    const decoded = decodeFrame(key, encodeFrame(key, 12, 0x10, plain));
    assert.deepEqual([decoded.sequence, decoded.command], [12, 0x10]);
    assert.deepEqual(decoded.plaintext, plain);
  }
  const frame = encodeFrame(key, 3, 0x10, Buffer.from('{"dps":{}}'));
  for (let i = 0; i < frame.length; i++) {
    const wrong = Buffer.from(frame);
    wrong[i] ^= 1;
    assert.throws(
      () => decodeFrame(key, wrong),
      (error) =>
        ['mower_local_protocol_error', 'mower_local_authentication_failed'].includes(error.code),
    );
  }
  assert.throws(() => decodeFrame(Buffer.from('other-synthetic-'), frame), {
    code: 'mower_local_authentication_failed',
  });
  assert.throws(() => decodeFrame(key, frame.subarray(0, frame.length - 1)), {
    code: 'mower_local_protocol_error',
  });
  assert.throws(() => encodeFrame(key, 1, 0x10, Buffer.alloc(4047)), {
    code: 'mower_local_protocol_error',
  });
  for (const [k, sequence, command] of [
    [Buffer.alloc(15), 1, 0x10],
    [key, -1, 0x10],
    [key, 2 ** 32, 0x10],
    [key, 1, 1.5],
  ])
    assert.throws(() => encodeFrame(k, sequence, command, Buffer.alloc(1)), {
      code: 'mower_local_protocol_error',
    });
  assert.throws(() => splitReturnCode(Buffer.alloc(3)), { code: 'mower_local_protocol_error' });
  assert.equal(splitReturnCode(Buffer.from([0, 0, 0, 1, 0x7b])).accepted, false);
  assert.equal(splitReturnCode(Buffer.from([1, 0, 0, 0])).accepted, false);
  assert.deepEqual(splitReturnCode(Buffer.from([0, 0, 0, 0, 0x7b])).data, Buffer.from('{'));
});

test('the stream reader handles split and coalesced frames and rejects misaligned or oversized input', () => {
  const a = encodeFrame(key, 1, 0x10, Buffer.from('a'));
  const b = encodeFrame(key, 2, 0x08, Buffer.from('bb'));
  const joined = Buffer.concat([a, b]);
  const reader = new FrameReader();
  const frames = [];
  for (const byte of joined) {
    reader.push(Buffer.from([byte]));
    for (let frame = reader.next(); frame; frame = reader.next()) frames.push(frame);
  }
  assert.deepEqual(frames, [a, b]);
  assert.equal(reader.pending, 0);
  reader.push(joined);
  assert.deepEqual([reader.next(), reader.next(), reader.next()], [a, b, undefined]);
  const misaligned = new FrameReader();
  misaligned.push(Buffer.concat([Buffer.from('xx'), a]));
  assert.throws(() => misaligned.next(), { code: 'mower_local_protocol_error' });
  const oversized = new FrameReader();
  const header = Buffer.from(a.subarray(0, 18));
  header.writeUInt32BE(MAX_FRAME_LENGTH, 14);
  oversized.push(header);
  assert.throws(() => oversized.next(), { code: 'mower_local_protocol_error' });
  const short = new FrameReader();
  const tiny = Buffer.from(a.subarray(0, 18));
  tiny.writeUInt32BE(27, 14);
  short.push(tiny);
  assert.throws(() => short.next(), { code: 'mower_local_protocol_error' });
  const flooded = new FrameReader();
  assert.throws(() => flooded.push(Buffer.alloc(2 * MAX_FRAME_LENGTH + 1)), {
    code: 'mower_local_protocol_error',
  });
  flooded.clear();
  assert.equal(flooded.pending, 0);
});

test('status decoding accepts documented report shapes and rejects invalid documents', () => {
  assert.deepEqual(decodeStatus(Buffer.from('{"dps":{"1":true,"101":"x"},"devId":"SYN"}')), {
    dps: { 1: true, 101: 'x' },
    deviceId: 'SYN',
  });
  const report = Buffer.concat([
    Buffer.from('3.5'),
    Buffer.alloc(12),
    Buffer.from('{"protocol":4,"t":1,"data":{"dps":{"6":87,"7":[1,{"a":null}]}}}'),
  ]);
  assert.deepEqual(decodeStatus(report), { dps: { 6: 87, 7: [1, { a: null }] } });
  for (const bad of [
    '',
    'null',
    '[]',
    '{}',
    '{"dps":[]}',
    '{"dps":{"0":1}}',
    '{"dps":{"abc":1}}',
    '{"dps":{"1":1},"devId":5}',
    '{"dps":{"1":' + '['.repeat(20) + ']'.repeat(20) + '}}',
    '{"data":{"dps":5}}',
    'not json',
  ])
    assert.throws(() => decodeStatus(Buffer.from(bad)), { code: 'mower_local_protocol_error' });
  const many = Object.fromEntries(Array.from({ length: 513 }, (_, i) => [String(i + 1), i]));
  assert.throws(() => decodeStatus(Buffer.from(JSON.stringify({ dps: many }))), {
    code: 'mower_local_protocol_error',
  });
  assert.equal(localKeyBytes(localKey).length, 16);
  for (const bad of ['short', 'with space key16', 'seventeen-chars-x', 'ünïcödé-key-1234'])
    assert.throws(() => localKeyBytes(bad), { code: 'mower_local_key_invalid' });
  assert.throws(() => verifySessionKeyResponse(key, Buffer.alloc(16), Buffer.alloc(47)), {
    code: 'mower_local_protocol_error',
  });
});

test('a consumer opens a read-only session through the mower module, receives a typed snapshot and disconnects cleanly', async (t) => {
  const peer = await fakeMower(t);
  const { mowers, id } = await mowerClient(t);
  const before = resources();
  const session = await mowers.openLocalSession(id, local(peer));
  assert.equal(session.connected, true);
  const snapshot = await session.queryStatus();
  // The device confirms nothing after step three. A completed query proves the shared key.
  assert.equal(peer.negotiated, 1);
  assert.equal(snapshot.source, 'local-tuya-3.5');
  assert.ok(snapshot.observedAt.endsWith('Z') && !Number.isNaN(Date.parse(snapshot.observedAt)));
  assert.deepEqual(snapshot.dps, {
    1: true,
    3: 'STANDBY',
    6: 87,
    101: { nested: [1, 2, 'x'] },
    102: null,
  });
  assert.deepEqual(Object.keys(snapshot), ['source', 'observedAt', 'dps']);
  snapshot.dps[1] = false;
  const again = await session.queryStatus();
  assert.equal(again.dps[1], true);
  assert.deepEqual(
    peer.received.map((frame) => frame.type),
    [3, 5, 0x10, 0x10],
  );
  const sequences = peer.received.map((frame) => frame.sequence);
  assert.equal(sequences[0], 1);
  assert.ok(sequences.every((value, index) => index === 0 || value > sequences[index - 1]));
  await Promise.all([session.disconnect(), session.disconnect()]);
  assert.equal(session.connected, false);
  assert.equal(await session.closed, 'disconnected');
  await settled(peer);
  assert.equal(peer.live, 0);
  assert.deepEqual(resources(), before);
  await assert.rejects(session.queryStatus(), { code: 'mower_local_disconnected' });
  assert.deepEqual(peer.faults, []);
  const shown = inspect(session, { depth: 4 });
  assert.ok(!shown.includes(localKey) && !shown.includes(peer.host) && !shown.includes(deviceId));
});

test('one session serves repeated queries and outlives cloud rediscovery', async (t) => {
  const peer = await fakeMower(t, {
    pushFirst: true,
    globalSequence: true,
    versionHeader: true,
    splitWrites: true,
  });
  const { mowers, id } = await mowerClient(t);
  const session = await mowers.openLocalSession(id, local(peer));
  assert.equal((await session.queryStatus()).dps[3], 'STANDBY');
  await mowers.discover();
  assert.equal((await session.queryStatus()).dps[6], 87);
  assert.equal(peer.connections, 1);
  assert.deepEqual(
    peer.received.map((frame) => frame.type),
    [3, 5, 0x10, 0x10],
  );
  await session.disconnect();
  assert.equal(await session.closed, 'disconnected');
});

test('key negotiation failures are typed and leave no open socket', async (t) => {
  for (const [config, overrides, code] of [
    [{ wrongHmac: true }, {}, 'mower_local_authentication_failed'],
    [{ tamperNegotiation: true }, {}, 'mower_local_authentication_failed'],
    [{}, { key: 'other-synthetic-' }, 'mower_local_disconnected'],
    [{ ignoreUndecryptable: true }, { key: 'other-synthetic-' }, 'request_timeout'],
    [{ dropOnStart: true }, {}, 'mower_local_disconnected'],
    [{ stallNegotiation: true }, {}, 'request_timeout'],
  ]) {
    const peer = await fakeMower(t, config);
    const { mowers, id } = await mowerClient(t, overrides);
    await assert.rejects(mowers.openLocalSession(id, local(peer, { timeoutMs: 300 })), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      return true;
    });
    await settled(peer);
    assert.equal(peer.live, 0);
    assert.equal(peer.negotiated, 0);
    assert.equal(peer.received.filter((frame) => frame.type === 0x10).length, 0);
  }
});

test('query failures are typed, close uncertain sessions and keep a session after a device rejection', async (t) => {
  for (const [config, code, end] of [
    [{ tamperResponse: true }, 'mower_local_authentication_failed', 'authentication_failed'],
    [{ wrongDeviceId: true }, 'mower_local_binding_mismatch', 'protocol_error'],
    [{ garbage: true }, 'mower_local_protocol_error', 'protocol_error'],
    [{ oversized: true }, 'mower_local_protocol_error', 'protocol_error'],
    [{ respond: () => 'not json' }, 'mower_local_protocol_error', 'protocol_error'],
    [{ hang: true }, 'request_timeout', 'timeout'],
    [{ closeInsteadOfAnswer: true }, 'mower_local_disconnected', 'peer_closed'],
  ]) {
    const peer = await fakeMower(t, config);
    const { mowers, id } = await mowerClient(t);
    const session = await mowers.openLocalSession(id, local(peer, { timeoutMs: 300 }));
    await assert.rejects(session.queryStatus(), { code });
    assert.equal(await session.closed, end);
    assert.equal(session.connected, false);
    await assert.rejects(session.queryStatus(), { code: 'mower_local_disconnected' });
    await settled(peer);
    assert.equal(peer.live, 0);
  }
  const peer = await fakeMower(t, { rejectQuery: true });
  const { mowers, id } = await mowerClient(t);
  const session = await mowers.openLocalSession(id, local(peer));
  await assert.rejects(session.queryStatus(), { code: 'mower_local_rejected' });
  assert.equal(session.connected, true);
  await session.disconnect();
  assert.equal(await session.closed, 'disconnected');
});

test('a peer that closes between queries is reported on the next query', async (t) => {
  const peer = await fakeMower(t);
  const { mowers, id } = await mowerClient(t);
  const session = await mowers.openLocalSession(id, local(peer));
  peer.drop();
  assert.equal(await session.closed, 'peer_closed');
  assert.equal(session.connected, false);
  await assert.rejects(session.queryStatus(), { code: 'mower_local_disconnected' });
});

test('caller cancellation is honored before, during connect and during a query', async (t) => {
  const stalled = await fakeMower(t, { stallNegotiation: true });
  const { mowers, id } = await mowerClient(t);
  const early = new AbortController();
  early.abort();
  await assert.rejects(mowers.openLocalSession(id, local(stalled), early.signal), {
    code: 'request_aborted',
  });
  assert.equal(stalled.connections, 0);
  const connecting = new AbortController();
  const opening = mowers.openLocalSession(id, local(stalled), connecting.signal);
  await delay(30);
  connecting.abort();
  await assert.rejects(opening, { code: 'request_aborted' });
  await settled(stalled);
  assert.equal(stalled.live, 0);
  const slow = await fakeMower(t, { delayMs: 2000 });
  const session = await mowers.openLocalSession(id, local(slow));
  const querying = new AbortController();
  const query = session.queryStatus(querying.signal);
  await delay(30);
  querying.abort();
  await assert.rejects(query, { code: 'request_aborted' });
  assert.equal(await session.closed, 'aborted');
  await settled(slow);
  assert.equal(slow.live, 0);
});

test('concurrent operations on one session report mower_local_busy', async (t) => {
  const peer = await fakeMower(t, { delayMs: 100 });
  const { mowers, id } = await mowerClient(t);
  const session = await mowers.openLocalSession(id, local(peer));
  const first = session.queryStatus();
  await assert.rejects(session.queryStatus(), { code: 'mower_local_busy' });
  assert.equal((await first).dps[6], 87);
  await session.disconnect();
});

test('module shutdown closes open and pending sessions and rejects new ones', async (t) => {
  const peer = await fakeMower(t, { delayMs: 2000 });
  const { client, mowers, id } = await mowerClient(t);
  const idle = await mowers.openLocalSession(id, local(peer));
  const active = await mowers.openLocalSession(id, local(peer));
  const query = assert.rejects(active.queryStatus(), { code: 'client_closed' });
  await delay(20);
  await client.shutdown();
  await query;
  assert.equal(await idle.closed, 'shutdown');
  assert.equal(await active.closed, 'shutdown');
  assert.equal(idle.connected, false);
  await settled(peer);
  assert.equal(peer.live, 0);
  await assert.rejects(idle.queryStatus(), { code: 'client_closed' });
  await assert.rejects(mowers.openLocalSession(id, local(peer)), { code: 'client_closed' });
  assert.equal(mowers.lifecycle, 'closed');
});

test('local sessions are gated on authentication, binding, adapter capability and valid options', async (t) => {
  const peer = await fakeMower(t);
  const fresh = new EufyClient({
    mowers: { credentials, sessionStore: memory(), home: { fetch: cloud() } },
  });
  t.after(() => fresh.shutdown());
  await assert.rejects(fresh.mowers.openLocalSession('x', local(peer)), {
    code: 'authentication_required',
  });
  const { mowers, id } = await mowerClient(t);
  await assert.rejects(mowers.openLocalSession('f'.repeat(64), local(peer)), {
    code: 'mower_binding_unavailable',
  });
  for (const options of [
    undefined,
    { host: '' },
    { host: 'bad host' },
    { host: 'x'.repeat(254) },
    { host: peer.host, port: 0 },
    { host: peer.host, port: 70000 },
    { host: peer.host, timeoutMs: 50 },
    { host: peer.host, timeoutMs: 1e6 },
  ])
    await assert.rejects(mowers.openLocalSession(id, options), { code: 'mower_invalid_options' });
  let connected = false;
  const custom = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      adapter: () => ({
        get connected() {
          return connected;
        },
        connect: async () => {
          connected = true;
          return { state: 'connected' };
        },
        shutdown: async () => {
          connected = false;
        },
      }),
    },
  });
  t.after(() => custom.shutdown());
  await custom.mowers.connect();
  await assert.rejects(custom.mowers.openLocalSession(id, local(peer)), {
    code: 'mower_protocol_unavailable',
  });
  const short = await mowerClient(t, { key: 'short' });
  await assert.rejects(short.mowers.openLocalSession(short.id, local(peer)), {
    code: 'mower_local_key_invalid',
  });
  assert.equal(peer.connections, 0);
});

test('an unreachable host reports mower_local_unreachable without retry', async (t) => {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const { mowers, id } = await mowerClient(t);
  await assert.rejects(mowers.openLocalSession(id, { host: '127.0.0.1', port, timeoutMs: 2000 }), {
    code: 'mower_local_unreachable',
  });
});
