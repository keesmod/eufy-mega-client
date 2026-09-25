import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyClient } from '../dist/index.js';
import { COMMANDS } from '../dist/mowers/local/commands.js';
import { fakeMower } from './fixtures/local-mower.mjs';
import { cloud, credentials, memory } from './fixtures/mower-cloud.mjs';
import { e15Schema } from './fixtures/e15-telemetry.mjs';

// Synthetic declarations of the control points in the documented cloud shape. The codes and
// property types are product metadata from the owned device's schema, see docs/MOWER_COMMANDS.md.
const bool = (id, code, mode = 'rw') => ({
  id,
  code,
  mode,
  type: 'obj',
  property: { type: 'bool' },
});
const controlSchema = [
  bool(1, 'switch_go'),
  bool(2, 'pause'),
  bool(3, 'switch_charge'),
  bool(47, 'child_lock'),
  bool(101, 'rain_auto_return'),
  { id: 103, code: 'start_control', mode: 'rw', type: 'raw' },
  { id: 105, code: 'pause_control', mode: 'rw', type: 'raw' },
  { id: 106, code: 'resume_control', mode: 'rw', type: 'raw' },
  {
    id: 118,
    code: 'save_map_process',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' },
  },
  ...e15Schema,
];
// Same synthetic payload builder as the activity tests: tag varint plus base-128 varints.
const varint = (value) => {
  const out = [];
  let rest = BigInt(value);
  while (rest > 0x7fn) {
    out.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  out.push(Number(rest));
  return out;
};
const status = (fields) =>
  Buffer.from(
    Object.entries(fields)
      .sort(([a], [b]) => Number(a) - Number(b))
      .flatMap(([number, value]) => [...varint(BigInt(number) * 8n + 0n), ...varint(value)]),
  ).toString('base64');
/** Synthetic control-point payload of the established layout: one field-1 varint record. */
const control = () => status({ 1: 1000 + Math.floor(Math.random() * 9000) });
const idle = { 1: false, 2: false, 3: false, 8: 73, 109: 54, 118: 100, 134: 'Wifi' };
const optIn = { enabled: true, stopRoute: 'pause then return here, official app at hand' };

async function setup(t, { peer: peerConfig = {}, commands = optIn, dps = idle, timeoutMs } = {}) {
  const peer = await fakeMower(t, {
    versionHeader: true,
    respond: () => JSON.stringify({ dps }),
    ...peerConfig,
  });
  const client = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      home: { fetch: cloud({ schema: controlSchema }) },
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

test('the command table is frozen and can only write the three declared boolean points', () => {
  assert.ok(Object.isFrozen(COMMANDS));
  assert.deepEqual(
    Object.entries(COMMANDS).map(([kind, c]) => [
      kind,
      c.write.dp,
      c.write.code,
      c.write.value,
      c.control,
      c.activity ?? null,
      c.payload ? [c.payload.name, c.payload.fields] : null,
      c.requires ?? null,
    ]),
    [
      ['start', '1', 'switch_go', true, '103', 'mowing', null, null],
      ['pause', '2', 'pause', true, '105', 'paused', null, null],
      ['resume', '2', 'pause', false, '106', 'mowing', null, null],
      ['stop', '1', 'switch_go', false, '104', null, ['map_saving', { 2: 5, 3: 1 }], null],
      ['return', '3', 'switch_charge', true, '103', 'returning', null, 'stopped'],
    ],
  );
  for (const c of Object.values(COMMANDS)) {
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.write));
    if (c.payload) assert.ok(Object.isFrozen(c.payload) && Object.isFrozen(c.payload.fields));
  }
});

test('without the opt-in every command is refused before any frame is written', async (t) => {
  const { peer, session, client } = await setup(t, { commands: null });
  assert.equal(client.mowers.commandsEnabled, false);
  assert.equal(session.commandsEnabled, false);
  for (const kind of ['start', 'pause', 'resume', 'return'])
    await assert.rejects(session.sendCommand({ kind }), { code: 'mower_commands_disabled' });
  assert.equal(written(peer), 0);
  assert.equal(session.connected, true);
});

