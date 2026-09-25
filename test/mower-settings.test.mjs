import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyClient, decodeMowerSettings } from '../dist/index.js';
import { SETTINGS } from '../dist/mowers/local/settings.js';
import { fakeMower } from './fixtures/local-mower.mjs';
import { cloud, credentials, memory } from './fixtures/mower-cloud.mjs';
import { e15Schema } from './fixtures/e15-telemetry.mjs';

// Synthetic declarations of the setting points in the documented cloud shape. Codes, types,
// bounds and units are product metadata from the owned device's schema, see
// docs/research/E15_SETTINGS_SCHEMA_2026-09-25.md. Values are invented.
const bool = (id, code, mode = 'rw') => ({
  id,
  code,
  mode,
  type: 'obj',
  property: { type: 'bool' },
});
const value = (id, code, min, max, unit, extra = {}) => ({
  id,
  code,
  mode: 'rw',
  type: 'obj',
  property: { type: 'value', min, max, scale: 0, step: 1, unit, ...extra },
});
const settingsSchema = [
  value(26, 'volume_set', 0, 100, '%'),
  bool(47, 'child_lock'),
  bool(101, 'rain_auto_return'),
  value(110, 'mow_height', 25, 75, 'mm'),
  bool(132, 'enable_smart_forbid_zone'),
  bool(133, 'enable_bird_view_capture'),
  bool(141, 'sparse_lawn_optimization'),
  bool(1, 'switch_go'),
  bool(2, 'pause'),
  { ...value(118, 'save_map_process', 0, 100, '%'), mode: 'ro' },
  ...e15Schema,
];
const idle = {
  1: false,
  2: false,
  8: 73,
  26: 20,
  47: true,
  101: true,
  109: 54,
  110: 40,
  118: 100,
  132: true,
  133: false,
  134: 'Wifi',
  141: false,
};
const optIn = { enabled: true };

async function setup(
  t,
  {
    peer: peerConfig = {},
    settings = optIn,
    commands,
    schema = settingsSchema,
    dps = idle,
    timeoutMs,
  } = {},
) {
  const peer = await fakeMower(t, {
    versionHeader: true,
    respond: () => JSON.stringify({ dps }),
    ...peerConfig,
  });
  const client = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      home: { fetch: cloud({ schema }) },
      ...(settings ? { settings } : {}),
      ...(commands ? { commands } : {}),
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
  return { peer, client, session };
}
const written = (peer) => peer.received.filter((x) => x.type === 13).length;
/** Queries and control frames together, so a refusal proves no I/O beyond negotiation. */
const queried = (peer) => peer.received.filter((x) => x.type === 13 || x.type === 16).length;
/** A synthetic device that applies every usable write and reports the written points back. */
function stateful(state) {
  return {
    respond: () => JSON.stringify({ dps: state }),
    onWrite: (dps, report) => {
      Object.assign(state, dps);
      report(dps);
    },
  };
}

test('the settings table is frozen, writes four declared points and keeps the protections read only', () => {
  assert.ok(Object.isFrozen(SETTINGS));
  assert.deepEqual(
    Object.entries(SETTINGS).map(([name, s]) => [
      name,
      s.dp,
      s.code,
      s.type,
      s.writable,
      s.min ?? null,
      s.max ?? null,
      s.unit ?? null,
    ]),
    [
      ['mowHeight', '110', 'mow_height', 'value', true, 25, 75, 'mm'],
      ['volume', '26', 'volume_set', 'value', true, 0, 100, '%'],
      ['smartNoGoZones', '132', 'enable_smart_forbid_zone', 'bool', true, null, null, null],
      ['sparseLawnOptimization', '141', 'sparse_lawn_optimization', 'bool', true, null, null, null],
      ['rainAutoReturn', '101', 'rain_auto_return', 'bool', false, null, null, null],
      ['childLock', '47', 'child_lock', 'bool', false, null, null, null],
      ['birdViewCapture', '133', 'enable_bird_view_capture', 'bool', false, null, null, null],
    ],
  );
  for (const s of Object.values(SETTINGS)) assert.ok(Object.isFrozen(s));
  assert.throws(() => {
    SETTINGS.childLock.writable = true;
  }, TypeError);
});

