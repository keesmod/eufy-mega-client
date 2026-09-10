import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { PortableMapAcquisition, EufyMegaClient } from '../dist/index.js';
import { MapFileReader, FILES } from '../dist/mowers/maps/framing.js';
import { MapLifetime } from '../dist/mowers/maps/lifetime.js';
import { openSocket } from '../dist/mowers/maps/socket.js';
import { fakePeer, provisioning, names, filePacket } from './fixtures/map-peer.mjs';
async function snapshot(adapter) {
  for (let i = 0; i < 200; i++) {
    if (adapter.lastComplete) return adapter.lastComplete;
    await delay(5);
  }
  assert.fail('complete snapshot missing');
}
test('portable public adapter retains complete files, uses one cancel, and closes all owners', async (t) => {
  const peer = fakePeer(t);
  const adapter = new PortableMapAcquisition(peer.inputs);
  const result = await adapter.acquire({ demandMs: 40 });
  assert.equal(result.reason, 'demand_expired');
  assert.equal(result.cancellationConfirmed, true);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(peer.live, 0);
  assert.deepEqual(peer.commands, ['auth', 'version', 'album', 'download', 'cancel']);
  assert.deepEqual(Object.keys(result.lastComplete.files), names);
  const original = adapter.lastComplete.files[names[0]][0];
  result.lastComplete.files[names[0]].fill(0);
  assert.equal(adapter.lastComplete.files[names[0]][0], original);
  assert.equal(typeof EufyMegaClient, 'function');
  await adapter.shutdown();
  adapter.clearLastComplete();
  assert.equal(adapter.lastComplete, undefined);
});
test('quiet time is not completion: later full path replaces the initially empty update during demand', async (t) => {
  const peer = fakePeer(t, {
    download: (p) => {
      p.complete();
      p.later(() => p.file(names[1], 'later-full-path'), 900);
    },
  });
  const adapter = new PortableMapAcquisition(peer.inputs);
  const result = await adapter.acquire({ demandMs: 1150 });
  assert.equal(Buffer.from(result.lastComplete.files[names[1]]).toString(), 'later-full-path');
  assert.equal(result.lastComplete.revision, 2);
  assert.equal(peer.live, 0);
});
for (const kind of [
  'partial',
  'oversized',
  'out-of-order',
  'contradictory',
  'foreign-file',
  'foreign-task',
]) {
  test(`${kind} replacement preserves the prior complete snapshot`, async (t) => {
    const peer = fakePeer(t);
    const adapter = new PortableMapAcquisition(peer.inputs);
    const work = adapter.acquire({ demandMs: 100 });
    const before = await snapshot(adapter);
    if (kind === 'partial') peer.file(names[0], 'x', { end: 0, total: 10 });
    if (kind === 'oversized') peer.file(names[0], 'x', { total: 9 * 1024 * 1024 });
    if (kind === 'out-of-order')
      peer.raw(filePacket(names[0], 99, Buffer.from('x'), { task: peer.task }));
    if (kind === 'contradictory') {
      peer.file(names[0], 'x', { end: 0, total: 2 });
      peer.file(names[0], 'y', { total: 3 });
    }
    if (kind === 'foreign-file') peer.file('secret', 'x');
    if (kind === 'foreign-task') peer.file(names[0], 'x', { task: 0 });
    const result = await work;
    assert.deepEqual(result.lastComplete, before);
    assert.equal(peer.live, 0);
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(result.reason, kind === 'partial' ? 'demand_expired' : 'protocol_error');
  });
}
for (const stop of ['abort', 'disconnect', 'shutdown', 'drop']) {
  test(`${stop} closes active acquisition without uncertain replay`, async (t) => {
    const peer = fakePeer(t);
    const adapter = new PortableMapAcquisition(peer.inputs);
    const abort = new AbortController();
    const work = adapter.acquire({ demandMs: 5000, signal: abort.signal });
    const before = await snapshot(adapter);
    if (stop === 'abort') abort.abort();
    if (stop === 'disconnect') await adapter.disconnect();
    if (stop === 'shutdown') await adapter.shutdown();
    if (stop === 'drop') peer.drop();
    const result = await work;
    assert.deepEqual(result.lastComplete, before);
    assert.equal(peer.live, 0);
    assert.equal(
      result.reason,
      {
        abort: 'aborted',
        disconnect: 'disconnected',
        shutdown: 'shutdown',
        drop: 'connection_failed',
      }[stop],
    );
    assert.equal(result.cancellationConfirmed, stop !== 'drop');
    assert.equal(peer.commands.filter((c) => c === 'download').length, 1);
    if (stop === 'shutdown') await assert.rejects(adapter.acquire(), { code: 'client_closed' });
  });
}
test('concurrent demands fail, a later explicit demand has fresh identities, and partial new sessions retain the old snapshot', async (t) => {
  let attempt = 0;
  const peer = fakePeer(t, {
    download: (p) => {
      if (++attempt === 1) p.complete();
      else p.file(names[0], 'new-partial', { end: 0, total: 20 });
    },
  });
  const adapter = new PortableMapAcquisition(peer.inputs);
  const first = adapter.acquire({ demandMs: 30 });
  await assert.rejects(adapter.acquire(), { code: 'mower_map_busy' });
  const before = (await first).lastComplete;
  const second = await adapter.acquire({ demandMs: 30 });
  assert.deepEqual(second.lastComplete, before);
  assert.equal(new Set(peer.sessions).size, 2);
  assert.equal(peer.commands.filter((c) => c === 'download').length, 2);
  assert.equal(peer.live, 0);
});
test('late data at cancellation cannot change the selected snapshot', async (t) => {
  const peer = fakePeer(t, { cancel: (p) => p.file(names[1], 'late-private-data') });
  const result = await new PortableMapAcquisition(peer.inputs).acquire({ demandMs: 40 });
  assert.equal(Buffer.from(result.lastComplete.files[names[1]]).toString(), 'synthetic-1');
  assert.equal(result.cancellationConfirmed, true);
  assert.equal(peer.live, 0);
});
test('download acceptance can follow files without publishing unaccepted data', async (t) => {
  const peer = fakePeer(t, { delayedAcceptance: true });
  const result = await new PortableMapAcquisition(peer.inputs).acquire({ demandMs: 30 });
  assert.ok(result.lastComplete);
  assert.equal(peer.live, 0);
});
test('wrong cancellation is never confirmed', async (t) => {
  const peer = fakePeer(t, { wrongCancel: true });
  const result = await new PortableMapAcquisition(peer.inputs).acquire({ demandMs: 30 });
  assert.equal(result.cancellationConfirmed, false);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(peer.live, 0);
});
test('unconfirmed cancellation forcibly closes at its own bounded deadline', async (t) => {
  const peer = fakePeer(t, { noCancel: true });
  const result = await new PortableMapAcquisition(peer.inputs).acquire({ demandMs: 20 });
  assert.equal(result.reason, 'cancel_unconfirmed');
  assert.equal(result.cancellationConfirmed, false);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(peer.live, 0);
});
test('abort before I/O and expiry during application negotiation leave no resources', async (t) => {
  const peer = fakePeer(t, { noVersion: true });
  const adapter = new PortableMapAcquisition(peer.inputs);
  const result = await adapter.acquire({ signal: AbortSignal.abort() });
  assert.equal(result.reason, 'aborted');
  assert.equal(peer.closed, 0);
  const pending = await adapter.acquire({ demandMs: 20 });
  assert.equal(pending.reason, 'demand_expired');
  assert.equal(peer.live, 0);
});
test('invalid, stale and foreign bindings fail without leaking provisioning or opening I/O', async (t) => {
  const peer = fakePeer(t);
  for (const mutate of [
    (p) => (p.expiresAt = 0),
    (p) => (p.peer = 'foreign'),
    (p) => (p.mqtt.clientId = 'foreign'),
    (p) => (p.subscribeTopics = ['#']),
    (p) => (p.tcpToken.urls = ['https://other']),
    (p) => (p.localKey = 'secret'),
  ]) {
    const input = provisioning();
    mutate(input);
    assert.throws(() => new PortableMapAcquisition(input), {
      code: 'mower_map_invalid_provisioning',
    });
  }
  const adapter = new PortableMapAcquisition(peer.inputs);
  for (const demandMs of [0, -1, 60001, NaN, 1.5])
    await assert.rejects(adapter.acquire({ demandMs }), { code: 'mower_map_invalid_demand' });
  assert.equal(peer.live, 0);
  assert.equal(JSON.stringify(adapter), '{}');
});
test('wrong authenticated answer token closes before carrier I/O', async (t) => {
  const peer = fakePeer(t, {
    answer: (a) => {
      a.msg.tcp_token = { ...a.msg.tcp_token, username: 'foreign' };
    },
  });
  const result = await new PortableMapAcquisition(peer.inputs).acquire({ demandMs: 100 });
  assert.equal(result.reason, 'protocol_error');
  assert.equal(result.lastComplete, undefined);
  assert.equal(peer.live, 0);
  assert.deepEqual(peer.commands, []);
});
test('typed stream reader preserves every-byte split behavior and fails on contradictory terminal', () => {
  const bytes = filePacket(names[0], 0, Buffer.from('synthetic'));
  for (let split = 0; split <= bytes.length; split++) {
    const r = new MapFileReader(1);
    const result = [...r.push(bytes.subarray(0, split)), ...r.push(bytes.subarray(split))];
    assert.equal(result[0].data.toString(), 'synthetic');
    r.close();
    assert.throws(() => r.push(bytes));
  }
  const r = new MapFileReader(1);
  r.push(filePacket(names[0], 0, Buffer.from('a'), { end: 0, total: 2 }));
  assert.throws(() => r.push(filePacket(names[0], -1, Buffer.alloc(0))));
  assert.equal(FILES.length, 3);
});
test('real TCP owner closes the socket and pending read on hard cancellation', async (t) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const connected = once(server, 'connection');
  const owner = new MapLifetime();
  const io = openSocket(owner, { host: '127.0.0.1', port: server.address().port });
  await io.connect();
  const [remote] = await connected;
  const remoteClosed = once(remote, 'close');
  const read = io.read();
  const rejection = assert.rejects(read);
  assert.equal(await owner.close(), true);
  await rejection;
  await remoteClosed;
  await assert.rejects(io.read());
});