test('an invalid opt-in fails client construction', () => {
  const base = { credentials, sessionStore: memory() };
  for (const commands of [
    { enabled: false, stopRoute: 'app' },
    { enabled: 'yes', stopRoute: 'app' },
    { enabled: true },
    { enabled: true, stopRoute: '' },
    { enabled: true, stopRoute: '   ' },
    { enabled: true, stopRoute: 'a'.repeat(201) },
    { enabled: true, stopRoute: 'line\nbreak' },
    { enabled: true, stopRoute: 'app', readBackMs: 999 },
    { enabled: true, stopRoute: 'app', readBackMs: 60_001 },
    { enabled: true, stopRoute: 'app', readBackMs: 1.5 },
    'enabled',
    [],
  ])
    assert.throws(() => new EufyClient({ mowers: { ...base, commands } }), {
      code: 'mower_invalid_options',
    });
  const client = new EufyClient({ mowers: { ...base, commands: { ...optIn, readBackMs: 2000 } } });
  assert.equal(client.mowers.commandsEnabled, true);
});

test('start writes one declared point in the documented 3.5 control frame and reads the lifecycle back', async (t) => {
  const { peer, session } = await setup(t, {
    peer: {
      onWrite: (dps, report) => {
        assert.deepEqual(dps, { 1: true });
        // The order recorded on the owned device: control report, transitional first frame,
        // the written point, then the confirmed activity payload.
        report({ 103: control() }, { sequence: 71 });
        report({ 107: status({ 1: 2 }) }, { sequence: 72 });
        report({ 1: true }, { sequence: 73 });
        report({ 107: status({ 1: 2, 3: 1 }) }, { sequence: 74 });
        report({ 152: 'AQ==' }, { sequence: 75 });
      },
    },
  });
  const started = Date.now();
  const outcome = await session.sendCommand({ kind: 'start' });
  assert.ok(Date.now() - started < 3000);
  assert.equal(outcome.command, 'start');
  assert.deepEqual(outcome.write, { dp: '1', code: 'switch_go', value: true });
  assert.deepEqual(outcome.before.dps, idle);
  assert.equal(outcome.before.source, 'local-tuya-3.5');
  assert.ok(outcome.before.observedAt <= outcome.sentAt);
  assert.equal(outcome.stage, 'reflected');
  assert.equal(outcome.end, 'reflected');
  assert.deepEqual(outcome.reply, {
    observedAt: outcome.reply.observedAt,
    returnCodeZero: true,
    rejected: false,
  });
  assert.equal(outcome.acknowledgement.dp, '103');
  assert.equal(outcome.acknowledgement.sequence, 71);
  assert.deepEqual(outcome.activity, {
    observedAt: outcome.activity.observedAt,
    sequence: 74,
    value: 'mowing',
  });
  assert.ok(outcome.sentAt <= outcome.acknowledgement.observedAt);
  assert.ok(outcome.acknowledgement.observedAt <= outcome.activity.observedAt);
  assert.deepEqual(
    outcome.reports.map((r) => [r.kind, r.sequence, Object.keys(r.dps)]),
    [
      ['device-report', 71, ['103']],
      ['device-report', 72, ['107']],
      ['device-report', 73, ['1']],
      ['device-report', 74, ['107']],
    ],
  );
  // One fresh query, one control frame, nothing else. No retry, no replay.
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13],
  );
  assert.equal(peer.writes.length, 1);
  const [write] = peer.writes;
  assert.equal(write.version, '3.5');
  assert.equal(write.headerZeros, true);
  assert.deepEqual(Object.keys(write.document), ['protocol', 't', 'data']);
  assert.equal(write.document.protocol, 5);
  assert.ok(Number.isInteger(write.document.t) && Math.abs(write.document.t - started / 1000) < 5);
  assert.deepEqual(write.document.data, { dps: { 1: true } });
  assert.equal(session.connected, true);
  // The session stays usable and the report left in the queue is delivered untouched.
  assert.deepEqual((await session.receiveReport()).dps, { 152: 'AQ==' });
  await session.disconnect();
  assert.equal(await session.closed, 'disconnected');
});