test('the decoder types each setting by the table, narrowed by the declaration, and infers nothing', () => {
  const snapshot = { source: 'local-tuya-3.5', observedAt: '2026-09-25T06:00:00.000Z', dps: idle };
  const decoded = decodeMowerSettings(snapshot, { schema: [] });
  assert.equal(decoded.source, 'local-tuya-3.5');
  assert.equal(decoded.observedAt, '2026-09-25T06:00:00.000Z');
  // Without a declaration a setting is read but never writable.
  assert.deepEqual(decoded.settings.mowHeight, {
    state: 'reported',
    dp: '110',
    type: 'value',
    value: 40,
    writable: false,
    min: 25,
    max: 75,
    step: 1,
    unit: 'mm',
  });
  assert.equal(decoded.settings.smartNoGoZones.writable, false);
  // A narrower declaration narrows the bound, and a coarser step marks an off-step value invalid.
  const narrow = [schemaEntry(value(110, 'mow_height', 30, 70, 'mm', { step: 5 }))];
  assert.deepEqual(decodeMowerSettings(snapshot, { schema: narrow }).settings.mowHeight, {
    ...decoded.settings.mowHeight,
    writable: true,
    min: 30,
    max: 70,
    step: 5,
  });
  assert.deepEqual(
    decodeMowerSettings({ ...snapshot, dps: { ...idle, 110: 42 } }, { schema: narrow }).settings
      .mowHeight,
    { state: 'invalid', dp: '110' },
  );
  const full = decodeMowerSettings(snapshot, { schema: settingsSchema.map(schemaEntry) }).settings;
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(full).map(([name, f]) => [name, [f.state, f.value, f.writable]]),
    ),
    {
      mowHeight: ['reported', 40, true],
      volume: ['reported', 20, true],
      smartNoGoZones: ['reported', true, true],
      sparseLawnOptimization: ['reported', false, true],
      rainAutoReturn: ['reported', true, false],
      childLock: ['reported', true, false],
      birdViewCapture: ['reported', false, false],
    },
  );
  const odd = decodeMowerSettings(
    {
      ...snapshot,
      dps: { 26: 101, 47: 'true', 101: null, 110: 45.5, 132: 1, 141: false },
    },
    { schema: settingsSchema.map(schemaEntry) },
  ).settings;
  assert.deepEqual(odd.volume, { state: 'invalid', dp: '26' });
  assert.deepEqual(odd.childLock, { state: 'invalid', dp: '47' });
  assert.deepEqual(odd.rainAutoReturn, { state: 'invalid', dp: '101' });
  assert.deepEqual(odd.mowHeight, { state: 'invalid', dp: '110' });
  assert.deepEqual(odd.smartNoGoZones, { state: 'invalid', dp: '132' });
  assert.deepEqual(odd.birdViewCapture, { state: 'missing', dp: '133' });
  assert.equal(odd.sparseLawnOptimization.state, 'reported');
  for (const bad of [
    undefined,
    null,
    {},
    { ...snapshot, source: 'cloud' },
    { ...snapshot, dps: null },
  ])
    assert.throws(() => decodeMowerSettings(bad), TypeError);
});

/** The cloud shape above, parsed the way the library's schema parser does, for the pure decoder. */
function schemaEntry(entry) {
  const result = {
    id: String(entry.id),
    code: entry.code,
    mode: entry.mode,
    type: entry.property?.type ?? 'raw',
  };
  for (const key of ['min', 'max', 'scale', 'step', 'unit'])
    if (entry.property?.[key] !== undefined) result[key] = entry.property[key];
  return result;
}

test('without the opt-in every write is refused before any frame, while reading still works', async (t) => {
  const { peer, session, client } = await setup(t, { settings: null });
  assert.equal(client.mowers.settingsEnabled, false);
  assert.equal(session.settingsEnabled, false);
  for (const request of [
    { name: 'mowHeight', value: 45 },
    { name: 'childLock', value: false },
    { name: 'unknown', value: 1 },
  ])
    await assert.rejects(session.setSetting(request), { code: 'mower_settings_disabled' });
  assert.equal(queried(peer), 0);
  const read = await session.querySettings();
  assert.equal(read.settings.mowHeight.value, 40);
  assert.equal(read.settings.mowHeight.writable, true);
  assert.equal(written(peer), 0);
  assert.equal(session.connected, true);
});