test('cleanup closes all owners even when one close throws and waits for negotiation producers', async () => {
  const owner = new MapLifetime();
  let closed = false,
    settled = false;
  owner.own({
    close: () => {
      throw new Error('synthetic-close-failure');
    },
  });
  owner.own({
    close: async () => {
      closed = true;
      return true;
    },
  });
  const operation = owner.negotiating(
    delay(10).then(() => {
      settled = true;
    }),
  );
  owner.stop('aborted');
  await assert.rejects(operation);
  assert.equal(await owner.close(), false);
  assert.equal(closed, true);
  assert.equal(settled, true);
});

test('cached provisioning is revalidated before every new demand', async (t) => {
  const peer = fakePeer(t);
  const adapter = new PortableMapAcquisition(peer.inputs);
  t.mock.method(Date, 'now', () => peer.inputs.expiresAt);
  await assert.rejects(adapter.acquire(), { code: 'mower_map_invalid_provisioning' });
  assert.equal(peer.live, 0);
});

test('unconfirmed cleanup blocks further acquisition on the instance', async (t) => {
  const peer = fakePeer(t, { cleanupConfirmed: false });
  const adapter = new PortableMapAcquisition(peer.inputs);
  const result = await adapter.acquire({ demandMs: 30 });
  assert.equal(result.reason, 'cleanup_unconfirmed');
  assert.equal(result.cleanupConfirmed, false);
  assert.equal(peer.live, 0);
  await assert.rejects(adapter.acquire(), { code: 'client_closed' });
});
