// DP 155 work parameter writes on the local session: the settings opt-in, the typed refusals
// before any write, the cloud reading as the value before the write, one partial message and the
// read-back from fresh reports. Every value is built from the documented tag and varint rules
// with invented numbers, never from a capture. See docs/MOWER_WORK_PARAMETERS.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EufyClient } from '../dist/index.js';
import { WRITABLE_WORK_PARAMETERS } from '../dist/mowers/work-parameters.js';
import { fakeMower } from './fixtures/local-mower.mjs';
import { cloud, credentials, memory } from './fixtures/mower-cloud.mjs';
import { e15Schema } from './fixtures/e15-telemetry.mjs';

function varint(value) {
  let rest = BigInt.asUintN(64, BigInt(value));
  const out = [];
  while (rest >= 0x80n) {
    out.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  out.push(Number(rest));
  return out;
}
const tag = (number, wire) => varint((BigInt(number) << 3n) | BigInt(wire));
const int = (number, value) => [...tag(number, 0), ...varint(value)];
const msg = (number, ...parts) => {
  const content = parts.flat(Infinity);
  return [...tag(number, 2), ...varint(content.length), ...content];
};
const b64 = (...parts) => Buffer.from(parts.flat(Infinity)).toString('base64');
/** A wrapper message around field 1, empty for zero like the app's proto3 encoder. */
const wrapped = (number, value) => (value === 0 ? msg(number) : msg(number, int(1, value)));

const MOW_SPEEDS = ['low', 'medium', 'adaptive_high', 'auto'];
const BLADE_SPEEDS = ['low', 'medium', 'high'];
/** A complete message with invented values, as the device reports it after a partial write. */
function message({ mowSpeed = 1, bladeSpeed = 1, extra = [] } = {}) {
  return b64(
    wrapped(1, 55),
    wrapped(2, mowSpeed),
    wrapped(3, 120),
    msg(4, int(1, 0), msg(2, int(1, 30)), int(5, 30)),
    wrapped(5, 70),
    wrapped(6, bladeSpeed),
    int(7, 70),
    extra,
  );
}
const decoded = ({ mowSpeed = 1, bladeSpeed = 1 } = {}) => ({
  mowHeight: 55,
  mowSpeed: MOW_SPEEDS[mowSpeed],
  edgeDistance: 120,
  direction: { mode: 'single', singleAngle: 30, currentAngle: 30 },
  mowSpacing: 70,
  bladeSpeed: BLADE_SPEEDS[bladeSpeed],
  currentMowSpacing: 70,
});

// DP 155 as the owned E15 declares it, next to the map-save progress, in the cloud shape.
const workSchema = [
  { id: 155, code: 'reserved_raw_155', mode: 'rw', type: 'raw' },
  {
    id: 118,
    code: 'save_map_process',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' },
  },
  ...e15Schema,
];
const idle = { 1: false, 2: false, 8: 73, 110: 55, 118: 100, 134: 'Wifi' };
const optIn = { enabled: true };

/**
 * A client, one discovered mower and a local session. `record` is the cloud record's data
 * points, read at every request so a test can change it between writes. `delayCloud` holds the
 * cloud reading after discovery.
 */
async function setup(
  t,
  {
    peer: peerConfig = {},
    settings = optIn,
    schema = workSchema,
    record = { 155: message() },
    dps = idle,
    timeoutMs,
    cloudFailure,
    delayCloudMs,
  } = {},
) {
  const peer = await fakeMower(t, {
    versionHeader: true,
    respond: () => JSON.stringify({ dps }),
    ...peerConfig,
  });
  const base = cloud({ schema, dps: record });
  const cloudReads = [];
  let discovered = false;
  const fetch = async (url, init) => {
    const action = new URL(url).searchParams.get('a');
    if (action === 'tuya.m.device.get' && discovered) {
      cloudReads.push(Date.now());
      if (delayCloudMs) await new Promise((resolve) => setTimeout(resolve, delayCloudMs));
      if (cloudFailure) throw new Error('PRIVATE-CLOUD-FAILURE');
    }
    return base(url, init);
  };
  const client = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      home: { fetch },
      ...(settings ? { settings } : {}),
    },
  });
  t.after(() => client.shutdown());
  await client.mowers.connect();
  const [device] = await client.mowers.discover();
  const session = await client.mowers.openLocalSession(device.id, {
    host: peer.host,
    port: peer.port,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  discovered = true;
  return { peer, client, session, cloudReads };
}
const written = (peer) => peer.received.filter((x) => x.type === 13).length;
const queried = (peer) => peer.received.filter((x) => x.type === 16).length;
/** A synthetic device that merges one partial blade or mow speed write and reports the result. */
function merging(state, record) {
  return {
    onWrite: (dps, report) => {
      const bytes = Buffer.from(dps[155], 'base64');
      const field = bytes[0] >> 3;
      const value = bytes[1] === 0 ? 0 : bytes[3];
      if (field === 2) state.mowSpeed = value;
      if (field === 6) state.bladeSpeed = value;
      const full = message(state);
      if (record) record[155] = full;
      report({ 155: full }, { sequence: 90 });
    },
  };
}

test('the writable work parameters are frozen and limited to the two speeds', () => {
  assert.ok(Object.isFrozen(WRITABLE_WORK_PARAMETERS));
  assert.deepEqual(
    Object.entries(WRITABLE_WORK_PARAMETERS).map(([name, p]) => [name, p.field, [...p.values]]),
    [
      ['mowSpeed', 2, ['low', 'medium', 'adaptive_high']],
      ['bladeSpeed', 6, ['low', 'medium', 'high']],
    ],
  );
  for (const parameter of Object.values(WRITABLE_WORK_PARAMETERS)) {
    assert.ok(Object.isFrozen(parameter));
    assert.ok(Object.isFrozen(parameter.values));
  }
});

test('without the settings opt-in a work parameter write is refused before any I/O', async (t) => {
  const { peer, session, cloudReads } = await setup(t, { settings: null });
  await assert.rejects(session.setWorkParameter({ name: 'bladeSpeed', value: 'high' }), {
    code: 'mower_settings_disabled',
  });
  assert.equal(queried(peer) + written(peer), 0);
  assert.deepEqual(cloudReads, []);
  assert.equal(session.connected, true);
});

test('invalid and read-only requests are refused before any I/O', async (t) => {
  const { peer, session, cloudReads } = await setup(t);
  for (const name of ['edgeDistance', 'mowSpacing', 'direction', 'mowHeight', 'currentMowSpacing'])
    await assert.rejects(session.setWorkParameter({ name, value: 1 }), {
      code: 'mower_setting_read_only',
    });
  for (const request of [
    undefined,
    null,
    [],
    'bladeSpeed',
    { name: 'unknown', value: 'low' },
    { name: 'mowSpeed', value: 'auto' },
    { name: 'mowSpeed', value: 'high' },
    { name: 'mowSpeed', value: 1 },
    { name: 'bladeSpeed', value: 'adaptive_high' },
    { name: 'bladeSpeed', value: 'HIGH' },
    { name: 'bladeSpeed', value: null },
    { name: 'bladeSpeed', value: 'high', readBackMs: 999 },
    { name: 'bladeSpeed', value: 'high', readBackMs: 60_001 },
    { name: 'bladeSpeed', value: 'high', readBackMs: 1.5 },
  ])
    await assert.rejects(session.setWorkParameter(request), { code: 'mower_setting_invalid' });
  assert.equal(queried(peer) + written(peer), 0);
  assert.deepEqual(cloudReads, []);
  assert.equal(session.connected, true);
});

for (const [label, schema] of [
  ['without a declaration', e15Schema],
  ['declared read only', [{ id: 155, code: 'reserved_raw_155', mode: 'ro', type: 'raw' }]],
  ['declared with another code', [{ id: 155, code: 'other_raw', mode: 'rw', type: 'raw' }]],
  [
    'declared as a value',
    [
      {
        id: 155,
        code: 'reserved_raw_155',
        mode: 'rw',
        type: 'obj',
        property: { type: 'value', min: 0, max: 9, scale: 0, step: 1 },
      },
    ],
  ],
]) {
  test(`DP 155 ${label} is refused as undeclared before any I/O`, async (t) => {
    const { peer, session, cloudReads } = await setup(t, { schema });
    await assert.rejects(session.setWorkParameter({ name: 'bladeSpeed', value: 'high' }), {
      code: 'mower_setting_undeclared',
    });
    assert.equal(queried(peer) + written(peer), 0);
    assert.deepEqual(cloudReads, []);
    assert.equal(session.connected, true);
  });
}

test('bladeSpeed writes one partial message in the control frame and reads the merge back', async (t) => {
  const state = { mowSpeed: 1, bladeSpeed: 1 };
  const { peer, session, cloudReads } = await setup(t, {
    peer: {
      onWrite: (dps, report) => {
        // Only field 6 with speed type 2, the way the app's encoder writes one change.
        assert.deepEqual(dps, { 155: 'MgIIAg==' });
        report({ 8: 73 }, { sequence: 81 });
        report({ 155: 'not base64!' }, { sequence: 82 });
        state.bladeSpeed = 2;
        report({ 155: message(state) }, { sequence: 83 });
        report({ 152: 'AQ==' }, { sequence: 84 });
      },
    },
  });
  const started = Date.now();
  const outcome = await session.setWorkParameter({ name: 'bladeSpeed', value: 'high' });
  assert.ok(Date.now() - started < 3000);
  assert.equal(cloudReads.length, 1, 'one cloud reading before the write');
  assert.equal(outcome.name, 'bladeSpeed');
  assert.deepEqual(outcome.write, {
    dp: '155',
    code: 'reserved_raw_155',
    field: 6,
    value: 'high',
    encoded: 'MgIIAg==',
  });
  assert.equal(outcome.previous, 'medium');
  assert.deepEqual(outcome.cloud.parameters, decoded());
  assert.ok(outcome.cloud.observedAt <= outcome.before.observedAt);
  assert.deepEqual(outcome.before.dps, idle);
  assert.ok(outcome.before.observedAt <= outcome.sentAt);
  assert.equal(outcome.stage, 'reflected');
  assert.equal(outcome.end, 'reflected');
  assert.deepEqual(outcome.reply, {
    observedAt: outcome.reply.observedAt,
    returnCodeZero: true,
    rejected: false,
  });
  assert.deepEqual(outcome.reflection, {
    observedAt: outcome.reflection.observedAt,
    sequence: 83,
    value: 'high',
    parameters: decoded({ bladeSpeed: 2 }),
  });
  assert.ok(outcome.sentAt <= outcome.reflection.observedAt);
  assert.equal(outcome.other, undefined, 'an undecodable value is no evidence either way');
  assert.deepEqual(
    outcome.reports.map((r) => r.sequence),
    [81, 82, 83],
  );
  // Negotiation, one fresh query, one control frame. No retry and no replay.
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13],
  );
  const [write] = peer.writes;
  assert.equal(write.version, '3.5');
  assert.equal(write.headerZeros, true);
  assert.deepEqual(Object.keys(write.document), ['protocol', 't', 'data']);
  assert.equal(write.document.protocol, 5);
  assert.ok(Number.isInteger(write.document.t) && Math.abs(write.document.t - started / 1000) < 5);
  // The session stays usable and the report left in the queue is delivered untouched.
  assert.deepEqual((await session.receiveReport()).dps, { 152: 'AQ==' });
  await session.disconnect();
  assert.equal(await session.closed, 'disconnected');
});