test('an invalid settings opt-in fails client construction and is independent of commands', () => {
  const base = { credentials, sessionStore: memory() };
  for (const settings of [
    { enabled: false },
    { enabled: 'yes' },
    {},
    { enabled: true, readBackMs: 999 },
    { enabled: true, readBackMs: 60_001 },
    { enabled: true, readBackMs: 1.5 },
    'enabled',
    [],
    null,
  ])
    assert.throws(() => new EufyClient({ mowers: { ...base, settings } }), {
      code: 'mower_invalid_options',
    });
  const settingsOnly = new EufyClient({
    mowers: { ...base, settings: { enabled: true, readBackMs: 2000 } },
  });
  assert.equal(settingsOnly.mowers.settingsEnabled, true);
  assert.equal(settingsOnly.mowers.commandsEnabled, false);
  const commandsOnly = new EufyClient({
    mowers: { ...base, commands: { enabled: true, stopRoute: 'official app at hand' } },
  });
  assert.equal(commandsOnly.mowers.commandsEnabled, true);
  assert.equal(commandsOnly.mowers.settingsEnabled, false);
});

test('mowHeight writes one declared value point in the documented control frame and reads it back', async (t) => {
  const { peer, session } = await setup(t, {
    peer: {
      onWrite: (dps, report) => {
        assert.deepEqual(dps, { 110: 45 });
        report({ 8: 73 }, { sequence: 81 });
        report({ 110: 45 }, { sequence: 82 });
        report({ 152: 'AQ==' }, { sequence: 83 });
      },
    },
  });
  const started = Date.now();
  const outcome = await session.setSetting({ name: 'mowHeight', value: 45 });
  assert.ok(Date.now() - started < 3000);
  assert.equal(outcome.setting, 'mowHeight');
  assert.deepEqual(outcome.write, { dp: '110', code: 'mow_height', value: 45 });
  assert.deepEqual(outcome.before.dps, idle);
  assert.equal(outcome.previous, 40);
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
    sequence: 82,
    value: 45,
  });
  assert.ok(outcome.sentAt <= outcome.reflection.observedAt);
  assert.equal(outcome.other, undefined);
  assert.deepEqual(
    outcome.reports.map((r) => [r.sequence, Object.keys(r.dps)]),
    [
      [81, ['8']],
      [82, ['110']],
    ],
  );
  // One fresh query, one control frame, nothing else. No retry, no replay.
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
  assert.deepEqual(write.document.data, { dps: { 110: 45 } });
  // The session stays usable and the report left in the queue is delivered untouched.
  assert.deepEqual((await session.receiveReport()).dps, { 152: 'AQ==' });
  await session.disconnect();
  assert.equal(await session.closed, 'disconnected');
});

for (const [name, dp, code, before, value] of [
  ['volume', '26', 'volume_set', 20, 35],
  ['smartNoGoZones', '132', 'enable_smart_forbid_zone', true, false],
  ['sparseLawnOptimization', '141', 'sparse_lawn_optimization', false, true],
]) {
  test(`${name} writes its declared point and is reflected only by the written value`, async (t) => {
    const { peer, session } = await setup(t, {
      peer: {
        onWrite: (received, report) => {
          assert.deepEqual(received, { [dp]: value });
          // The previous value and unrelated points never reflect the write.
          report({ [dp]: before });
          report({ 110: 45 });
          report({ [dp]: value });
        },
      },
    });
    const outcome = await session.setSetting({ name, value });
    assert.deepEqual(outcome.write, { dp, code, value });
    assert.equal(outcome.previous, before);
    assert.equal(outcome.end, 'reflected');
    assert.equal(outcome.reflection.value, value);
    assert.equal(outcome.other.value, before);
    assert.equal(outcome.reports.length, 3);
    assert.equal(written(peer), 1);
  });
}

test('a sent setting is never completed: silence or another value ends as timed_out without a second write', async (t) => {
  const { peer, session } = await setup(t, {
    settings: { enabled: true, readBackMs: 1000 },
    peer: { onWrite: (dps, report) => dps[110] === 50 && report({ 110: 40 }, { sequence: 91 }) },
  });
  const started = Date.now();
  const other = await session.setSetting({ name: 'mowHeight', value: 50 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 950 && elapsed < 3000, String(elapsed));
  assert.equal(other.stage, 'sent');
  assert.equal(other.end, 'timed_out');
  assert.equal(other.reflection, undefined);
  assert.deepEqual(other.other, { observedAt: other.other.observedAt, sequence: 91, value: 40 });
  assert.equal(session.connected, true);
  const quiet = await session.setSetting({ name: 'volume', value: 30, readBackMs: 1000 });
  assert.equal(quiet.stage, 'sent');
  assert.equal(quiet.end, 'timed_out');
  assert.equal(quiet.other, undefined);
  assert.deepEqual(quiet.reports, []);
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13, 16, 13],
  );
});

