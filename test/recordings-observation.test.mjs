import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { Station } from '../dist/vendor/http/index.js';
import { CommandName } from '../dist/vendor/http/types.js';
import { CommandType, P2PDataType } from '../dist/vendor/p2p/types.js';

// ha-eufy-cam#152: what a recording operation saw, for a standalone T8410 and a
// HomeBase 3 owner. A real vendor Station and P2P session without a socket. Device
// answers pass through the session's own CMD_DATABASE parser and its command
// result handling. All rows, DIDs, addresses and paths are synthetic.
const DAY = '2026-10-15';
const t8410 = {
  category: 'eufy_security',
  device_sn: 'T8410_FIXTURE',
  parent_sn: '',
  device_model: 'T8410',
  device_type: 31,
  device_channel: 0,
  device_name: 'Synthetic Indoor Pan Tilt',
  main_sw_version: '2.3.2.4',
  p2p_did: 'SYNTHETIC-000003-ABCDE',
  p2p_license: 'SYNTHETIC',
  member: { admin_user_id: 'synthetic-admin' },
  params: [{ param_type: 1176, param_value: '192.168.1.42' }],
};
const homeBase = {
  category: 'eufy_security',
  device_sn: 'T8030_OWNER',
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  main_sw_version: '3.8.7.4',
  p2p_did: 'SYNTHETIC-000002-ABCDE',
  p2p_license: 'SYNTHETIC',
  member: { admin_user_id: 'synthetic-admin' },
  params: [{ param_type: 1176, param_value: '192.168.1.41' }],
};
const eufyCam = {
  category: 'eufy_security',
  device_sn: 'T8161_FIXTURE',
  parent_sn: 'T8030_OWNER',
  device_model: 'T8161',
  device_type: 23,
  device_channel: 1,
  device_name: 'Synthetic eufyCam',
  params: [],
};
const owners = {
  standalone: { rows: [t8410], owner: 'T8410_FIXTURE', camera: 'T8410_FIXTURE' },
  station: { rows: [homeBase, eufyCam], owner: 'T8030_OWNER', camera: 'T8161_FIXTURE' },
};
const secrets = [
  'FIXTURE',
  'OWNER',
  'SYNTHETIC',
  'synthetic',
  '192.168',
  '/media',
  'mmcblk',
  'T8410',
  'T8030',
  'T8161',
];
const pageKeys = ['ackCode', 'answered', 'elapsedMs', 'limit', 'resultCode', 'rows'];
const observationKeys = [
  'code',
  'elapsedMs',
  'operation',
  'owner',
  'pages',
  'remoteCode',
  'rowClasses',
  'sessionOpen',
  'stage',
  'unhandledReason',
  'unhandledReplies',
  'unhandledResultCode',
];
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const code = (value) => value === null || int(value, -999999, 999999);
/** The page sizes each operation may request. */
const pageLimits = (operation) => (operation === 'probe' ? [20] : [0, 100, 500, 2000, 10000]);

/** The single observation of an operation, checked for shape, bounds and privacy. */
function only(observations) {
  assert.equal(observations.length, 1);
  const [observation] = observations;
  assert.deepEqual(Object.keys(observation).sort(), observationKeys);
  assert.ok(int(observation.elapsedMs, 0, 3_600_000));
  assert.ok(code(observation.remoteCode) && code(observation.unhandledResultCode));
  assert.ok(int(observation.unhandledReplies, 0, 99));
  assert.ok(observation.pages.length <= 4);
  for (const page of observation.pages) {
    assert.deepEqual(Object.keys(page).sort(), pageKeys);
    assert.ok(pageLimits(observation.operation).includes(page.limit));
    assert.ok(int(page.elapsedMs, 0, 3_600_000));
    assert.ok(code(page.ackCode) && code(page.resultCode));
    assert.ok(page.rows === null || int(page.rows, 0, 10000));
  }
  for (const value of Object.values(observation.rowClasses ?? {})) assert.ok(int(value, 0, 10000));
  const text = JSON.stringify(observation);
  for (const secret of secrets) assert.equal(text.includes(secret), false, secret);
  return observation;
}
/** The observation without its timings, for exact comparisons. */
const timeless = ({ elapsedMs, pages, ...rest }) => ({
  ...rest,
  pages: pages.map(({ elapsedMs: _, ...page }) => page),
});

