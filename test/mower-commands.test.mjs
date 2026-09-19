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

test('the command table is frozen and can only write the four declared boolean points', () => {
  assert.ok(Object.isFrozen(COMMANDS));
  assert.deepEqual(
    Object.entries(COMMANDS).map(([kind, c]) => [
      kind,
      c.write.dp,
      c.write.code,
      c.write.value,
      c.control,
      c.activity,
    ]),
    [
      ['start', '1', 'switch_go', true, '103', 'mowing'],
      ['pause', '2', 'pause', true, '105', 'paused'],
      ['resume', '2', 'pause', false, '106', 'mowing'],
      ['return', '3', 'switch_charge', true, '103', 'returning'],
    ],
  );
  for (const c of Object.values(COMMANDS))
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.write));
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
    { kind: 'stop' },
    { kind: 'charge' },
    { kind: 'start', readBackMs: 10 },
    { kind: 'start', readBackMs: 60_001 },
    { kind: 'start', readBackMs: '2000' },
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