test('a zero is written as an empty wrapper and read back from an empty wrapper', async (t) => {
  const state = { mowSpeed: 1, bladeSpeed: 1 };
  const { peer, session } = await setup(t, { peer: merging(state) });
  const outcome = await session.setWorkParameter({ name: 'mowSpeed', value: 'low' });
  // Field 2 with length 0, as proto3 leaves a zero speed type out of its wrapper.
  assert.deepEqual(peer.writes[0].dps, { 155: 'EgA=' });
  assert.deepEqual(outcome.write, {
    dp: '155',
    code: 'reserved_raw_155',
    field: 2,
    value: 'low',
    encoded: 'EgA=',
  });
  assert.equal(outcome.previous, 'medium');
  assert.equal(outcome.end, 'reflected');
  assert.equal(outcome.reflection.value, 'low');
  assert.deepEqual(outcome.reflection.parameters, decoded({ mowSpeed: 0 }));
});

test('a restore is a second deliberate write decided on its own cloud reading', async (t) => {
  const state = { mowSpeed: 1, bladeSpeed: 1 };
  const record = { 155: message(state) };
  const { peer, session, cloudReads } = await setup(t, { peer: merging(state, record), record });
  const change = await session.setWorkParameter({ name: 'bladeSpeed', value: 'high' });
  assert.equal(change.previous, 'medium');
  assert.equal(change.end, 'reflected');
  const restore = await session.setWorkParameter({ name: 'bladeSpeed', value: change.previous });
  assert.equal(restore.previous, 'high');
  assert.equal(restore.end, 'reflected');
  assert.equal(restore.reflection.value, 'medium');
  assert.equal(cloudReads.length, 2);
  assert.deepEqual(
    peer.writes.map((w) => w.dps),
    [{ 155: 'MgIIAg==' }, { 155: 'MgIIAQ==' }],
  );
  // Written again, the same value is already set on the cloud reading and nothing is sent.
  await assert.rejects(session.setWorkParameter({ name: 'bladeSpeed', value: 'medium' }), {
    code: 'mower_setting_already_set',
  });
  assert.equal(written(peer), 2);
});