const clock = (minute, second) =>
  `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
const record = (owner, camera, id, extra = {}) => ({
  device_sn: camera,
  station_sn: owner,
  device_type: 31,
  record_id: id,
  start_time: `${DAY} 10:${clock(Math.floor(id / 60), id % 60)}`,
  end_time: `${DAY} 11:${clock(Math.floor(id / 60), id % 60)}`,
  storage_path: `/media/mmcblk0p1/Camera00/${id}.dat`,
  thumb_path: `/media/mmcblk0p1/Camera00/${id}.jpg`,
  cipher_id: 0,
  folder_size: 1000,
  frame_num: 450,
  trigger_type: 1,
  video_type: 0,
  storage_type: 1,
  storage_cloud: 0,
  ...extra,
});
const byDate = (data, mIntRet = 0) => ({
  cmd: CommandType.CMD_DATABASE_QUERY_BY_DATE,
  mIntRet,
  data,
  table: 'history_record_info',
  transaction: '1',
  version: '1.1.0.1',
  msg: '',
});
const countByDate = (data, mIntRet = 0) => ({
  cmd: CommandType.CMD_DATABASE_COUNT_BY_DATE,
  mIntRet,
  data,
  table: 'history_record_info',
  transaction: '1',
  version: '1.1.0.1',
  msg: '',
});

/**
 * A loaded transport with a real vendor Station for one owner. Sends are
 * captured instead of leaving a socket. `reply` feeds a CMD_DATABASE CONTROL
 * message through the session's parser, `ack` the session's result for a sent
 * command through its DATA result handling.
 */
async function rig(kind, { connected = true } = {}) {
  const { rows, owner, camera } = owners[kind];
  const transport = new DeviceTransport();
  const inventory = discover(rows, { experimentalStandalone: true });
  await transport.load(inventory.raw, inventory);
  const station = transport.stations.get(owner);
  assert.ok(station instanceof Station);
  const session = station.p2pSession;
  session.sendMessage = async () => {};
  if (connected) {
    session.connected = true;
    session.connectAddress = { host: '192.0.2.1', port: 32108 };
    transport.encryption.set(owner, 'lan-derived');
  }
  const sent = [],
    unhandled = [];
  let closes = 0,
    sequence = 1000,
    responder;
  const close = station.close.bind(station);
  station.close = async () => {
    closes++;
    return close();
  };
  session.sendCommandWithStringPayload = (command, customData) => {
    const entry = { command, customData, json: JSON.parse(command.value) };
    sent.push(entry);
    if (responder) setImmediate(() => responder(entry));
  };
  station.on('database unhandled', (_station, info) => unhandled.push(info));
  const results = station.listenerCount('command result');
  return {
    transport,
    station,
    session,
    sent,
    unhandled,
    owner,
    camera,
    closes: () => closes,
    respond(fn) {
      responder = fn;
    },
    reply(body) {
      session.handleDataControl({
        commandId: CommandType.CMD_DATABASE,
        channel: 0,
        signCode: 0,
        type: 0,
        seqNo: 0,
        dataType: P2PDataType.CONTROL,
        data: Buffer.from((typeof body === 'string' ? body : JSON.stringify(body)) + '\0'),
      });
    },
    ack(entry, returnCode) {
      const seqNo = sequence++;
      session.messageStates.set(seqNo, {
        sequence: seqNo,
        commandType: entry.command.commandType,
        nestedCommandType: entry.json.cmd,
        channel: entry.command.channel ?? 0,
        data: Buffer.alloc(0),
        retries: 0,
        acknowledged: true,
        customData: entry.customData,
      });
      const data = Buffer.alloc(4);
      data.writeInt32LE(returnCode);
      session.handleData({
        dataType: P2PDataType.DATA,
        type: 1,
        seqNo,
        commandId: entry.command.commandType,
        bytesToRead: 4,
        signCode: 0,
        channel: 0,
        data,
      });
    },
    /** The operation removed every listener it added. */
    released() {
      assert.equal(station.listenerCount('database unhandled'), 1);
      assert.equal(station.listenerCount('command result'), results);
    },
    async done() {
      session.connected = false;
      await transport.close();
    },
  };
}
const settled = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ code: error.code, remoteCode: error.remoteCode }),
  );
const turns = async (count = 5) => {
  for (let i = 0; i < count; i++) await turn();
};

test('a standalone list reports its page, the ACK and the classes of its rows', async () => {
  const r = await rig('standalone');
  const observations = [];
  try {
    const { owner, camera } = r;
    const rows = [
      record(owner, camera, 1),
      // Own, but started on the previous day, and without a cipher ID field.
      record(owner, camera, 2, {
        start_time: '2026-10-14 23:59:00',
        end_time: `${DAY} 00:00:30`,
        cipher_id: undefined,
      }),
      // Another device, with a compact time the vendor parser turns into an invalid date.
      record('T8410_OTHER', 'T8410_OTHER', 3, {
        start_time: '20261015100000',
        cipher_id: undefined,
      }),
      // Another device with a null cipher ID.
      record(owner, 'T8410_OTHER', 4, { cipher_id: null }),
    ];
    r.respond((entry) => {
      // A result for another command, such as a latest-info refresh, is not this page's ACK.
      r.ack(
        { ...entry, customData: { command: { name: CommandName.StationDatabaseQueryLatestInfo } } },
        -1,
      );
      r.ack(entry, 0);
      r.reply(byDate(rows));
    });
    const result = await r.transport.recordings.list(owner, DAY, undefined, {
      onObservation: (o) => observations.push(o),
    });
    assert.equal(result.returned, 4);
    assert.deepEqual(
      result.recordings.map((recording) => [recording.deviceId, recording.start]),
      [[camera, `${DAY}T10:00:01`]],
    );
    const observation = only(observations);
    assert.deepEqual(timeless(observation), {
      operation: 'list',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'validate',
      code: null,
      remoteCode: null,
      pages: [{ limit: 100, answered: true, ackCode: 0, resultCode: 0, rows: 4 }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: {
        own: 2,
        otherDevice: 2,
        stationMismatch: 0,
        invalidTime: 1,
        otherDay: 1,
        cipherId: 2,
      },
    });
    assert.equal(r.closes(), 0);
    r.released();
  } finally {
    await r.done();
  }
});

test('a list counts a station mismatch and widens to the next page', async () => {
  const r = await rig('standalone');
  const observations = [];
  try {
    const { owner, camera } = r;
    const full = Array.from({ length: 100 }, (_, i) => record(owner, camera, i + 1));
    r.respond((entry) => {
      const count = entry.json.payload.payload.count;
      r.reply(byDate(count === 100 ? full : [...full, record('T8030_OWNER', camera, 101, {})]));
    });
    const outcome = await settled(
      r.transport.recordings.list(owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'invalid_recording', remoteCode: undefined });
    const observation = only(observations);
    assert.equal(observation.stage, 'validate');
    assert.deepEqual(
      observation.pages.map(({ limit, answered, rows }) => [limit, answered, rows]),
      [
        [100, true, 100],
        [500, true, 101],
      ],
    );
    assert.deepEqual(observation.rowClasses, {
      own: 100,
      otherDevice: 0,
      stationMismatch: 1,
      invalidTime: 0,
      otherDay: 0,
      cipherId: 101,
    });
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('history_rejected reports the answer and its result code', async () => {
  const r = await rig('standalone');
  const observations = [];
  try {
    r.respond(() => r.reply(byDate('[]', -1100)));
    const outcome = await settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'history_rejected', remoteCode: -1100 });
    assert.deepEqual(timeless(only(observations)), {
      operation: 'list',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'validate',
      code: 'history_rejected',
      remoteCode: -1100,
      pages: [{ limit: 100, answered: true, ackCode: null, resultCode: -1100, rows: 0 }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: {
        own: 0,
        otherDevice: 0,
        stationMismatch: 0,
        invalidTime: 0,
        otherDay: 0,
        cipherId: 0,
      },
    });
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('a negative ACK without an answer keeps device_request_timeout and reports ackCode', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await rig('standalone');
  const observations = [];
  try {
    r.respond((entry) => r.ack(entry, -104));
    const listing = settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    await turns();
    assert.equal(observations.length, 0);
    t.mock.timers.tick(15000);
    assert.deepEqual(await listing, { code: 'device_request_timeout', remoteCode: undefined });
    assert.deepEqual(timeless(only(observations)), {
      operation: 'list',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'query',
      code: 'device_request_timeout',
      remoteCode: null,
      pages: [{ limit: 100, answered: false, ackCode: -104, resultCode: null, rows: null }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    assert.equal(r.sent.length, 1);
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a reply without an inner command is counted as unhandled and still times out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await rig('standalone');
  const observations = [];
  try {
    r.respond(() => r.reply({ mIntRet: -6006, msg: 'ERROR_NO_SUPPORT', version: '1.2.0.1' }));
    const listing = settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    await turns();
    // The vendor event carries numbers only.
    assert.deepEqual(r.unhandled, [{ innerCmd: null, resultCode: -6006, reason: 'unknown_cmd' }]);
    t.mock.timers.tick(15000);
    assert.deepEqual(await listing, { code: 'device_request_timeout', remoteCode: undefined });
    const observation = only(observations);
    assert.deepEqual(
      {
        unhandledReplies: observation.unhandledReplies,
        unhandledReason: observation.unhandledReason,
        unhandledResultCode: observation.unhandledResultCode,
        stage: observation.stage,
        answered: observation.pages[0].answered,
      },
      {
        unhandledReplies: 1,
        unhandledReason: 'unknown_cmd',
        unhandledResultCode: -6006,
        stage: 'query',
        answered: false,
      },
    );
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('replies the session cannot parse are counted as parse_error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await rig('standalone');
  const observations = [];
  try {
    r.respond(() => {
      // The inner command parses, its rows do not.
      r.reply(byDate({ total: 0 }));
      r.reply('not json');
    });
    const listing = settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    await turns();
    assert.deepEqual(r.unhandled, [
      { innerCmd: CommandType.CMD_DATABASE_QUERY_BY_DATE, resultCode: 0, reason: 'parse_error' },
      { innerCmd: null, resultCode: null, reason: 'parse_error' },
    ]);
    t.mock.timers.tick(15000);
    assert.deepEqual(await listing, { code: 'device_request_timeout', remoteCode: undefined });
    const observation = only(observations);
    assert.equal(observation.unhandledReplies, 2);
    assert.equal(observation.unhandledReason, 'parse_error');
    assert.equal(observation.unhandledResultCode, null);
    assert.equal(observation.pages[0].answered, false);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a session close during the query reports device_disconnected', async () => {
  const r = await rig('standalone');
  const observations = [];
  try {
    r.respond(() => void r.session.close());
    const outcome = await settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'device_disconnected', remoteCode: undefined });
    const observation = only(observations);
    assert.equal(observation.stage, 'query');
    assert.equal(observation.sessionOpen, true);
    assert.deepEqual(
      observation.pages.map(({ answered, ackCode }) => [answered, ackCode]),
      [[false, null]],
    );
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('admission refusals are reported before any connection or command', async () => {
  const busy = await rig('standalone');
  const observations = [];
  try {
    busy.transport.starting.set(busy.owner, 0);
    const outcome = await settled(
      busy.transport.recordings.list(busy.owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'station_busy', remoteCode: undefined });
    assert.deepEqual(timeless(only(observations)), {
      operation: 'list',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'admission',
      code: 'station_busy',
      remoteCode: null,
      pages: [],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    assert.equal(busy.sent.length, 0);
    assert.equal(busy.closes(), 0);
    busy.transport.starting.delete(busy.owner);
  } finally {
    await busy.done();
  }
  // Another connection attempt for the owner is in flight.
  const connecting = await rig('standalone', { connected: false });
  observations.length = 0;
  try {
    connecting.transport.connecting.set(connecting.owner, new Promise(() => {}));
    const outcome = await settled(
      connecting.transport.recordings.calendar(connecting.owner, '2026-10', {
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'connection_busy', remoteCode: undefined });
    const observation = only(observations);
    assert.equal(observation.operation, 'calendar');
    assert.equal(observation.stage, 'connect');
    assert.equal(observation.sessionOpen, false);
    assert.deepEqual(observation.pages, []);
    assert.equal(connecting.sent.length, 0);
    connecting.transport.connecting.delete(connecting.owner);
  } finally {
    await connecting.done();
  }
  // Invalid input is refused at admission too.
  const input = await rig('standalone');
  observations.length = 0;
  try {
    const outcome = await settled(
      input.transport.recordings.list(input.owner, '2026-02-30', undefined, {
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'invalid_recording_date', remoteCode: undefined });
    assert.equal(only(observations).stage, 'admission');
  } finally {
    await input.done();
  }
});

test('a failed connect reports its stage and forwards progress and lookup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await rig('standalone', { connected: false });
  const observations = [],
    progress = [],
    lookups = [];
  try {
    // The camera answers the lookup and never completes the handshake.
    r.station.connect = async () => {
      r.station.emit('station found', r.station);
    };
    const listing = settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (o) => observations.push(o),
        onProgress: (p) => progress.push(p.stage),
        onLookup: (l) => lookups.push(l),
      }),
    );
    await turns();
    t.mock.timers.tick(20000);
    assert.deepEqual(await listing, { code: 'device_request_timeout', remoteCode: undefined });
    assert.deepEqual(progress, ['lookup', 'station_found']);
    assert.equal(lookups.length, 1);
    assert.deepEqual(timeless(only(observations)), {
      operation: 'list',
      owner: 'standalone',
      sessionOpen: false,
      stage: 'connect',
      code: 'device_request_timeout',
      remoteCode: null,
      pages: [],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    assert.equal(r.sent.length, 0);
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a cancelled list reports cancelled at its stage and closes the owner session', async () => {
  const r = await rig('standalone');
  const observations = [];
  try {
    const controller = new AbortController();
    r.respond(() => controller.abort());
    const outcome = await settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        signal: controller.signal,
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'cancelled', remoteCode: undefined });
    const observation = only(observations);
    assert.equal(observation.code, 'cancelled');
    assert.equal(observation.stage, 'query');
    assert.equal(observation.pages.length, 1);
    assert.equal(observation.pages[0].answered, false);
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('a calendar reports its single page, and calendar_rejected its result code', async () => {
  const r = await rig('standalone');
  const observations = [];
  try {
    r.respond((entry) => {
      r.ack(entry, 0);
      r.reply(
        countByDate([
          { days: '20261015', count: 3 },
          { days: '20261014', count: 0 },
        ]),
      );
    });
    const days = await r.transport.recordings.calendar(r.owner, '2026-10', {
      onObservation: (o) => observations.push(o),
    });
    assert.deepEqual(days, ['2026-10-15']);
    assert.deepEqual(timeless(only(observations)), {
      operation: 'calendar',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'validate',
      code: null,
      remoteCode: null,
      pages: [{ limit: 0, answered: true, ackCode: 0, resultCode: 0, rows: 2 }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    r.released();
    observations.length = 0;
    r.respond(() => r.reply(countByDate('[]', -1)));
    const outcome = await settled(
      r.transport.recordings.calendar(r.owner, '2026-10', {
        onObservation: (o) => observations.push(o),
      }),
    );
    assert.deepEqual(outcome, { code: 'calendar_rejected', remoteCode: -1 });
    const rejected = only(observations);
    assert.equal(rejected.stage, 'validate');
    assert.deepEqual(rejected.pages, [
      {
        limit: 0,
        elapsedMs: rejected.pages[0].elapsedMs,
        answered: true,
        ackCode: null,
        resultCode: -1,
        rows: 0,
      },
    ]);
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('download and thumbnail refusals are observed at their stage', async () => {
  const r = await rig('standalone');
  const observations = [];
  try {
    r.respond(() => r.reply(byDate([record(r.owner, r.camera, 1)])));
    const { recordings } = await r.transport.recordings.list(r.owner, DAY);
    const [{ id }] = recordings;
    const sent = r.sent.length;
    // The record carries cipher ID 0, which a standalone owner cannot decrypt.
    const outcome = await settled(
      r.transport.recordings.download(id, { onObservation: (o) => observations.push(o) }),
    );
    assert.deepEqual(outcome, { code: 'recording_cipher_unavailable', remoteCode: undefined });
    assert.deepEqual(timeless(only(observations)), {
      operation: 'download',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'admission',
      code: 'recording_cipher_unavailable',
      remoteCode: null,
      pages: [],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    assert.equal(r.sent.length, sent);
    // ha-eufy-cam#175: a standalone thumbnail is refused before any image request.
    // A record without a cipher ID reaches the same refusal in a download.
    const images = [];
    r.station.downloadImage = (path) => {
      images.push(path);
      setImmediate(() => r.station.emit('image download', r.station, path, Buffer.from('text')));
    };
    r.respond(() => r.reply(byDate([record(r.owner, r.camera, 2, { cipher_id: undefined })])));
    const [{ id: plain }] = (await r.transport.recordings.list(r.owner, DAY)).recordings;
    const listed = r.sent.length;
    for (const [operation, recording] of [
      ['thumbnail', id],
      ['download', plain],
    ]) {
      observations.length = 0;
      const refused = await settled(
        r.transport.recordings[operation](recording, {
          onObservation: (o) => observations.push(o),
        }),
      );
      assert.deepEqual(
        refused,
        { code: 'standalone_recordings_unverified', remoteCode: undefined },
        operation,
      );
      assert.deepEqual(timeless(only(observations)), {
        operation,
        owner: 'standalone',
        sessionOpen: true,
        stage: 'admission',
        code: 'standalone_recordings_unverified',
        remoteCode: null,
        pages: [],
        unhandledReplies: 0,
        unhandledReason: null,
        unhandledResultCode: null,
        rowClasses: null,
      });
    }
    assert.deepEqual(images, []);
    assert.equal(r.sent.length, listed);
    // An unknown recording ID has no known owner.
    observations.length = 0;
    await settled(
      r.transport.recordings.thumbnail('unknown', { onObservation: (o) => observations.push(o) }),
    );
    const expired = only(observations);
    assert.deepEqual(
      [expired.code, expired.stage, expired.owner, expired.sessionOpen],
      ['recording_expired', 'admission', 'station', false],
    );
    assert.equal(r.closes(), 0);
    r.released();
  } finally {
    await r.done();
  }
});

test('a HomeBase thumbnail answer that is not a JPEG fails its validation', async () => {
  const r = await rig('station');
  const observations = [];
  try {
    r.respond(() => r.reply(byDate([record(r.owner, r.camera, 1)])));
    const { recordings } = await r.transport.recordings.list(r.owner, DAY);
    const [{ id }] = recordings;
    r.station.downloadImage = (path) =>
      setImmediate(() => r.station.emit('image download', r.station, path, Buffer.from('text')));
    const thumbnail = await settled(
      r.transport.recordings.thumbnail(id, { onObservation: (o) => observations.push(o) }),
    );
    assert.deepEqual(thumbnail, { code: 'invalid_thumbnail', remoteCode: undefined });
    const observation = only(observations);
    assert.deepEqual(
      [observation.operation, observation.owner, observation.stage, observation.code],
      ['thumbnail', 'station', 'validate', 'invalid_thumbnail'],
    );
    assert.deepEqual(observation.pages, []);
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('the AbortSignal form keeps working without an observation', async () => {
  const r = await rig('standalone');
  try {
    r.respond(() => r.reply(byDate([record(r.owner, r.camera, 1)])));
    const listed = await r.transport.recordings.list(
      r.owner,
      DAY,
      [r.camera],
      new AbortController().signal,
    );
    assert.equal(listed.recordings.length, 1);
    // Without onObservation the operation adds no listener.
    let added = 0;
    const count = (event) => {
      if (event === 'command result' || event === 'database unhandled') added++;
    };
    r.station.on('newListener', count);
    await r.transport.recordings.list(r.owner, DAY);
    r.station.off('newListener', count);
    assert.equal(added, 0);
    // An aborted signal cancels, and the failed operation closes the session as before.
    assert.deepEqual(
      await settled(r.transport.recordings.calendar(r.owner, '2026-10', AbortSignal.abort())),
      { code: 'cancelled', remoteCode: undefined },
    );
    assert.equal(r.closes(), 1);
  } finally {
    await r.done();
  }
});

test('the client passes a signal or recording options through unchanged', async () => {
  const calls = [];
  const recordings = Object.fromEntries(
    ['list', 'calendar', 'thumbnail', 'download'].map((name) => [
      name,
      async (...args) => calls.push([name, ...args]),
    ]),
  );
  const client = { deviceTransport: async () => ({ recordings }) };
  const signal = new AbortController().signal;
  const options = { signal, onObservation() {}, onProgress() {}, onLookup() {} };
  const { prototype } = EufyMegaClient;
  await prototype.listRecordings.call(client, 'S', DAY);
  await prototype.listRecordings.call(client, 'S', DAY, ['C'], signal);
  await prototype.listRecordings.call(client, 'S', DAY, undefined, options);
  await prototype.recordingCalendar.call(client, 'S', '2026-10', signal);
  await prototype.recordingCalendar.call(client, 'S', '2026-10', options);
  await prototype.recordingThumbnail.call(client, 'R', signal);
  await prototype.recordingThumbnail.call(client, 'R', options);
  await prototype.downloadRecording.call(client, 'R', signal);
  await prototype.downloadRecording.call(client, 'R', options);
  assert.deepEqual(calls, [
    ['list', 'S', DAY, undefined, undefined],
    ['list', 'S', DAY, ['C'], signal],
    ['list', 'S', DAY, undefined, options],
    ['calendar', 'S', '2026-10', signal],
    ['calendar', 'S', '2026-10', options],
    ['thumbnail', 'R', signal],
    ['thumbnail', 'R', options],
    ['download', 'R', signal],
    ['download', 'R', options],
  ]);
});

test('a HomeBase 3 owner sends the identical 10006 payload and gets identical codes', async (t) => {
  const now = 1792000000000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  // The query exactly as 0.30.0 sends it, apart from the account of the owner.
  const payload = (count) =>
    JSON.stringify({
      account_id: 'synthetic-admin',
      cmd: CommandType.CMD_DATABASE,
      mChannel: 0,
      mValue3: 0,
      payload: {
        cmd: CommandType.CMD_DATABASE_QUERY_BY_DATE,
        payload: {
          count,
          detection_type: 0,
          device_info: [],
          end_date: '20261016',
          event_type: 0,
          flag: 0,
          res_unzip: 1,
          start_date: '20261015',
          start_time: '20261015000000',
          storage_cloud: -1,
          ai_type: 0,
        },
        table: 'history_record_info',
        transaction: `${now}`,
      },
    });
  const scenarios = {
    rows: (r) => () => r.reply(byDate([record(r.owner, r.camera, 1)])),
    rejected: (r) => () => r.reply(byDate('[]', -1100)),
    ackOnly: (r) => (entry) => r.ack(entry, -104),
    unhandled: (r) => () => r.reply({ mIntRet: -6006 }),
    closed: (r) => () => void r.session.close(),
  };
  const run = async (scenario, observe) => {
    t.mock.timers.setTime(now);
    const r = await rig('station');
    const observations = [];
    try {
      r.respond(scenarios[scenario](r));
      const listing = settled(
        r.transport.recordings.list(
          r.owner,
          DAY,
          undefined,
          observe ? { onObservation: (o) => observations.push(o) } : undefined,
        ),
      );
      await turns();
      t.mock.timers.tick(15000);
      const outcome = await listing;
      if (outcome.value) outcome.value = outcome.value.returned;
      if (observe) only(observations);
      return {
        outcome,
        closes: r.closes(),
        sent: r.sent.map(({ command, customData }) => ({
          commandType: command.commandType,
          channel: command.channel,
          value: command.value,
          name: customData?.command?.name,
        })),
        observation: observations[0] && timeless(observations[0]),
      };
    } finally {
      await r.done();
    }
  };
  try {
    const expected = {
      rows: { value: 1 },
      rejected: { code: 'history_rejected', remoteCode: -1100 },
      ackOnly: { code: 'device_request_timeout', remoteCode: undefined },
      unhandled: { code: 'device_request_timeout', remoteCode: undefined },
      closed: { code: 'device_disconnected', remoteCode: undefined },
    };
    for (const scenario of Object.keys(scenarios)) {
      const plain = await run(scenario, false);
      const observed = await run(scenario, true);
      assert.deepEqual(plain.outcome, expected[scenario], scenario);
      assert.deepEqual(observed.outcome, plain.outcome, scenario);
      assert.equal(observed.closes, plain.closes, scenario);
      assert.equal(plain.closes, scenario === 'rows' ? 0 : 1, scenario);
      assert.deepEqual(observed.sent, plain.sent, scenario);
      assert.deepEqual(plain.sent, [
        {
          commandType: CommandType.CMD_SET_PAYLOAD,
          channel: 0,
          value: payload(100),
          name: CommandName.StationDatabaseQueryByDate,
        },
      ]);
      assert.equal(observed.observation.owner, 'station', scenario);
      assert.equal(observed.observation.code, expected[scenario].code ?? null, scenario);
    }
    const ack = await run('ackOnly', true);
    assert.equal(ack.observation.pages[0].ackCode, -104);
    const unhandled = await run('unhandled', true);
    assert.equal(unhandled.observation.unhandledResultCode, -6006);
  } finally {
    t.mock.timers.reset();
  }
});

test('an onObservation that throws changes neither result nor error', async () => {
  const r = await rig('standalone');
  const fail = () => {
    throw new Error('consumer failure');
  };
  try {
    r.respond(() => r.reply(byDate([record(r.owner, r.camera, 1)])));
    const listed = await r.transport.recordings.list(r.owner, DAY, undefined, {
      onObservation: fail,
    });
    assert.equal(listed.returned, 1);
    assert.equal(listed.recordings.length, 1);
    r.released();
    r.respond(() => r.reply(byDate('[]', -1)));
    assert.deepEqual(
      await settled(r.transport.recordings.list(r.owner, DAY, undefined, { onObservation: fail })),
      { code: 'history_rejected', remoteCode: -1 },
    );
    assert.equal(r.closes(), 1);
    assert.equal(r.transport.recordings.busy(r.owner), false);
    r.released();
  } finally {
    await r.done();
  }
});

test('a session result timeout of an earlier list never counts, the result of the next list does', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await rig('standalone');
  let sequence = 5000;
  // The device acknowledges the frame on the transport. The session then waits up to
  // 30 s for the command result and reports -133 for that earlier query without one.
  const transportAck = (entry) => {
    const seqNo = sequence++;
    r.session.messageStates.set(seqNo, {
      sequence: seqNo,
      commandType: entry.command.commandType,
      nestedCommandType: entry.json.cmd,
      channel: 0,
      data: Buffer.alloc(0),
      retries: 0,
      acknowledged: false,
      customData: entry.customData,
    });
    const message = Buffer.alloc(10);
    message[0] = 0xf1;
    message[1] = 0xd1;
    message.writeUInt16BE(6, 2);
    message[4] = 0xd1;
    message[5] = P2PDataType.DATA;
    message.writeUInt16BE(1, 6);
    message.writeUInt16BE(seqNo, 8);
    r.session.handleMsg(message, {
      address: '192.0.2.1',
      port: 32108,
      family: 'IPv4',
      size: message.length,
    });
    return seqNo;
  };
  // The device's own command result for an acknowledged frame.
  const deviceResult = (seqNo, returnCode) => {
    const data = Buffer.alloc(4);
    data.writeInt32LE(returnCode);
    r.session.handleData({
      dataType: P2PDataType.DATA,
      type: 1,
      seqNo,
      commandId: CommandType.CMD_SET_PAYLOAD,
      bytesToRead: 4,
      signCode: 0,
      channel: 0,
      data,
    });
  };
  try {
    const first = [];
    r.respond((entry) => {
      transportAck(entry);
      r.reply(byDate([record(r.owner, r.camera, 1)]));
    });
    const one = await r.transport.recordings.list(r.owner, DAY, undefined, {
      onObservation: (observation) => first.push(observation),
    });
    assert.equal(one.returned, 1);
    assert.equal(only(first).pages[0].ackCode, null);
    t.mock.timers.tick(20000);
    // Another earlier query of the same name stays pending without any result, so
    // the second list's own result must count while earlier commands still wait.
    r.session.messageStates.set(4999, {
      sequence: 4999,
      commandType: CommandType.CMD_SET_PAYLOAD,
      nestedCommandType: CommandType.CMD_DATABASE,
      channel: 0,
      data: Buffer.alloc(0),
      retries: 0,
      acknowledged: true,
      customData: { command: { name: CommandName.StationDatabaseQueryByDate } },
    });
    const second = [];
    r.respond((entry) => {
      const seqNo = transportAck(entry);
      setTimeout(() => {
        deviceResult(seqNo, -104);
        r.reply(byDate([record(r.owner, r.camera, 1)]));
      }, 12000);
    });
    const two = settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (observation) => second.push(observation),
      }),
    );
    await turns();
    // The first query's -133 arrives here, while the second page waits. Then the
    // second query's own result -104 and its answer.
    t.mock.timers.tick(12000);
    const outcome = await two;
    assert.equal(outcome.value.returned, 1);
    const [page] = only(second).pages;
    assert.equal(page.answered, true);
    assert.equal(page.ackCode, -104);
    assert.equal(r.sent.length, 2);
    assert.equal(r.closes(), 0);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a device that keeps answering 503 reports the session result -133 as its ackCode', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await rig('standalone');
  const observations = [];
  // The session resends a command the device answers with 503 (failed to request)
  // and gives up with its own -133 once its retries are used up.
  r.respond((entry) => {
    const seqNo = 7000;
    r.session.messageStates.set(seqNo, {
      sequence: seqNo,
      commandType: entry.command.commandType,
      nestedCommandType: entry.json.cmd,
      channel: 0,
      data: Buffer.alloc(4),
      retries: 10,
      acknowledged: true,
      customData: entry.customData,
    });
    const data = Buffer.alloc(4);
    data.writeInt32LE(503);
    r.session.handleData({
      dataType: P2PDataType.DATA,
      type: 1,
      seqNo,
      commandId: entry.command.commandType,
      bytesToRead: 4,
      signCode: 0,
      channel: 0,
      data,
    });
  });
  try {
    const outcome = settled(
      r.transport.recordings.list(r.owner, DAY, undefined, {
        onObservation: (observation) => observations.push(observation),
      }),
    );
    await turns();
    t.mock.timers.tick(15000);
    assert.equal((await outcome).code, 'device_request_timeout');
    const observation = only(observations);
    assert.equal(observation.stage, 'query');
    assert.deepEqual(
      observation.pages.map(({ answered, ackCode }) => [answered, ackCode]),
      [[false, -133]],
    );
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

// ha-eufy-cam#178: the standalone recording probe. One read-only 10017 request per
// call, answered through the session's own CMD_DATABASE_QUERY_LOCAL parser.
const PROBE_DAY_NOON = new Date(2026, 9, 15, 12, 0, 0).getTime();
const local = (data, mIntRet = 0) => ({
  cmd: CommandType.CMD_DATABASE_QUERY_LOCAL,
  mIntRet,
  data,
  table: 'history_record_info',
  transaction: '1',
  version: '1.1.0.1',
  msg: '',
});
const history = (owner, camera, id, extra = {}) => ({
  record_id: id,
  device_sn: camera,
  station_sn: owner,
  device_type: 31,
  account: 'synthetic-admin',
  start_time: `${DAY} 10:00:${String(id).padStart(2, '0')}`,
  end_time: `${DAY} 10:01:${String(id).padStart(2, '0')}`,
  frame_num: 450,
  storage_type: 1,
  storage_cloud: 0,
  cipher_id: 0,
  vision: 0,
  video_type: 0,
  has_lock: 0,
  automation_id: 0,
  trigger_type: 1,
  push_mode: 0,
  mic_status: 1,
  res_change: 0,
  res_best_width: 0,
  res_best_height: 0,
  self_learning: 0,
  storage_path: `/media/mmcblk0p1/Camera00/${id}.dat`,
  thumb_path: `/media/mmcblk0p1/Camera00/${id}.jpg`,
  write_status: 1,
  cloud_path: '',
  folder_size: 1000,
  storage_status: 0,
  storage_label: '',
  time_zone: '',
  mp4_cloud: '',
  snapshot_cloud: '',
  table_version: '1.2.1',
  ...extra,
});
const picture = (owner, camera, id) => ({
  record_id: id,
  device_sn: camera,
  station_sn: owner,
  picture_id: id,
  detection_type: 1,
  person_id: 0,
  crop_path: `/media/mmcblk0p1/Camera00/${id}_crop.jpg`,
  event_time: `${DAY} 10:00:00`,
  person_recog_flag: 0,
  crop_pic_quality: 0,
  pic_marking_flag: 0,
  group_id: 0,
  crop_id: 0,
  start_time: `${DAY} 10:00:00`,
  storage_type: 1,
  storage_status: 0,
  storage_label: '',
  table_version: '1.2.1',
  update_time: '',
});
const noClasses = {
  own: 0,
  otherDevice: 0,
  stationMismatch: 0,
  invalidTime: 0,
  otherDay: 0,
  cipherId: 0,
};
/** Every request a probe sent is the read-only 10017 query, one per call. */
function probeRequests(r, calls = 1) {
  assert.equal(r.sent.length, calls);
  for (const entry of r.sent) {
    assert.equal(entry.command.commandType, CommandType.CMD_SET_PAYLOAD);
    assert.equal(entry.json.cmd, CommandType.CMD_DATABASE);
    assert.equal(entry.json.payload.cmd, CommandType.CMD_DATABASE_QUERY_LOCAL);
    assert.equal(entry.customData.command.name, CommandName.StationDatabaseQueryLocal);
  }
}
/** A probe resolves with its observation, never rejects, after admission. */
const probe = (r, options) => r.transport.recordings.probe(r.owner, options);

test('a standalone probe sends exactly one 10017 query for today and reports an empty page', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PROBE_DAY_NOON });
  const r = await rig('standalone');
  try {
    r.respond((entry) => {
      r.ack(entry, 0);
      r.reply(local('[]'));
    });
    const observation = only([await probe(r)]);
    probeRequests(r);
    const [{ command, customData, json }] = r.sent;
    assert.equal(command.channel, 0);
    assert.deepEqual(customData, { command: { name: CommandName.StationDatabaseQueryLocal } });
    assert.deepEqual(json, {
      account_id: 'synthetic-admin',
      cmd: CommandType.CMD_DATABASE,
      mChannel: 0,
      mValue3: 0,
      payload: {
        cmd: CommandType.CMD_DATABASE_QUERY_LOCAL,
        table: 'history_record_info',
        transaction: `${PROBE_DAY_NOON}`,
        payload: {
          count: 20,
          start_date: '20261015',
          end_date: '20261016',
          start_time: '0',
          event_type: 0,
          ai_type: 0,
          storage_cloud: -1,
          trigger_type: 0,
          detection_type: 0,
          flag: 0,
        },
      },
    });
    // Exactly these keys: no device_info, no res_unzip.
    assert.deepEqual(Object.keys(json).sort(), [
      'account_id',
      'cmd',
      'mChannel',
      'mValue3',
      'payload',
    ]);
    assert.deepEqual(Object.keys(json.payload).sort(), ['cmd', 'payload', 'table', 'transaction']);
    assert.deepEqual(Object.keys(json.payload.payload).sort(), [
      'ai_type',
      'count',
      'detection_type',
      'end_date',
      'event_type',
      'flag',
      'start_date',
      'start_time',
      'storage_cloud',
      'trigger_type',
    ]);
    assert.deepEqual(timeless(observation), {
      operation: 'probe',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'validate',
      code: null,
      remoteCode: null,
      pages: [{ limit: 20, answered: true, ackCode: 0, resultCode: 0, rows: 0 }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: noClasses,
    });
    assert.equal(r.closes(), 0);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a probe answered with rows counts them by class without identifiers or references', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PROBE_DAY_NOON });
  const r = await rig('standalone');
  try {
    const { owner, camera } = r;
    r.respond((entry) => {
      r.ack(entry, 0);
      r.reply(
        local([
          {
            table_name: 'history_record_info',
            payload: [
              // Own, today.
              history(owner, camera, 1),
              // Own, on the previous day.
              history(owner, camera, 2, {
                start_time: '2026-10-14 23:00:00',
                end_time: '2026-10-14 23:01:00',
              }),
              // Another device, without a cipher ID field.
              history('T8410_OTHER', 'T8410_OTHER', 3, { cipher_id: undefined }),
            ],
          },
          {
            table_name: 'record_crop_picture_info',
            // A picture of record 1, and a record with a picture only.
            payload: [picture(owner, camera, 1), picture(owner, camera, 4)],
          },
        ]),
      );
    });
    const observation = only([await probe(r)]);
    probeRequests(r);
    assert.deepEqual(timeless(observation), {
      operation: 'probe',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'validate',
      code: null,
      remoteCode: null,
      pages: [{ limit: 20, answered: true, ackCode: 0, resultCode: 0, rows: 4 }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: {
        own: 2,
        otherDevice: 1,
        // The picture-only record has no storage path and no valid time.
        stationMismatch: 1,
        invalidTime: 1,
        otherDay: 1,
        cipherId: 2,
      },
    });
    // No recording ID, and the capability stays unavailable.
    assert.equal(r.transport.recordings.references.size, 0);
    assert.deepEqual(r.transport.cameraCapabilities(camera).recordings, {
      available: false,
      status: 'unsupported',
      reason: 'standalone_recordings_unverified',
    });
    assert.equal(r.closes(), 0);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a probe answer with a non-zero result reports history_rejected and keeps the session open', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PROBE_DAY_NOON });
  const r = await rig('standalone');
  try {
    r.respond(() => r.reply(local('[]', -1100)));
    assert.deepEqual(timeless(only([await probe(r)])), {
      operation: 'probe',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'validate',
      code: 'history_rejected',
      remoteCode: -1100,
      pages: [{ limit: 20, answered: true, ackCode: null, resultCode: -1100, rows: 0 }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: noClasses,
    });
    // Unlike a list, the answered probe does not close the owner's session.
    assert.equal(r.closes(), 0);
    assert.equal(r.transport.recordings.busy(r.owner), false);
    r.released();
    // An answer without a database result is rejected too, without a remote code.
    const { mIntRet: _, ...withoutResult } = local('[]');
    r.respond(() => r.reply(withoutResult));
    const missing = only([await probe(r)]);
    assert.deepEqual(
      [missing.code, missing.remoteCode, missing.stage, missing.pages[0].resultCode],
      ['history_rejected', null, 'validate', null],
    );
    assert.equal(missing.pages[0].rows, 0);
    probeRequests(r, 2);
    assert.equal(r.closes(), 0);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a silent probe with ACK 0 times out after 15 seconds and sends nothing more', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PROBE_DAY_NOON });
  const r = await rig('standalone');
  try {
    r.respond((entry) => r.ack(entry, 0));
    let observation;
    const probing = probe(r).then((o) => (observation = o));
    await turns();
    t.mock.timers.tick(14999);
    await turns();
    assert.equal(observation, undefined);
    t.mock.timers.tick(1);
    await probing;
    assert.deepEqual(timeless(only([observation])), {
      operation: 'probe',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'query',
      code: 'device_request_timeout',
      remoteCode: null,
      pages: [{ limit: 20, answered: false, ackCode: 0, resultCode: null, rows: null }],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    assert.equal(r.closes(), 1);
    t.mock.timers.tick(120000);
    await turns();
    probeRequests(r);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a probe refused in its command result reports the negative ACK', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PROBE_DAY_NOON });
  const r = await rig('standalone');
  try {
    r.respond((entry) => r.ack(entry, -104));
    const probing = probe(r);
    await turns();
    t.mock.timers.tick(15000);
    const observation = only([await probing]);
    assert.deepEqual(
      [observation.code, observation.stage, observation.pages[0].ackCode],
      ['device_request_timeout', 'query', -104],
    );
    assert.equal(observation.pages[0].answered, false);
    probeRequests(r);
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a probe counts only unhandled replies of 10017 or without an inner command', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PROBE_DAY_NOON });
  const r = await rig('standalone');
  try {
    r.respond(() => {
      // A 10017 answer whose records the session cannot iterate.
      r.reply(local([{ table_name: 'history_record_info' }], 0));
      // A latest-info reply, such as the one sent at connect, that fails to parse,
      // and a reply with an inner command no handler takes. Neither is the probe's.
      r.reply({ cmd: CommandType.CMD_DATABASE_QUERY_LATEST_INFO, mIntRet: -5, data: { x: 1 } });
      r.reply({ cmd: 10099, mIntRet: -7 });
    });
    const probing = probe(r);
    await turns();
    assert.deepEqual(r.unhandled, [
      { innerCmd: CommandType.CMD_DATABASE_QUERY_LOCAL, resultCode: 0, reason: 'parse_error' },
      {
        innerCmd: CommandType.CMD_DATABASE_QUERY_LATEST_INFO,
        resultCode: -5,
        reason: 'parse_error',
      },
      { innerCmd: 10099, resultCode: -7, reason: 'unknown_cmd' },
    ]);
    // A reply without an inner command still counts.
    r.reply('not json');
    await turns();
    t.mock.timers.tick(15000);
    const observation = only([await probing]);
    assert.deepEqual(
      {
        code: observation.code,
        stage: observation.stage,
        answered: observation.pages[0].answered,
        unhandledReplies: observation.unhandledReplies,
        unhandledReason: observation.unhandledReason,
        unhandledResultCode: observation.unhandledResultCode,
      },
      {
        code: 'device_request_timeout',
        stage: 'query',
        answered: false,
        unhandledReplies: 2,
        unhandledReason: 'parse_error',
        unhandledResultCode: null,
      },
    );
    probeRequests(r);
    r.released();
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a probe connects a disconnected owner with progress and lookup and reports a failed connect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: PROBE_DAY_NOON });
  const r = await rig('standalone', { connected: false });
  const progress = [],
    lookups = [];
  try {
    // The camera answers the lookup and never completes the handshake.
    r.station.connect = async () => {
      r.station.emit('station found', r.station);
    };
    const probing = probe(r, {
      onProgress: (p) => progress.push(p.stage),
      onLookup: (l) => lookups.push(l),
    });
    await turns();
    t.mock.timers.tick(20000);
    assert.deepEqual(timeless(only([await probing])), {
      operation: 'probe',
      owner: 'standalone',
      sessionOpen: false,
      stage: 'connect',
      code: 'device_request_timeout',
      remoteCode: null,
      pages: [],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    assert.deepEqual(progress, ['lookup', 'station_found']);
    assert.equal(lookups.length, 1);
    assert.equal(r.sent.length, 0);
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a probe on a busy owner reports station_busy at admission without a request', async () => {
  const r = await rig('standalone');
  try {
    // A list waits for its answer on the same owner.
    const listing = settled(r.transport.recordings.list(r.owner, DAY));
    await turns();
    assert.equal(r.sent.length, 1);
    assert.deepEqual(timeless(only([await probe(r)])), {
      operation: 'probe',
      owner: 'standalone',
      sessionOpen: true,
      stage: 'admission',
      code: 'station_busy',
      remoteCode: null,
      pages: [],
      unhandledReplies: 0,
      unhandledReason: null,
      unhandledResultCode: null,
      rowClasses: null,
    });
    // Only the list's request was sent.
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].json.payload.cmd, CommandType.CMD_DATABASE_QUERY_BY_DATE);
    r.reply(byDate('[]'));
    assert.equal((await listing).value.returned, 0);
    assert.equal(r.closes(), 0);
  } finally {
    await r.done();
  }
});

test('a cancelled probe reports cancelled and closes the owner session', async () => {
  const r = await rig('standalone');
  try {
    const controller = new AbortController();
    r.respond(() => controller.abort());
    const observation = only([await probe(r, { signal: controller.signal })]);
    assert.deepEqual(
      [
        observation.code,
        observation.stage,
        observation.pages.length,
        observation.pages[0].answered,
      ],
      ['cancelled', 'query', 1, false],
    );
    probeRequests(r);
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('a probe whose station lacks the query command sends nothing and reports the failed request', async () => {
  const r = await rig('standalone');
  try {
    const hasCommand = r.station.hasCommand.bind(r.station);
    r.station.hasCommand = (name) =>
      name !== CommandName.StationDatabaseQueryLocal && hasCommand(name);
    assert.throws(() => r.station.databaseQueryLocalNewest(new Date(), new Date()), {
      name: 'NotSupportedError',
    });
    const observation = only([await probe(r)]);
    assert.deepEqual(
      [observation.code, observation.stage, observation.pages],
      ['device_request_failed', 'query', []],
    );
    assert.equal(r.sent.length, 0);
    assert.equal(r.closes(), 1);
    r.released();
  } finally {
    await r.done();
  }
});

test('a probe refuses every owner but an experimental standalone camera before any connection', async () => {
  const r = await rig('station');
  let connects = 0;
  try {
    r.transport.connect = async () => {
      connects++;
    };
    for (const id of [r.owner, r.camera, 'UNKNOWN'])
      assert.deepEqual(await settled(r.transport.recordings.probe(id)), {
        code: 'operation_outside_hardware_scope',
        remoteCode: undefined,
      });
    assert.deepEqual(r.sent, []);
    assert.equal(r.closes(), 0);
    assert.equal(connects, 0);
  } finally {
    await r.done();
  }
  // The same T8410 without experimentalStandalone has no standalone owner.
  const transport = new DeviceTransport();
  try {
    const inventory = discover([t8410], { experimentalStandalone: false });
    await transport.load(inventory.raw, inventory);
    transport.connect = async () => {
      connects++;
    };
    assert.deepEqual(await settled(transport.recordings.probe(t8410.device_sn)), {
      code: 'operation_outside_hardware_scope',
      remoteCode: undefined,
    });
    assert.equal(connects, 0);
  } finally {
    await transport.close();
  }
});

test('the client passes the probe and its options through unchanged', async () => {
  const calls = [];
  const recordings = { probe: async (...args) => (calls.push(args), { operation: 'probe' }) };
  const client = { deviceTransport: async () => ({ recordings }) };
  const options = { signal: new AbortController().signal, onProgress() {}, onLookup() {} };
  const { prototype } = EufyMegaClient;
  assert.deepEqual(await prototype.probeStandaloneRecordings.call(client, 'S'), {
    operation: 'probe',
  });
  await prototype.probeStandaloneRecordings.call(client, 'S', options);
  assert.deepEqual(calls, [
    ['S', undefined],
    ['S', options],
  ]);
});

test('a list and a calendar count unhandled replies with any inner command', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const run of [
      (r, onObservation) => r.transport.recordings.list(r.owner, DAY, undefined, { onObservation }),
      (r, onObservation) => r.transport.recordings.calendar(r.owner, '2026-10', { onObservation }),
    ]) {
      const r = await rig('standalone');
      const observations = [];
      try {
        r.respond(() => {
          r.reply({ cmd: CommandType.CMD_DATABASE_QUERY_LATEST_INFO, mIntRet: -5, data: { x: 1 } });
          r.reply({ cmd: 10099, mIntRet: -7 });
        });
        const outcome = settled(run(r, (o) => observations.push(o)));
        await turns();
        assert.deepEqual(r.unhandled, [
          {
            innerCmd: CommandType.CMD_DATABASE_QUERY_LATEST_INFO,
            resultCode: -5,
            reason: 'parse_error',
          },
          { innerCmd: 10099, resultCode: -7, reason: 'unknown_cmd' },
        ]);
        t.mock.timers.tick(15000);
        assert.deepEqual(await outcome, { code: 'device_request_timeout', remoteCode: undefined });
        const observation = only(observations);
        assert.deepEqual(
          [
            observation.unhandledReplies,
            observation.unhandledReason,
            observation.unhandledResultCode,
          ],
          [2, 'unknown_cmd', -7],
        );
        r.released();
      } finally {
        await r.done();
      }
    }
  } finally {
    t.mock.timers.reset();
  }
});