for (const [kind, dps, write, controlDp, scripted, activity] of [
  [
    'pause',
    { ...idle, 1: true },
    { dp: '2', code: 'pause', value: true },
    '105',
    { 1: 2, 3: 2 },
    'paused',
  ],
  [
    'resume',
    { ...idle, 1: true, 2: true },
    { dp: '2', code: 'pause', value: false },
    '106',
    { 1: 2, 3: 1 },
    'mowing',
  ],
  [
    'return',
    idle,
    { dp: '3', code: 'switch_charge', value: true },
    '103',
    { 1: 1, 3: 1 },
    'returning',
  ],
  // A Box task started in the app, mission 17, is reflected like the whole lawn.
  [
    'pause',
    { ...idle, 1: true },
    { dp: '2', code: 'pause', value: true },
    '105',
    { 1: 17, 3: 2 },
    'paused',
  ],
  [
    'resume',
    { ...idle, 1: true, 2: true },
    { dp: '2', code: 'pause', value: false },
    '106',
    { 1: 17, 3: 1 },
    'mowing',
  ],
]) {
  test(`${kind} writes its declared point and is reflected only by the matching confirmed activity`, async (t) => {
    const { peer, session } = await setup(t, {
      dps,
      peer: {
        onWrite: (received, report) => {
          assert.deepEqual(received, { [write.dp]: write.value });
          // Payloads that must not count: the wrong activity, a transitional first frame,
          // the map-saving payload, field 6 and the default payload.
          report({ 107: status(kind === 'return' ? { 1: 2, 3: 1 } : { 1: 1, 3: 1 }) });
          report({ 107: status({ 1: scripted[1] }) });
          report({ 107: status({ 2: 5, 3: 1 }) });
          report({ 107: status({ 6: 1 }) });
          report({ 107: 'AA==' });
          report({ [write.dp]: write.value });
          report({ [controlDp]: control() });
          report({ 107: status(scripted) });
        },
      },
    });
    const outcome = await session.sendCommand({ kind });
    assert.deepEqual(outcome.write, write);
    assert.equal(outcome.stage, 'reflected');
    assert.equal(outcome.end, 'reflected');
    assert.equal(outcome.acknowledgement.dp, write.dp);
    assert.equal(outcome.activity.value, activity);
    assert.equal(outcome.reports.length, 8);
    assert.deepEqual(peer.writes[0].document.data, { dps: { [write.dp]: write.value } });
    assert.equal(written(peer), 1);
  });
}

test('a sent command is never completed: silence ends as timed_out with the stage actually evidenced', async (t) => {
  const { peer, session } = await setup(t, {
    commands: { ...optIn, readBackMs: 1000 },
    peer: { onWrite: (dps, report) => dps[2] === true && report({ 105: control() }) },
  });
  const started = Date.now();
  const outcome = await session.sendCommand({ kind: 'pause' });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 950 && elapsed < 3000, String(elapsed));
  assert.equal(outcome.stage, 'acknowledged');
  assert.equal(outcome.end, 'timed_out');
  assert.equal(outcome.acknowledgement.dp, '105');
  assert.equal(outcome.activity, undefined);
  assert.equal(outcome.reply.returnCodeZero, true);
  assert.equal(session.connected, true);
  assert.equal(written(peer), 1);
  // Silence without any report leaves the stage at sent. Nothing is resent.
  const quiet = await session.sendCommand({ kind: 'return', readBackMs: 1000 });
  assert.equal(quiet.stage, 'sent');
  assert.equal(quiet.end, 'timed_out');
  assert.equal(quiet.acknowledgement, undefined);
  assert.deepEqual(quiet.reports, []);
  assert.equal(written(peer), 2);
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13, 16, 13],
  );
});