for (const [label, record, code] of [
  ['a record without DP 155', {}, 'mower_setting_evidence_missing'],
  ['an undecodable DP 155', { 155: 'not base64!' }, 'mower_setting_evidence_missing'],
  ['DP 155 as another type', { 155: 42 }, 'mower_setting_evidence_missing'],
  [
    'a message without the parameter',
    { 155: b64(wrapped(1, 55), wrapped(2, 1)) },
    'mower_setting_evidence_missing',
  ],
  ['an unnamed blade speed', { 155: message({ bladeSpeed: 7 }) }, 'mower_setting_evidence_missing'],
  [
    'an unknown field inside the parameter',
    { 155: b64(wrapped(2, 1), msg(6, int(1, 1), int(9, 4))) },
    'mower_setting_evidence_missing',
  ],
  ['the requested value', { 155: message({ bladeSpeed: 2 }) }, 'mower_setting_already_set'],
]) {
  test(`${label} in the cloud reading refuses the write before any control frame`, async (t) => {
    const { peer, session, cloudReads } = await setup(t, { record });
    await assert.rejects(session.setWorkParameter({ name: 'bladeSpeed', value: 'high' }), { code });
    assert.equal(cloudReads.length, 1);
    assert.equal(written(peer), 0);
    assert.equal(session.connected, true);
  });
}