test('a change and its restore are two deliberate writes, each decided on its own fresh query', async (t) => {
  const state = { ...idle };
  const { peer, session } = await setup(t, { peer: stateful(state) });
  const change = await session.setSetting({ name: 'mowHeight', value: 45 });
  assert.equal(change.end, 'reflected');
  assert.equal(change.previous, 40);
  assert.equal((await session.querySettings()).settings.mowHeight.value, 45);
  const restore = await session.setSetting({ name: 'mowHeight', value: change.previous });
  assert.equal(restore.end, 'reflected');
  assert.equal(restore.previous, 45);
  assert.equal(restore.before.dps[110], 45);
  assert.equal((await session.querySettings()).settings.mowHeight.value, 40);
  // A second restore finds nothing to change and writes nothing.
  await assert.rejects(session.setSetting({ name: 'mowHeight', value: 40 }), {
    code: 'mower_setting_already_set',
  });
  assert.deepEqual(
    peer.writes.map((w) => w.dps),
    [{ 110: 45 }, { 110: 40 }],
  );
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13, 16, 16, 13, 16, 16],
  );
});

test('a device reply with a description ends the lifecycle as rejected without waiting', async (t) => {
  const { peer, session } = await setup(t, { peer: { rejectControl: true } });
  const started = Date.now();
  const outcome = await session.setSetting({ name: 'volume', value: 30 });
  assert.ok(Date.now() - started < 3000);
  assert.equal(outcome.stage, 'sent');
  assert.equal(outcome.end, 'rejected');
  assert.deepEqual(outcome.reply, {
    observedAt: outcome.reply.observedAt,
    returnCodeZero: false,
    rejected: true,
  });
  assert.equal(written(peer), 1);
  assert.equal(session.connected, true);
});

test('rain and child protection and the bird-view capture are refused whatever the value', async (t) => {
  const { peer, session } = await setup(t);
  for (const name of ['rainAutoReturn', 'childLock', 'birdViewCapture'])
    for (const value of [false, true, 0, 'off', undefined])
      await assert.rejects(session.setSetting({ name, value }), {
        code: 'mower_setting_read_only',
      });
  assert.equal(queried(peer), 0);
  assert.equal(session.connected, true);
});

test('invalid requests are refused before any query', async (t) => {
  const { peer, session } = await setup(t);
  for (const request of [
    undefined,
    null,
    'mowHeight',
    [],
    {},
    { name: 'height', value: 45 },
    { name: 'MowHeight', value: 45 },
    { name: '__proto__', value: 45 },
    { name: 'mowHeight' },
    { name: 'mowHeight', value: '45' },
    { name: 'mowHeight', value: 45.5 },
    { name: 'mowHeight', value: 24 },
    { name: 'mowHeight', value: 76 },
    { name: 'mowHeight', value: true },
    { name: 'volume', value: -1 },
    { name: 'volume', value: 101 },
    { name: 'volume', value: Number.NaN },
    { name: 'smartNoGoZones', value: 1 },
    { name: 'sparseLawnOptimization', value: 'true' },
    { name: 'mowHeight', value: 45, readBackMs: 10 },
    { name: 'mowHeight', value: 45, readBackMs: 60_001 },
    { name: 'mowHeight', value: 45, readBackMs: '2000' },
  ])
    await assert.rejects(session.setSetting(request), { code: 'mower_setting_invalid' });
  assert.equal(queried(peer), 0);
});