test('a device reply with a description ends the lifecycle as rejected without waiting', async (t) => {
  const { peer, session } = await setup(t, { peer: { rejectControl: true } });
  const started = Date.now();
  const outcome = await session.sendCommand({ kind: 'start' });
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

test('a reply without description and a nonzero return code is recorded but not treated as rejection', async (t) => {
  const { session } = await setup(t, {
    commands: { ...optIn, readBackMs: 1000 },
    peer: { controlCode: 1 },
  });
  const outcome = await session.sendCommand({ kind: 'start' });
  assert.deepEqual(outcome.reply, {
    observedAt: outcome.reply.observedAt,
    returnCodeZero: false,
    rejected: false,
  });
  assert.equal(outcome.end, 'timed_out');
});

test('typed refusals are decided on a fresh query and nothing is written', async (t) => {
  for (const [kind, dps, code] of [
    ['return', { ...idle, 118: 50 }, 'mower_command_map_saving'],
    ['return', { ...idle, 1: true }, 'mower_command_task_active'],
    ['return', { ...idle, 1: true, 2: true }, 'mower_command_task_active'],
    ['return', { ...idle, 1: undefined }, 'mower_command_task_active'],
    ['return', { ...idle, 118: 0 }, 'mower_command_map_saving'],
    ['stop', { ...idle, 1: true, 118: 40 }, 'mower_command_map_saving'],
    ['stop', { ...idle }, 'mower_command_already_set'],
    ['start', { ...idle, 118: 1 }, 'mower_command_map_saving'],
    ['pause', { ...idle, 1: true, 118: 99 }, 'mower_command_map_saving'],
    ['return', { ...idle, 118: undefined }, 'mower_command_evidence_missing'],
    ['return', { ...idle, 118: '100' }, 'mower_command_evidence_missing'],
    ['return', { ...idle, 118: 101 }, 'mower_command_evidence_missing'],
    ['start', { ...idle, 1: true }, 'mower_command_already_set'],
    ['pause', { ...idle, 1: true, 2: true }, 'mower_command_already_set'],
    ['resume', { ...idle, 1: true, 2: false }, 'mower_command_already_set'],
    ['return', { ...idle, 3: true }, 'mower_command_already_set'],
  ]) {
    const { peer, session } = await setup(t, { dps: JSON.parse(JSON.stringify(dps)) });
    await assert.rejects(session.sendCommand({ kind }), { code }, `${kind} ${code}`);
    assert.deepEqual(
      peer.received.map((x) => x.type),
      [3, 5, 16],
    );
    assert.equal(session.connected, true);
    await session.disconnect();
  }
});

test('a point the device does not declare as a writable boolean with the expected code is never written', async (t) => {
  const undeclared = [
    ['no schema', undefined],
    ['read-only', controlSchema.map((e) => (e.id === 1 ? { ...e, mode: 'ro' } : e))],
    [
      'other type',
      controlSchema.map((e) => (e.id === 1 ? { ...e, property: { type: 'value' } } : e)),
    ],
    ['other code', controlSchema.map((e) => (e.id === 1 ? { ...e, code: 'other' } : e))],
    ['absent', controlSchema.filter((e) => e.id !== 1)],
  ];
  for (const [label, schema] of undeclared) {
    const peer = await fakeMower(t, {
      versionHeader: true,
      respond: () => JSON.stringify({ dps: idle }),
    });
    const client = new EufyClient({
      mowers: {
        credentials,
        sessionStore: memory(),
        home: { fetch: cloud({ schema }) },
        commands: optIn,
      },
    });
    t.after(() => client.shutdown());
    await client.mowers.connect();
    const [device] = await client.mowers.discover();
    const session = await client.mowers.openLocalSession(device.id, {
      host: peer.host,
      port: peer.port,
    });
    await assert.rejects(
      session.sendCommand({ kind: 'start' }),
      { code: 'mower_command_undeclared' },
      label,
    );
    assert.equal(queried(peer), 0, label);
    await session.disconnect();
  }
});

test('invalid requests are refused before any query', async (t) => {
  const { peer, session } = await setup(t);
  for (const request of [
    undefined,
    null,
    'start',
    {},
    { kind: 'charge' },
    { kind: 'Stop' },
    { kind: 'start', readBackMs: 10 },
    { kind: 'start', readBackMs: 60_001 },
    { kind: 'start', readBackMs: '2000' },
    { kind: 'start', onProgress: 'report' },
    { kind: 'start', onProgress: {} },
  ])
    await assert.rejects(session.sendCommand(request), { code: 'mower_command_invalid' });
  assert.equal(queried(peer), 0);
});

test('one command owns the session, and a second command or read reports mower_local_busy', async (t) => {
  const { peer, session } = await setup(t, { commands: { ...optIn, readBackMs: 1000 } });
  const pending = session.sendCommand({ kind: 'start' });
  await assert.rejects(session.sendCommand({ kind: 'pause' }), { code: 'mower_local_busy' });
  await assert.rejects(session.receiveReport(), { code: 'mower_local_busy' });
  await assert.rejects(session.queryStatus(), { code: 'mower_local_busy' });
  const outcome = await pending;
  assert.equal(outcome.end, 'timed_out');
  assert.equal(written(peer), 1);
});

test('peer loss during the read-back closes the session without reconnect or replay', async (t) => {
  const { peer, session } = await setup(t, {
    peer: {
      onWrite: (dps, report) => {
        report({ 103: control() });
        setTimeout(() => peer.drop(), 50);
      },
    },
  });
  await assert.rejects(session.sendCommand({ kind: 'start' }), {
    code: 'mower_local_disconnected',
  });
  assert.equal(await session.closed, 'peer_closed');
  assert.equal(session.connected, false);
  await assert.rejects(session.sendCommand({ kind: 'start' }), {
    code: 'mower_local_disconnected',
  });
  await delay(50);
  assert.equal(peer.connections, 1);
  assert.equal(written(peer), 1);
});

test('cancellation and client shutdown end a pending read-back and release the socket', async (t) => {
  const first = await setup(t, { commands: { ...optIn, readBackMs: 20_000 } });
  const cancel = new AbortController();
  const pending = assert.rejects(first.session.sendCommand({ kind: 'return' }, cancel.signal), {
    code: 'request_aborted',
  });
  await delay(30);
  cancel.abort();
  await pending;
  assert.equal(await first.session.closed, 'aborted');
  for (let i = 0; i < 100 && first.peer.live; i++) await delay(5);
  assert.equal(first.peer.live, 0);
  assert.equal(written(first.peer), 1);

  const second = await setup(t, { commands: { ...optIn, readBackMs: 20_000 } });
  const stopped = assert.rejects(second.session.sendCommand({ kind: 'return' }), {
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
  const outcome = await session.sendCommand({ kind: 'start' });
  assert.equal(outcome.end, 'report_limit');
  assert.equal(outcome.stage, 'sent');
  assert.equal(outcome.reports.length, 64);
  assert.equal(session.connected, true);
});

test('the hard deadline still applies when the device never answers the fresh query', async (t) => {
  const { session } = await setup(t, { peer: { hang: true }, timeoutMs: 300 });
  await assert.rejects(session.sendCommand({ kind: 'start' }), { code: 'request_timeout' });
  assert.equal(await session.closed, 'timeout');
});

test('a long read-back keeps the transport alive with heartbeats only', async (t) => {
  const { peer, session } = await setup(t, { commands: { ...optIn, readBackMs: 12_000 } });
  const pending = session.sendCommand({ kind: 'start' });
  for (let i = 0; i < 240 && !peer.received.some((x) => x.type === 9); i++) await delay(50);
  assert.ok(peer.received.some((x) => x.type === 9));
  peer.report({ 107: status({ 1: 2, 3: 1 }) });
  const outcome = await pending;
  assert.equal(outcome.end, 'reflected');
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13, 9],
  );
});

test('outcomes are private copies without device identity and consumers cannot alter the table', async (t) => {
  const { session } = await setup(t, {
    peer: { onWrite: (dps, report) => report({ 107: status({ 1: 2, 3: 1 }) }) },
  });
  const outcome = await session.sendCommand({ kind: 'start' });
  assert.ok(!JSON.stringify(outcome).includes('SYNTHETIC-DEVICE-ID'));
  outcome.write.value = false;
  outcome.reports.length = 0;
  assert.equal(COMMANDS.start.write.value, true);
  assert.throws(() => {
    COMMANDS.start.write.value = false;
  }, TypeError);
});

test('stop writes switch_go false and reads the map-saving payload back as its reflection', async (t) => {
  const { peer, session } = await setup(t, {
    dps: { ...idle, 1: true },
    peer: {
      onWrite: (dps, report) => {
        assert.deepEqual(dps, { 1: false });
        // The order recorded after the app's Stop: control point, pause cleared, the map-saving
        // payload, the save progress, then the written point and the field 6 payload.
        report({ 104: control() }, { sequence: 81 });
        report({ 2: false }, { sequence: 82 });
        report({ 118: 0 }, { sequence: 83 });
        report({ 107: status({ 2: 5, 3: 1 }) }, { sequence: 84 });
        report({ 118: 1 }, { sequence: 85 });
        report({ 1: false }, { sequence: 86 });
        report({ 107: status({ 6: 1 }) }, { sequence: 87 });
      },
    },
  });
  const outcome = await session.sendCommand({ kind: 'stop' });
  assert.equal(outcome.command, 'stop');
  assert.deepEqual(outcome.write, { dp: '1', code: 'switch_go', value: false });
  assert.equal(outcome.stage, 'reflected');
  assert.equal(outcome.end, 'reflected');
  assert.equal(outcome.acknowledgement.dp, '104');
  assert.equal(outcome.acknowledgement.sequence, 81);
  assert.equal(outcome.activity, undefined, 'stop has no confirmed activity');
  assert.deepEqual(outcome.payload, {
    observedAt: outcome.payload.observedAt,
    sequence: 84,
    name: 'map_saving',
  });
  assert.deepEqual(
    outcome.reports.map((r) => r.sequence),
    [81, 82, 83, 84],
    'the read-back stops at the reflection',
  );
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 13],
  );
  assert.deepEqual(peer.writes[0].dps, { 1: false });
});

