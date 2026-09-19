import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMowerTelemetry, E15_TELEMETRY_DEFINITIONS } from '../dist/index.js';
import { parseSchema } from '../dist/mowers/telemetry/schema.js';
import { e15Schema, e15Dps } from './fixtures/e15-telemetry.mjs';
import { fakeMower } from './fixtures/local-mower.mjs';
import { mowerClient } from './fixtures/mower-cloud.mjs';

const schema = parseSchema(e15Schema);
const observedAt = '2026-09-16T12:00:00.000Z';
const snapshot = (dps = e15Dps) => ({ source: 'local-tuya-3.5', observedAt, dps });
const decode = (dps) => decodeMowerTelemetry(snapshot(dps), { schema });

test('the E15 defaults report evidenced battery and network units without inferring activity', () => {
  const telemetry = decode();
  assert.deepEqual(telemetry.battery, {
    state: 'reported',
    value: { percent: 73 },
    dp: ['8'],
    source: 'local-tuya-3.5',
    observedAt,
  });
  assert.deepEqual(telemetry.network, {
    state: 'reported',
    value: { kind: 'wifi', signalPercent: 54 },
    dp: ['134', '109'],
    source: 'local-tuya-3.5',
    observedAt,
  });
  assert.equal(telemetry.network.value.signalDbm, undefined);
  assert.equal(telemetry.fields['109'].unit, '%');
  assert.deepEqual(telemetry.dps, e15Dps);
  // A full battery, an inactive task, an unverified enum or map-save percentage is not
  // current activity or mowing progress. These independently invented values stay raw, and
  // without DP 107 the confirmed activity definitions report nothing.
  const unsupported = decode({ ...e15Dps, 1: false, 5: 'charge_done', 8: 100, 118: 100 });
  assert.deepEqual(unsupported.status, { state: 'missing', dp: ['107', '107', '107'] });
  assert.deepEqual(unsupported.progress, { state: 'unconfirmed' });
  assert.equal(unsupported.dps['118'], 100);
  telemetry.dps['8'] = 0;
  assert.equal(e15Dps['8'], 73);
});

test('E15 defaults reject invalid percentages and unobserved network enums and preserve partial reports', () => {
  for (const value of [-1, 101, 68.5, '68', null, true, [], {}]) {
    assert.equal(decode({ ...e15Dps, 8: value }).battery.state, 'invalid');
    assert.equal(decode({ ...e15Dps, 109: value }).network.state, 'invalid');
  }
  for (const value of [0, 100]) {
    assert.equal(decode({ ...e15Dps, 8: value }).battery.value.percent, value);
    assert.equal(decode({ ...e15Dps, 109: value }).network.value.signalPercent, value);
  }
  for (const value of ['None', 'Cellular', 'wifi', 'Ethernet'])
    assert.equal(decode({ ...e15Dps, 134: value }).network.state, 'invalid');
  assert.deepEqual(decode({}).battery, { state: 'missing', dp: ['8'] });
  assert.deepEqual(decode({}).network, { state: 'missing', dp: ['134', '109'] });
  assert.deepEqual(decode({ 134: 'Wifi' }).network.value, { kind: 'wifi' });
  assert.deepEqual(decode({ 109: 54 }).network.value, { signalPercent: 54 });
  const changed = schema.map((entry) => (entry.id === '8' ? { ...entry, max: 50 } : entry));
  assert.equal(decodeMowerTelemetry(snapshot(), { schema: changed }).battery.state, 'invalid');
  assert.deepEqual(decodeMowerTelemetry(snapshot(), { definitions: [] }).battery, {
    state: 'unconfirmed',
  });
});

test('consumers cannot rewrite the shared evidence registry through the exported definitions', () => {
  assert.throws(() => {
    E15_TELEMETRY_DEFINITIONS[0].dp = '118';
  }, TypeError);
  const network = E15_TELEMETRY_DEFINITIONS.find((entry) => entry.decode.kind === 'enum');
  assert.throws(() => {
    network.decode.values.Cellular = 'cellular';
  }, TypeError);
  assert.throws(() => {
    network.decode.kind = 'signal_dbm';
  }, TypeError);
  assert.equal(decode().battery.value.percent, 73);
});

test('the public local session returns the confirmed E15 fields and releases its connection', async (t) => {
  const peer = await fakeMower(t, { respond: () => JSON.stringify({ dps: e15Dps }) });
  const { client, mowers, id } = await mowerClient(t, { schema: JSON.stringify(e15Schema) });
  const session = await mowers.openLocalSession(id, { host: peer.host, port: peer.port });
  const telemetry = await session.queryTelemetry();
  assert.deepEqual(telemetry.battery.value, { percent: 73 });
  assert.deepEqual(telemetry.network.value, { kind: 'wifi', signalPercent: 54 });
  assert.deepEqual(telemetry.status, { state: 'missing', dp: ['107', '107', '107'] });
  assert.deepEqual(telemetry.progress, { state: 'unconfirmed' });
  assert.equal(telemetry.battery.source, 'local-tuya-3.5');
  assert.equal(telemetry.network.observedAt, telemetry.observedAt);
  assert.ok(Number.isFinite(Date.parse(telemetry.observedAt)));
  await session.disconnect();
  assert.equal(await session.closed, 'disconnected');
  assert.equal(session.connected, false);
  await client.shutdown();
  assert.equal(client.mowers.lifecycle, 'closed');
  assert.deepEqual(
    peer.received.map((frame) => frame.type),
    [3, 5, 16],
  );
});