test('typed refusals are decided on a fresh query and nothing is written', async (t) => {
  for (const [name, value, dps, code] of [
    ['mowHeight', 45, { ...idle, 110: undefined }, 'mower_setting_evidence_missing'],
    ['mowHeight', 45, { ...idle, 110: '40' }, 'mower_setting_evidence_missing'],
    ['mowHeight', 45, { ...idle, 110: 80 }, 'mower_setting_evidence_missing'],
    ['smartNoGoZones', false, { ...idle, 132: null }, 'mower_setting_evidence_missing'],
    ['volume', 30, { ...idle, 118: undefined }, 'mower_setting_evidence_missing'],
    ['volume', 30, { ...idle, 118: '100' }, 'mower_setting_evidence_missing'],
    ['volume', 30, { ...idle, 118: 101 }, 'mower_setting_evidence_missing'],
    ['mowHeight', 45, { ...idle, 118: 1 }, 'mower_setting_map_saving'],
    ['sparseLawnOptimization', true, { ...idle, 118: 99 }, 'mower_setting_map_saving'],
    ['mowHeight', 40, idle, 'mower_setting_already_set'],
    ['volume', 20, idle, 'mower_setting_already_set'],
    ['smartNoGoZones', true, idle, 'mower_setting_already_set'],
    ['sparseLawnOptimization', false, idle, 'mower_setting_already_set'],
  ]) {
    const { peer, session } = await setup(t, { dps: JSON.parse(JSON.stringify(dps)) });
    await assert.rejects(session.setSetting({ name, value }), { code }, `${name} ${code}`);
    assert.deepEqual(
      peer.received.map((x) => x.type),
      [3, 5, 16],
    );
    assert.equal(session.connected, true);
    await session.disconnect();
  }
  // DP 118 at 0 after a long rest, as recorded on the owned device, is no running save.
  const { session } = await setup(t, {
    dps: { ...idle, 118: 0 },
    peer: { onWrite: (dps, report) => report(dps) },
  });
  assert.equal((await session.setSetting({ name: 'mowHeight', value: 45 })).end, 'reflected');
});

test('a point the device does not declare writable with the expected code, type and bound is never written', async (t) => {
  const height = settingsSchema.find((e) => e.id === 110);
  const swap = (entry) => settingsSchema.map((e) => (e.id === 110 ? entry : e));
  const undeclared = [
    // null reaches the cloud record, where undefined would select the default schema.
    ['no schema', null, 45],
    ['read-only', swap({ ...height, mode: 'ro' }), 45],
    ['write-only', swap({ ...height, mode: 'wr' }), 45],
    ['other type', swap({ ...height, property: { type: 'bool' } }), 45],
    ['other code', swap({ ...height, code: 'other' }), 45],
    ['absent', settingsSchema.filter((e) => e.id !== 110), 45],
    ['scaled', swap({ ...height, property: { ...height.property, scale: 1 } }), 45],
    ['above the declared max', swap({ ...height, property: { ...height.property, max: 70 } }), 72],
    ['off the declared step', swap({ ...height, property: { ...height.property, step: 5 } }), 42],
  ];
  for (const [label, schema, value] of undeclared) {
    const { peer, session } = await setup(t, { schema });
    await assert.rejects(
      session.setSetting({ name: 'mowHeight', value }),
      { code: 'mower_setting_undeclared' },
      label,
    );
    assert.equal(queried(peer), 0, label);
    await session.disconnect();
  }
  // A boolean setting is vetoed the same way.
  const { peer, session } = await setup(t, {
    schema: settingsSchema.map((e) => (e.id === 132 ? { ...e, code: 'enable_forbid_zone' } : e)),
  });
  await assert.rejects(session.setSetting({ name: 'smartNoGoZones', value: false }), {
    code: 'mower_setting_undeclared',
  });
  assert.equal(queried(peer), 0);
});

test('commands and settings keep separate opt-ins on one session', async (t) => {
  const { peer, session } = await setup(t);
  assert.equal(session.commandsEnabled, false);
  await assert.rejects(session.sendCommand({ kind: 'start' }), { code: 'mower_commands_disabled' });
  const both = await setup(t, {
    commands: { enabled: true, stopRoute: 'official app at hand' },
    settings: null,
  });
  assert.equal(both.session.settingsEnabled, false);
  await assert.rejects(both.session.setSetting({ name: 'volume', value: 30 }), {
    code: 'mower_settings_disabled',
  });
  assert.equal(written(peer) + written(both.peer), 0);
});

test('one write owns the session, and a second write, command or read reports mower_local_busy', async (t) => {
  const { peer, session } = await setup(t, {
    settings: { enabled: true, readBackMs: 1000 },
    commands: { enabled: true, stopRoute: 'official app at hand' },
  });
  const pending = session.setSetting({ name: 'volume', value: 30 });
  await assert.rejects(session.setSetting({ name: 'mowHeight', value: 45 }), {
    code: 'mower_local_busy',
  });
  await assert.rejects(session.sendCommand({ kind: 'start' }), { code: 'mower_local_busy' });
  await assert.rejects(session.querySettings(), { code: 'mower_local_busy' });
  await assert.rejects(session.receiveReport(), { code: 'mower_local_busy' });
  const outcome = await pending;
  assert.equal(outcome.end, 'timed_out');
  assert.equal(written(peer), 1);
});