test('a mow speed the library does not write is no value to restore', async (t) => {
  const { peer, session } = await setup(t, { record: { 155: message({ mowSpeed: 3 }) } });
  await assert.rejects(session.setWorkParameter({ name: 'mowSpeed', value: 'medium' }), {
    code: 'mower_setting_evidence_missing',
  });
  assert.equal(written(peer), 0);
});

for (const [label, dps, code] of [
  ['a running map save', { ...idle, 118: 50 }, 'mower_setting_map_saving'],
  ['no map-save progress', { 1: false, 2: false }, 'mower_setting_evidence_missing'],
  ['an invalid map-save progress', { ...idle, 118: 101 }, 'mower_setting_evidence_missing'],
]) {
  test(`${label} on the fresh query refuses the write`, async (t) => {
    const { peer, session } = await setup(t, { dps });
    await assert.rejects(session.setWorkParameter({ name: 'bladeSpeed', value: 'high' }), { code });
    assert.equal(queried(peer), 1);
    assert.equal(written(peer), 0);
    assert.equal(session.connected, true);
  });
}

test('a failed or slow cloud reading refuses the write and keeps the session open', async (t) => {
  const failing = await setup(t, { cloudFailure: true });
  await assert.rejects(failing.session.setWorkParameter({ name: 'bladeSpeed', value: 'high' }), {
    code: 'mower_setting_evidence_missing',
  });
  assert.equal(failing.cloudReads.length, 1);
  assert.equal(queried(failing.peer) + written(failing.peer), 0);
  assert.equal(failing.session.connected, true);

  const slow = await setup(t, { delayCloudMs: 1500, timeoutMs: 300 });
  const started = Date.now();
  await assert.rejects(slow.session.setWorkParameter({ name: 'bladeSpeed', value: 'high' }), {
    code: 'mower_setting_evidence_missing',
  });
  assert.ok(Date.now() - started < 1200, 'bounded by the session timeout');
  assert.equal(queried(slow.peer) + written(slow.peer), 0);
  assert.equal(slow.session.connected, true);
  // The session still answers a query afterwards.
  assert.deepEqual((await slow.session.queryStatus()).dps, idle);
});