test('stop reports its progress while the read-back runs and a failing callback changes nothing', async (t) => {
  const reports = (report) => {
    // As recorded on 2026-09-20: the control point, `returning` within a second, the written
    // point, then the map-saving payload at the dock arrival.
    report({ 104: control() }, { sequence: 91 });
    report({ 107: status({ 1: 1, 3: 1 }) }, { sequence: 92 });
    report({ 1: false }, { sequence: 93 });
    report({ 107: status({ 1: 1, 2: 1, 3: 1 }) }, { sequence: 94 });
    report({ 107: status({ 2: 5, 3: 1 }) }, { sequence: 95 });
  };
  const events = [];
  const { session } = await setup(t, {
    dps: { ...idle, 1: true },
    peer: { onWrite: (_dps, report) => reports(report) },
  });
  const outcome = await session.sendCommand({
    kind: 'stop',
    onProgress: (event) => events.push(event),
  });
  assert.equal(outcome.end, 'reflected');
  assert.equal(outcome.payload.sequence, 95);
  assert.deepEqual(
    events.map(({ kind, sequence, dp, value }) => ({
      kind,
      sequence,
      ...(dp ? { dp } : {}),
      ...(value ? { value } : {}),
    })),
    [
      { kind: 'acknowledged', sequence: 91, dp: '104' },
      { kind: 'activity', sequence: 92, value: 'returning' },
      { kind: 'activity', sequence: 94, value: 'returning' },
    ],
    'the acknowledgement and every confirmed activity, never the map-saving payload',
  );
  assert.ok(
    events.every((event) => Object.isFrozen(event) && typeof event.observedAt === 'string'),
  );
  assert.equal(outcome.activity, undefined, 'progress never adds an activity to a stop outcome');

  const failing = await setup(t, {
    dps: { ...idle, 1: true },
    peer: { onWrite: (_dps, report) => reports(report) },
  });
  const unchanged = await failing.session.sendCommand({
    kind: 'stop',
    onProgress: () => {
      throw new Error('consumer failure');
    },
  });
  assert.equal(unchanged.end, 'reflected');
  assert.equal(unchanged.stage, 'reflected');
  assert.deepEqual(
    unchanged.reports.map((r) => r.sequence),
    [91, 92, 93, 94, 95],
  );
  assert.equal(written(failing.peer), 1, 'written once, never again');
});