test('peer loss during the read-back closes the session without reconnect or replay', async (t) => {
  const { peer, session } = await setup(t, {
    peer: { onWrite: () => setTimeout(() => peer.drop(), 50) },
  });
  await assert.rejects(session.setSetting({ name: 'mowHeight', value: 45 }), {
    code: 'mower_local_disconnected',
  });
  assert.equal(await session.closed, 'peer_closed');
  assert.equal(session.connected, false);
  await assert.rejects(session.setSetting({ name: 'mowHeight', value: 45 }), {
    code: 'mower_local_disconnected',
  });
  await delay(50);
  assert.equal(peer.connections, 1);
  assert.equal(written(peer), 1);
});

test('cancellation and client shutdown end a pending read-back and release the socket', async (t) => {
  const first = await setup(t, { settings: { enabled: true, readBackMs: 20_000 } });
  const cancel = new AbortController();
  const pending = assert.rejects(
    first.session.setSetting({ name: 'mowHeight', value: 45 }, cancel.signal),
    { code: 'request_aborted' },
  );
  await delay(30);
  cancel.abort();
  await pending;
  assert.equal(await first.session.closed, 'aborted');
  for (let i = 0; i < 100 && first.peer.live; i++) await delay(5);
  assert.equal(first.peer.live, 0);
  assert.equal(written(first.peer), 1);

  const second = await setup(t, { settings: { enabled: true, readBackMs: 20_000 } });
  const stopped = assert.rejects(second.session.setSetting({ name: 'volume', value: 30 }), {
    code: 'client_closed',
  });
  await delay(30);
  await second.client.shutdown();
  await stopped;
  assert.equal(await second.session.closed, 'shutdown');
  assert.equal(written(second.peer), 1);
});

test('a flood of unrelated reports ends the read-back at the report limit', async (t) => {
  const { session } = await setup(t, {
    peer: {
      onWrite: async (dps, report) => {
        // Paced below the session's 32-frame queue bound so every report is consumed.
        for (let i = 0; i < 70; i++) {
          report({ 8: 50 + (i % 10) }, { sequence: i });
          await delay(2);
        }
      },
    },
  });
  const outcome = await session.setSetting({ name: 'mowHeight', value: 45 });
  assert.equal(outcome.end, 'report_limit');
  assert.equal(outcome.stage, 'sent');
  assert.equal(outcome.reports.length, 64);
  assert.equal(session.connected, true);
});

test('the hard deadline still applies when the device never answers the fresh query', async (t) => {
  const { session, peer } = await setup(t, {
    settings: { enabled: true, readBackMs: 1000 },
    peer: { hang: true },
    timeoutMs: 300,
  });
  await assert.rejects(session.setSetting({ name: 'mowHeight', value: 45 }), {
    code: 'request_timeout',
  });
  assert.equal(await session.closed, 'timeout');
  assert.equal(written(peer), 0);
});

test('a long read-back keeps the transport alive with heartbeats only', async (t) => {
  const { peer, session } = await setup(t, { settings: { enabled: true, readBackMs: 12_000 } });
  const pending = session.setSetting({ name: 'mowHeight', value: 45 });
  for (let i = 0; i < 240 && !peer.received.some((x) => x.type === 9); i++) await delay(50);
  assert.ok(peer.received.some((x) => x.type === 9));
  peer.report({ 110: 45 });
  const outcome = await pending;
  assert.equal(outcome.end, 'reflected');
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13, 9],
  );
});

test('outcomes and decoded settings are private copies without device identity', async (t) => {
  const { session } = await setup(t, {
    peer: { onWrite: (dps, report) => report({ 110: 45 }) },
  });
  const outcome = await session.setSetting({ name: 'mowHeight', value: 45 });
  assert.ok(!JSON.stringify(outcome).includes('SYNTHETIC-DEVICE-ID'));
  outcome.write.value = 75;
  outcome.reports.length = 0;
  assert.equal(SETTINGS.mowHeight.dp, '110');
  const read = await session.querySettings();
  assert.ok(!JSON.stringify(read).includes('SYNTHETIC-DEVICE-ID'));
  read.settings.mowHeight.max = 99;
  assert.equal((await session.querySettings()).settings.mowHeight.max, 75);
});