test('another reported value is kept as other and the write ends timed out, never repeated', async (t) => {
  const { peer, session } = await setup(t, {
    peer: {
      onWrite: (dps, report) => {
        report({ 155: message({ bladeSpeed: 0 }) }, { sequence: 91 });
        report({ 155: b64(wrapped(1, 55)) }, { sequence: 92 });
      },
    },
  });
  const outcome = await session.setWorkParameter({
    name: 'bladeSpeed',
    value: 'high',
    readBackMs: 1000,
  });
  assert.equal(outcome.stage, 'sent');
  assert.equal(outcome.end, 'timed_out');
  assert.equal(outcome.reflection, undefined);
  assert.deepEqual(outcome.other, {
    observedAt: outcome.other.observedAt,
    sequence: 91,
    value: 'low',
  });
  assert.deepEqual(
    outcome.reports.map((r) => r.sequence),
    [91, 92],
  );
  assert.equal(written(peer), 1);
  assert.equal(session.connected, true);
});

test('a rejected control reply ends the write as rejected', async (t) => {
  const { peer, session } = await setup(t, { peer: { rejectControl: true } });
  const outcome = await session.setWorkParameter({ name: 'mowSpeed', value: 'adaptive_high' });
  assert.equal(outcome.stage, 'sent');
  assert.equal(outcome.end, 'rejected');
  assert.equal(outcome.reply.rejected, true);
  assert.equal(written(peer), 1);
});

test('a work parameter write owns the session until its bounded read-back ends', async (t) => {
  const { peer, session } = await setup(t, { delayCloudMs: 200 });
  const pending = session.setWorkParameter({ name: 'bladeSpeed', value: 'low', readBackMs: 1000 });
  await assert.rejects(session.queryStatus(), { code: 'mower_local_busy' });
  await assert.rejects(session.setSetting({ name: 'mowHeight', value: 45 }), {
    code: 'mower_local_busy',
  });
  // Without any report the read-back resolves at its bound, it never throws after the write.
  const outcome = await pending;
  assert.equal(outcome.end, 'timed_out');
  assert.deepEqual(outcome.reports, []);
  assert.equal(written(peer), 1);
  assert.deepEqual((await session.queryStatus()).dps, idle);
});