test('start reports the acknowledgement and the reflecting activity as progress', async (t) => {
  const events = [];
  const { session } = await setup(t, {
    peer: {
      onWrite: (_dps, report) => {
        report({ 103: control() }, { sequence: 11 });
        report({ 107: status({ 1: 2, 3: 1 }) }, { sequence: 12 });
      },
    },
  });
  const outcome = await session.sendCommand({
    kind: 'start',
    onProgress: (event) => events.push(event),
  });
  assert.equal(outcome.end, 'reflected');
  assert.deepEqual(
    events.map(({ kind, sequence }) => [kind, sequence]),
    [
      ['acknowledged', 11],
      ['activity', 12],
    ],
  );
  assert.equal(events[1].value, 'mowing');
});

test('stop without the map-saving payload ends at the evidenced stage and other DP 107 shapes never reflect it', async (t) => {
  for (const [name, reports, stage, ackDp] of [
    ['only the written point', [{ 1: false }], 'acknowledged', '1'],
    ['a mowing payload', [{ 107: status({ 1: 2, 3: 1 }) }], 'sent', undefined],
    ['map saving plus field 6', [{ 107: status({ 2: 5, 3: 1, 6: 1 }) }], 'sent', undefined],
    [
      'map saving with a bytes record',
      [{ 107: Buffer.from([0x12, 0x01, 0x05, 0x18, 0x01]).toString('base64') }],
      'sent',
      undefined,
    ],
    ['the default payload', [{ 107: '' }], 'sent', undefined],
  ]) {
    const { session } = await setup(t, {
      dps: { ...idle, 1: true },
      peer: {
        onWrite: (_dps, report) => {
          let sequence = 90;
          for (const dps of reports) report(dps, { sequence: sequence++ });
        },
      },
    });
    const outcome = await session.sendCommand({ kind: 'stop', readBackMs: 1000 });
    assert.equal(outcome.stage, stage, name);
    assert.equal(outcome.end, 'timed_out', name);
    assert.equal(outcome.payload, undefined, name);
    assert.equal(outcome.acknowledgement?.dp, ackDp, name);
    await session.disconnect();
  }
});

