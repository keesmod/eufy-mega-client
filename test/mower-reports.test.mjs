import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeMowerTelemetry } from '../dist/index.js';
import { fakeMower } from './fixtures/local-mower.mjs';
import { mowerClient } from './fixtures/mower-cloud.mjs';

async function setup(t, timeoutMs = 500) {
  const peer = await fakeMower(t);
  const { client, mowers, id } = await mowerClient(t);
  const session = await mowers.openLocalSession(id, {
    host: peer.host,
    port: peer.port,
    timeoutMs,
  });
  await session.queryStatus();
  return { peer, client, session };
}

test('reports keep arrival time and partial values, independent of cached queries or device counters', async (t) => {
  const { peer, session } = await setup(t);
  peer.report({ 8: 41 });
  await delay(30);
  const beforeConsumption = Date.now();
  await delay(30);
  const report = await session.receiveReport();
  assert.equal(report.kind, 'device-report');
  assert.equal(report.sequence, 0);
  assert.ok(Date.parse(report.observedAt) < beforeConsumption);
  assert.deepEqual(report.dps, { 8: 41 });
  assert.equal(decodeMowerTelemetry(report).battery.value.percent, 41);
  const next = session.receiveReport();
  peer.report({ 109: 29 }, { sequence: 0 });
  assert.deepEqual((await next).dps, { 109: 29 });
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16],
  );
});

test('a query reply cannot satisfy a report read and missing reports expire the connection', async (t) => {
  const { peer, session } = await setup(t, 100);
  const report = assert.rejects(session.receiveReport(), { code: 'request_timeout' });
  peer.report({ 8: 99 }, { command: 16 });
  await report;
  assert.equal(await session.closed, 'timeout');
  assert.equal(session.connected, false);
});

for (const [options, code, end] of [
  [{ deviceId: 'FOREIGN-SYNTHETIC' }, 'mower_local_binding_mismatch', 'protocol_error'],
  [{ body: '{bad json' }, 'mower_local_protocol_error', 'protocol_error'],
  [{ tamper: true }, 'mower_local_authentication_failed', 'authentication_failed'],
]) {
  test(`invalid report closes the owner: ${code}`, async (t) => {
    const { peer, session } = await setup(t);
    const pending = assert.rejects(session.receiveReport(), { code });
    peer.report({ 8: 99 }, options);
    await pending;
    assert.equal(await session.closed, end);
    assert.equal(session.connected, false);
  });
}

test('report reads enforce one operation and cancellation releases the socket', async (t) => {
  const { peer, session } = await setup(t);
  const cancel = new AbortController();
  const pending = assert.rejects(session.receiveReport(cancel.signal), { code: 'request_aborted' });
  await assert.rejects(session.queryStatus(), { code: 'mower_local_busy' });
  await assert.rejects(session.receiveReport(), { code: 'mower_local_busy' });
  cancel.abort();
  await pending;
  assert.equal(await session.closed, 'aborted');
  for (let i = 0; i < 100 && peer.live; i++) await delay(5);
  assert.equal(peer.live, 0);
});

test('client shutdown ends a pending report and clears its ownership', async (t) => {
  const { client, session } = await setup(t);
  const pending = assert.rejects(session.receiveReport(), { code: 'client_closed' });
  await client.shutdown();
  await pending;
  assert.equal(await session.closed, 'shutdown');
});

test('an idle consumer cannot accumulate unbounded reports', async (t) => {
  const { peer, session } = await setup(t);
  for (let i = 0; i < 40; i++) peer.report({ 8: i });
  assert.equal(await session.closed, 'protocol_error');
  assert.equal(session.connected, false);
});

test('a pending long read sends only transport heartbeats and cleans up after a report', async (t) => {
  const { peer, session } = await setup(t, 12_000);
  const pending = session.receiveReport();
  for (let i = 0; i < 220 && !peer.received.some((x) => x.type === 9); i++) await delay(50);
  assert.ok(peer.received.some((x) => x.type === 9));
  peer.report({ 8: 42 });
  assert.equal((await pending).dps[8], 42);
  await session.disconnect();
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 9],
  );
  assert.equal(await session.closed, 'disconnected');
});

test('successive frequent reports do not postpone the transport heartbeat', async (t) => {
  const { peer, session } = await setup(t, 2000);
  const end = Date.now() + 11_000;
  const reports = setInterval(() => peer.report({ 8: 42 }), 250);
  try {
    while (Date.now() < end && !peer.received.some((x) => x.type === 9))
      assert.equal((await session.receiveReport()).dps[8], 42);
    assert.ok(peer.received.some((x) => x.type === 9));
  } finally {
    clearInterval(reports);
    await session.disconnect();
  }
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 9],
  );
});