test('return is written only from the stopped task, so stop then return runs on one session without replay', async (t) => {
  const state = { ...idle, 1: true, 2: false };
  const { peer, session } = await setup(t, {
    peer: {
      respond: () => JSON.stringify({ dps: state }),
      onWrite: (dps, report) => {
        if (dps[1] === false) {
          report({ 104: control() }, { sequence: 91 });
          report({ 107: status({ 2: 5, 3: 1 }) }, { sequence: 92 });
          // The device finishes the save after the read-back returned.
          state[1] = false;
          state[118] = 100;
          return;
        }
        assert.deepEqual(dps, { 3: true });
        report({ 103: control() }, { sequence: 93 });
        report({ 107: status({ 1: 1 }) }, { sequence: 94 });
        report({ 107: status({ 1: 1, 3: 1 }) }, { sequence: 95 });
      },
    },
  });
  // Refused while the task is active: nothing written.
  await assert.rejects(session.sendCommand({ kind: 'return' }), {
    code: 'mower_command_task_active',
  });
  assert.equal(peer.writes.length, 0);
  const stopped = await session.sendCommand({ kind: 'stop' });
  assert.equal(stopped.end, 'reflected');
  assert.equal(stopped.payload.name, 'map_saving');
  const returned = await session.sendCommand({ kind: 'return' });
  assert.equal(returned.command, 'return');
  assert.deepEqual(returned.before.dps, { ...idle, 1: false, 2: false, 118: 100 });
  assert.equal(returned.stage, 'reflected');
  assert.deepEqual(returned.activity, {
    observedAt: returned.activity.observedAt,
    sequence: 95,
    value: 'returning',
  });
  assert.deepEqual(
    peer.received.map((x) => x.type),
    [3, 5, 16, 16, 13, 16, 13],
    'three fresh queries, two writes, nothing repeated',
  );
  assert.deepEqual(
    peer.writes.map((w) => w.dps),
    [{ 1: false }, { 3: true }],
  );
});
