import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setImmediate as turn } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { movePreset } from '../dist/preset.js';
import { hasCameraPresets } from '../dist/camera-media.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { discover } from '../dist/discovery.js';
import { Station, SoloCamera, CommandName } from '../dist/vendor/http/index.js';
import { CommandType, P2PDataType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

// ha-eufy-cam#229: preset moves for the exact T8170 under a HomeBase 3. Fake
// stations establish the client's ownership rules only. Whether a HomeBase 3
// answers a preset move for a T8170 is not known from hardware. All rows, DIDs
// and addresses are synthetic.
const PRESET = CommandType.CMD_FLOODLIGHT_SET_MOTION_PRESET_POSITION;
const settled = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ code: error.code, remoteCode: error.remoteCode }),
  );
const pending = async (promise) => {
  await turn();
  return Promise.race([promise, turn().then(() => 'pending')]);
};

/** An abort signal that counts its listeners. */
function tracked(controller = new AbortController()) {
  const { signal } = controller;
  let listeners = 0;
  const add = signal.addEventListener.bind(signal),
    remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => {
    listeners++;
    add(...args);
  };
  signal.removeEventListener = (...args) => {
    listeners--;
    remove(...args);
  };
  return { controller, signal, listeners: () => listeners };
}

function owner({ fail = false } = {}) {
  const sends = [];
  const station = Object.assign(new EventEmitter(), {
    presetPosition(camera, preset) {
      sends.push({ channel: camera.getChannel(), preset });
      if (fail) throw new Error('synthetic refusal');
    },
  });
  const camera = { getChannel: () => 2 };
  const result = (code, { preset = 1, ...overrides } = {}) =>
    station.emit('command result', station, {
      command_type: PRESET,
      channel: 2,
      return_code: code,
      customData: { command: { name: CommandName.DevicePresetPosition, value: preset } },
      ...overrides,
    });
  return { station, camera, sends, result };
}
function released(f, s) {
  for (const event of ['command result', 'close', 'connection error'])
    assert.equal(f.station.listenerCount(event), 0, event);
  assert.equal(s.listeners(), 0);
}

test('a preset move resolves on its HomeBase result with the elapsed time and sends once', async () => {
  const f = owner(),
    s = tracked();
  const moving = movePreset(f.station, f.camera, 1, s.signal);
  assert.deepEqual(f.sends, [{ channel: 2, preset: 1 }]);
  f.result(0);
  const elapsed = await moving;
  assert.ok(Number.isInteger(elapsed) && elapsed >= 0);
  assert.equal(f.sends.length, 1);
  released(f, s);
});

test('results for another command, channel, preset or name never settle the move', async () => {
  const f = owner(),
    s = tracked();
  const moving = settled(movePreset(f.station, f.camera, 1, s.signal));
  // The outer envelope type, as a session without the nested type would report it.
  f.result(0, { command_type: CommandType.CMD_DOORBELL_SET_PAYLOAD });
  f.result(-1, { channel: 3 });
  f.result(-1, { preset: 2 });
  f.result(-1, { preset: '1' });
  f.result(-1, {
    customData: { command: { name: CommandName.DeviceSavePresetPosition, value: 1 } },
  });
  f.result(-1, { customData: { property: { name: CommandName.DevicePresetPosition, value: 1 } } });
  f.result(-1, { customData: undefined });
  assert.equal(await pending(moving), 'pending');
  f.result(0);
  assert.ok(Number.isInteger((await moving).value));
  assert.equal(f.sends.length, 1);
  released(f, s);
});

test('a refused move keeps the HomeBase code, and the session timeouts stay unconfirmed', async () => {
  for (const [code, expected] of [
    [-1, 'preset_move_rejected'],
    [1, 'preset_move_rejected'],
    [-104, 'preset_move_rejected'],
    [-133, 'preset_move_unconfirmed'],
    [-134, 'preset_move_unconfirmed'],
  ]) {
    const f = owner(),
      s = tracked();
    const moving = settled(movePreset(f.station, f.camera, 1, s.signal));
    f.result(code);
    assert.deepEqual(await moving, { code: expected, remoteCode: code });
    assert.equal(f.sends.length, 1);
    released(f, s);
  }
});

test('own timeout, close, connection error and abort after the send are unconfirmed', async () => {
  const cases = {
    timeout: () => {},
    close: (f) => f.station.emit('close', f.station),
    'connection error': (f) => f.station.emit('connection error', f.station, new Error('lost')),
    abort: (_f, s) => s.controller.abort(),
  };
  for (const [name, end] of Object.entries(cases)) {
    const f = owner(),
      s = tracked();
    const moving = settled(movePreset(f.station, f.camera, 3, s.signal, 20));
    end(f, s);
    assert.deepEqual(
      await moving,
      { code: 'preset_move_unconfirmed', remoteCode: undefined },
      name,
    );
    assert.equal(f.sends.length, 1, name);
    released(f, s);
    // A late result for the same move changes nothing.
    f.result(0, { preset: 3 });
  }
});

test('an aborted signal sends nothing and a synchronous refusal is a move that was not sent', async () => {
  let f = owner(),
    s = tracked();
  s.controller.abort();
  await assert.rejects(movePreset(f.station, f.camera, 0, s.signal), { code: 'cancelled' });
  assert.equal(f.sends.length, 0);
  released(f, s);
  f = owner({ fail: true });
  s = tracked();
  const failed = await settled(movePreset(f.station, f.camera, 0, s.signal));
  assert.deepEqual(failed, { code: 'preset_move_failed', remoteCode: undefined });
  assert.equal(f.sends.length, 1);
  released(f, s);
});

test("the owner's default bound is 40 seconds, after the session's 30-second result wait", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = owner(),
    s = tracked();
  const moving = settled(movePreset(f.station, f.camera, 0, s.signal));
  t.mock.timers.tick(39_999);
  assert.equal(await pending(moving), 'pending');
  t.mock.timers.tick(1);
  assert.deepEqual(await moving, { code: 'preset_move_unconfirmed', remoteCode: undefined });
  released(f, s);
});

test('preset admission needs the exact T8170 under an admitted HomeBase 3', () => {
  const homeBase = (extra = {}) => ({
    device_sn: 'T8030_OWNER',
    device_model: 'T8030',
    device_type: 18,
    main_sw_version: '2.0.9.7',
    ...extra,
  });
  const s340 = (extra = {}) => ({
    device_sn: 'T8170_CAMERA',
    parent_sn: 'T8030_OWNER',
    device_model: 'T8170',
    device_type: 48,
    ...extra,
  });
  assert.equal(hasCameraPresets(s340(), homeBase()), true);
  assert.equal(hasCameraPresets(s340(), homeBase({ main_sw_version: '3.8.6.0' })), true);
  for (const [camera, parent] of [
    [s340({ device_model: 'T8171', device_type: 88 }), homeBase()],
    [s340({ device_model: 'T8173', device_type: 98 }), homeBase()],
    [s340({ device_model: 'T8425', device_type: 47 }), homeBase()],
    [s340({ device_model: 'T8410', device_type: 31 }), homeBase()],
    [s340({ device_type: 88 }), homeBase()],
    [s340({ device_type: '48' }), homeBase()],
    [s340(), homeBase({ main_sw_version: '2.0.9.6' })],
    [s340(), homeBase({ main_sw_version: 'unknown' })],
    [s340(), homeBase({ main_sw_version: undefined })],
    [s340({ parent_sn: 'T8030_OTHER' }), homeBase()],
    [s340(), homeBase({ device_model: 'T8010', device_type: 0 })],
    [s340({ parent_sn: 'HB_OWNER' }), homeBase({ device_sn: 'HB_OWNER' })],
    [s340(), undefined],
    [undefined, homeBase()],
  ])
    assert.equal(hasCameraPresets(camera, parent), false);
});

// Transport ownership with a fake primary session, as in live-concurrent.test.mjs.
const HB = 'T8030_HB';
const metadata = {
  videoCodec: 0,
  audioCodec: 1,
  videoFPS: 15,
  videoWidth: 1920,
  videoHeight: 1080,
};
function fakeStation(serial, connected = false) {
  const station = Object.assign(new EventEmitter(), {
    closes: 0,
    moves: [],
    // The HomeBase result for a move, or undefined for no answer.
    answer: 0,
    getSerial: () => serial,
    hasProperty: () => false,
    isConnected: () => connected,
    getCameraInfo() {},
    connect: async () => {
      connected = true;
      station.emit('encryption ready', station, 'lan-derived');
    },
    presetPosition(camera, preset) {
      station.moves.push(preset);
      if (station.answer === undefined) return;
      const code = station.answer;
      queueMicrotask(() =>
        station.emit('command result', station, {
          command_type: PRESET,
          channel: camera.getChannel(),
          return_code: code,
          customData: { command: { name: CommandName.DevicePresetPosition, value: preset } },
        }),
      );
    },
    startLivestream(camera) {
      queueMicrotask(() =>
        station.emit(
          'livestream start',
          station,
          camera.getChannel(),
          metadata,
          new Readable({ read() {} }),
          new Readable({ read() {} }),
        ),
      );
    },
    stopLivestream(camera) {
      station.emit('livestream stop', station, camera.getChannel());
    },
    ack: (channel) =>
      station.emit('command result', station, { command_type: 1004, channel, return_code: 0 }),
    close: async () => {
      station.closes++;
      if (!connected) return;
      connected = false;
      station.emit('close', station);
    },
    dispose: async () => station.close(),
  });
  return station;
}
function transport({
  options,
  model = 'T8170',
  type = 48,
  firmware = '3.8.6.0',
  parent = HB,
  connected = true,
} = {}) {
  const t = new DeviceTransport(options);
  const primary = fakeStation(HB, connected);
  const extras = [];
  t.createExtraStation = async (stationId) => {
    const station = fakeStation(stationId);
    extras.push(station);
    return station;
  };
  t.stations.set(HB, primary);
  if (connected) t.encryption.set(HB, 'lan-derived');
  t.raw.set(HB, {
    device_sn: HB,
    parent_sn: '',
    device_model: 'T8030',
    device_type: 18,
    main_sw_version: firmware,
  });
  t.raw.set('CAM', { device_sn: 'CAM', parent_sn: parent, device_model: model, device_type: type });
  t.cameras.set('CAM', {
    getModel: () => model,
    getSerial: () => 'CAM',
    getStationSerial: () => HB,
    getChannel: () => 2,
    destroy() {},
    removeAllListeners() {},
  });
  t.bind(primary);
  const results = primary.listenerCount('command result');
  return {
    t,
    primary,
    extras,
    /** The move removed its listeners and released the station lock. */
    released() {
      assert.equal(primary.listenerCount('command result'), results);
      assert.equal(primary.listenerCount('close'), 1);
      assert.equal(primary.listenerCount('connection error'), 1);
      assert.equal(t.commands.size, 0);
    },
  };
}

test('a move connects the primary session, sends once and reports the accepted preset', async () => {
  const f = transport({ connected: false });
  try {
    assert.deepEqual(f.t.cameraCapabilities('CAM').presets, {
      available: true,
      status: 'experimental',
      reason: null,
    });
    const moving = f.t.moveToPreset('CAM', 2);
    // The lock is held from before the connection until the result.
    assert.equal(f.t.commands.has(HB), true);
    const result = await moving;
    assert.deepEqual(Object.keys(result).sort(), ['elapsedMs', 'preset']);
    assert.equal(result.preset, 2);
    assert.ok(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0);
    assert.deepEqual(f.primary.moves, [2]);
    assert.equal(f.primary.closes, 0);
    assert.equal(f.t.state(HB).connected, true);
    f.released();
  } finally {
    await f.t.close();
  }
});

test('a move is refused while a command, a primary live, a start or a recording holds the HomeBase', async () => {
  const f = transport({ options: { maxLiveStreamsPerStation: 1 } });
  try {
    const busy = async () => {
      await assert.rejects(f.t.moveToPreset('CAM', 0), { code: 'station_busy' });
      assert.deepEqual(f.primary.moves, []);
    };
    f.t.commands.add(HB);
    await busy();
    f.t.commands.delete(HB);
    f.t.starting.set(HB, 2);
    await busy();
    f.t.starting.delete(HB);
    f.t.recordings.operations.add(HB);
    await busy();
    f.t.recordings.operations.delete(HB);
    // The default limit of one stream runs live view on the primary session.
    const opening = f.t.startLive('CAM');
    await turn();
    const live = await opening;
    await busy();
    const stopping = live.stop();
    f.primary.ack(2);
    await stopping;
    await f.t.moveToPreset('CAM', 0);
    assert.deepEqual(f.primary.moves, [0]);
    assert.equal(f.primary.closes, 0);
  } finally {
    await f.t.close();
  }
});

test('a live stream on an extra session leaves the primary session free for a move', async () => {
  const f = transport({ options: { maxLiveStreamsPerStation: 2 } });
  try {
    const live = await f.t.startLive('CAM');
    assert.equal(f.t.lives.size, 0);
    assert.deepEqual((await f.t.moveToPreset('CAM', 1)).preset, 1);
    assert.deepEqual(f.primary.moves, [1]);
    assert.deepEqual(f.extras[0].moves, []);
    const stopping = live.stop();
    f.extras[0].ack(2);
    await stopping;
  } finally {
    await f.t.close();
  }
});

test('only integer presets 0 to 3 are sent', async () => {
  const f = transport();
  try {
    for (const preset of ['1', 1.5, -1, 4, Number.NaN, Infinity, true, 'PRESET_1', null, undefined])
      await assert.rejects(f.t.moveToPreset('CAM', preset), { code: 'invalid_preset' });
    assert.deepEqual(f.primary.moves, []);
    f.released();
    for (const preset of [0, 1, 2, 3]) await f.t.moveToPreset('CAM', preset);
    assert.deepEqual(f.primary.moves, [0, 1, 2, 3]);
  } finally {
    await f.t.close();
  }
});

test('a move without any result closes the session, a HomeBase or session answer does not', async () => {
  const outcomes = [
    // Answered by the HomeBase or the session: the session already dropped the move.
    [-1, 'preset_move_rejected', -1, 0],
    [-133, 'preset_move_unconfirmed', -133, 0],
    [-134, 'preset_move_unconfirmed', -134, 0],
  ];
  for (const [answer, code, remoteCode, closes] of outcomes) {
    const f = transport();
    try {
      f.primary.answer = answer;
      assert.deepEqual(await settled(f.t.moveToPreset('CAM', 1)), { code, remoteCode });
      assert.equal(f.primary.closes, closes, String(answer));
      assert.deepEqual(f.primary.moves, [1]);
      f.released();
    } finally {
      await f.t.close();
    }
  }
  const ends = {
    abort: (_f, controller) => controller.abort(),
    close: (f) => f.primary.emit('close', f.primary),
    'connection error': (f) => f.primary.emit('connection error', f.primary, new Error('lost')),
  };
  for (const [name, end] of Object.entries(ends)) {
    const f = transport(),
      controller = new AbortController();
    try {
      f.primary.answer = undefined;
      const moving = settled(f.t.moveToPreset('CAM', 1, controller.signal));
      await turn();
      assert.deepEqual(f.primary.moves, [1]);
      end(f, controller);
      assert.deepEqual(
        await moving,
        { code: 'preset_move_unconfirmed', remoteCode: undefined },
        name,
      );
      assert.equal(f.primary.closes, 1, name);
      f.released();
    } finally {
      await f.t.close();
    }
  }
});

test("a move's own 40-second bound closes the session", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = transport();
  try {
    f.primary.answer = undefined;
    const moving = settled(f.t.moveToPreset('CAM', 0));
    await turn();
    t.mock.timers.tick(39_999);
    assert.equal(await pending(moving), 'pending');
    assert.equal(f.t.commands.has(HB), true);
    t.mock.timers.tick(1);
    assert.deepEqual(await moving, { code: 'preset_move_unconfirmed', remoteCode: undefined });
    assert.equal(f.primary.closes, 1);
    f.released();
  } finally {
    t.mock.timers.reset();
    await f.t.close();
  }
});

test('refusals before the send leave the session open, a failed own connection is closed once', async () => {
  const aborted = new AbortController();
  aborted.abort();
  let f = transport();
  try {
    await assert.rejects(f.t.moveToPreset('CAM', 0, aborted.signal), { code: 'cancelled' });
    f.primary.presetPosition = () => {
      throw new Error('synthetic refusal');
    };
    await assert.rejects(f.t.moveToPreset('CAM', 0), { code: 'preset_move_failed' });
    assert.equal(f.primary.closes, 0);
    f.released();
  } finally {
    await f.t.close();
  }
  f = transport({ connected: false });
  try {
    // connect() closes its own cancelled attempt. The move adds no second close.
    await assert.rejects(f.t.moveToPreset('CAM', 0, aborted.signal), { code: 'cancelled' });
    assert.equal(f.primary.closes, 1);
    assert.deepEqual(f.primary.moves, []);
    f.released();
  } finally {
    await f.t.close();
  }
});

test("connection_busy leaves another caller's connection attempt alone", async () => {
  const f = transport({ connected: false });
  try {
    // A close while that attempt is in flight ends it, as it ends the vendored session's attempt.
    const connect = f.primary.connect;
    let open;
    f.primary.connect = () =>
      new Promise((resolve, reject) => {
        const closes = f.primary.closes;
        open = () =>
          f.primary.closes === closes ? resolve(connect()) : reject(new Error('closed'));
      });
    const other = settled(f.t.connect(HB));
    await assert.rejects(f.t.moveToPreset('CAM', 0), { code: 'connection_busy' });
    assert.equal(f.primary.closes, 0);
    assert.deepEqual(f.primary.moves, []);
    assert.equal(f.t.commands.size, 0);
    open();
    assert.deepEqual(await other, { value: undefined });
    assert.equal(f.t.state(HB).connected, true);
    assert.equal(f.primary.closes, 0);
    f.released();
  } finally {
    await f.t.close();
  }
});

test('other models, owners and the standalone route are refused before any connection', async () => {
  const refusals = [
    { model: 'T8171', type: 88 },
    { model: 'T8173', type: 98 },
    { model: 'T8425', type: 47 },
    { model: 'T8170', type: 88 },
    { firmware: '2.0.9.6' },
    { parent: 'T8030_OTHER' },
  ];
  for (const options of refusals) {
    const f = transport({ ...options, connected: false });
    try {
      await assert.rejects(f.t.moveToPreset('CAM', 0), {
        code: 'operation_outside_hardware_scope',
      });
      assert.deepEqual(f.t.cameraCapabilities('CAM').presets, {
        available: false,
        status: 'unsupported',
        reason: 'operation_outside_hardware_scope',
      });
      assert.deepEqual(f.primary.moves, []);
      assert.equal(f.primary.closes, 0);
      assert.equal(f.t.state(HB).connected, false);
      f.released();
    } finally {
      await f.t.close();
    }
  }
  const f = transport();
  try {
    f.t.standalone.add('CAM');
    await assert.rejects(f.t.moveToPreset('CAM', 0), { code: 'operation_outside_hardware_scope' });
    assert.equal(f.t.cameraCapabilities('CAM').presets.reason, 'operation_outside_hardware_scope');
    f.t.standalone.clear();
    await assert.rejects(f.t.moveToPreset('MISSING', 0), { code: 'unknown_camera' });
    f.t.failures.set('CAM', 'device_initialization_failed');
    await assert.rejects(f.t.moveToPreset('CAM', 0), { code: 'device_initialization_failed' });
    f.t.failures.clear();
    f.t.failures.set(HB, 'invalid_connection_credentials');
    await assert.rejects(f.t.moveToPreset('CAM', 0), { code: 'invalid_connection_credentials' });
    assert.equal(f.t.cameraCapabilities('CAM').presets.reason, 'invalid_connection_credentials');
    f.t.failures.clear();
    assert.deepEqual(f.primary.moves, []);
  } finally {
    await f.t.close();
  }
});

// The real vendored camera and Station method, with a captured P2P send.
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
const s340 = {
  category: 'eufy_security',
  device_sn: 'T8170_FIXTURE',
  parent_sn: 'T8030_OWNER',
  device_model: 'T8170',
  device_type: 48,
  device_channel: 2,
  device_name: 'Synthetic SoloCam S340',
  main_sw_version: '1.2.3',
  params: [],
};

test('T8170 sends the vendored preset envelope on its own channel', async () => {
  const t = new DeviceTransport();
  try {
    await t.load(new Map([[s340.device_sn, s340]]));
    const camera = t.cameras.get(s340.device_sn);
    assert.equal(camera.constructor, SoloCamera);
    assert.equal(camera.getStationSerial(), 'T8030_OWNER');
    assert.ok(camera.hasCommand(CommandName.DevicePresetPosition));
    const sent = [];
    const station = Object.create(Station.prototype);
    station.rawStation = {
      station_sn: 'T8030_OWNER',
      device_type: 18,
      main_sw_version: '3.8.7.4',
      member: { admin_user_id: 'fixture' },
    };
    station.p2pSession = {
      sendCommandWithStringPayload: (command, customData) => sent.push({ command, customData }),
    };
    for (const preset of [0, 1, 2, 3]) {
      const moving = movePreset(station, camera, preset, new AbortController().signal);
      assert.deepEqual(sent.at(-1), {
        command: {
          commandType: CommandType.CMD_DOORBELL_SET_PAYLOAD,
          value: `{"commandType":${PRESET},"data":{"value":${preset}}}`,
          channel: 2,
        },
        customData: { command: { name: CommandName.DevicePresetPosition, value: preset } },
      });
      station.emit('command result', station, {
        command_type: PRESET,
        channel: 2,
        return_code: 0,
        customData: sent.at(-1).customData,
      });
      assert.ok(Number.isInteger(await moving));
    }
    assert.equal(sent.length, 4);
  } finally {
    await t.close();
  }
});

/**
 * A loaded transport with a real vendor Station and P2P session for the
 * HomeBase, as in recordings-observation.test.mjs. The session builds and
 * queues the real frame. Only its socket writes are captured: command sends in
 * `frames`, and the session's direct retransmissions in `retransmits`.
 */
async function sessionRig() {
  const t = new DeviceTransport();
  const inventory = discover([homeBase, s340]);
  await t.load(inventory.raw, inventory);
  const station = t.stations.get('T8030_OWNER');
  assert.ok(station instanceof Station);
  const session = station.p2pSession;
  const frames = [],
    payloads = [],
    retransmits = [];
  session.sendMessage = async (_name, _address, _type, data) => {
    frames.push(data);
  };
  session.socket.send = (message, _port, _host, callback) => {
    retransmits.push(Buffer.from(message));
    callback?.(null, message.length);
  };
  session.connected = true;
  session.connectAddress = { host: '192.0.2.1', port: 32108 };
  t.encryption.set('T8030_OWNER', 'lan-derived');
  const send = session.sendCommandWithStringPayload.bind(session);
  session.sendCommandWithStringPayload = (command, customData) => {
    payloads.push(structuredClone({ command, customData }));
    send(command, customData);
  };
  let closes = 0;
  const close = station.close.bind(station);
  station.close = async () => {
    closes++;
    return close();
  };
  return {
    t,
    session,
    frames,
    payloads,
    retransmits,
    closes: () => closes,
    /** The HomeBase's ACK for the move's current sequence, through the session's own parser. */
    ack() {
      const states = [...session.messageStates.values()].filter(
        (state) => state.commandType === CommandType.CMD_DOORBELL_SET_PAYLOAD,
      );
      assert.equal(states.length, 1);
      const [state] = states;
      const message = Buffer.alloc(10);
      message[0] = 0xf1;
      message[1] = 0xd1;
      message.writeUInt16BE(6, 2);
      message[4] = 0xd1;
      message[5] = P2PDataType.DATA;
      message.writeUInt16BE(1, 6);
      message.writeUInt16BE(state.sequence, 8);
      session.handleMsg(message, {
        address: '192.0.2.1',
        port: 32108,
        family: 'IPv4',
        size: message.length,
      });
      return state;
    },
    /** A DATA result for that state through the session's own parser. */
    result(state, code) {
      const data = Buffer.alloc(4);
      data.writeInt32LE(code);
      session.handleData({
        dataType: P2PDataType.DATA,
        type: 1,
        seqNo: state.sequence,
        commandId: state.commandType,
        bytesToRead: 4,
        signCode: 0,
        channel: 0,
        data,
      });
    },
    async done() {
      session.connected = false;
      await t.close();
    },
  };
}

test('the nested 6035 result from the real session reaches the move', async () => {
  const r = await sessionRig();
  try {
    const moving = settled(r.t.moveToPreset(s340.device_sn, 2));
    await turn();
    assert.equal(r.payloads.length, 1);
    assert.deepEqual(r.payloads[0].customData, {
      command: { name: CommandName.DevicePresetPosition, value: 2 },
    });
    assert.equal(r.frames.length, 1);
    assert.ok(r.frames[0].includes(Buffer.from('{"commandType":6035,"data":{"value":2}}')));
    const state = r.ack();
    assert.equal(state.acknowledged, true);
    assert.equal(state.nestedCommandType, PRESET);
    assert.equal(state.channel, 2);
    r.result(state, 0);
    const { value } = await moving;
    assert.equal(value.preset, 2);
    assert.equal(r.closes(), 0);
    assert.equal(r.session.messageStates.size, 0);
  } finally {
    await r.done();
  }
});

test('after a 503 answer the session ignores ACKs and resends the move, the client sends it once', async (t) => {
  const r = await sessionRig();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // A mocked tick jumps at once, so step 100 ms at a time for the session's
  // 100 ms retransmission timers to run as they would in real time.
  const advance = (ms) => {
    for (let left = ms; left > 0; left -= 100) t.mock.timers.tick(Math.min(100, left));
  };
  // A retransmitted frame carries its sequence after the 4-byte message header.
  const sequenceOf = (frame) => frame.readUInt16BE(6);
  try {
    const moving = settled(r.t.moveToPreset(s340.device_sn, 0));
    await turn();
    const state = r.ack(),
      first = state.sequence;
    // An acknowledged move waits for its result without retransmissions.
    advance(1_000);
    assert.equal(r.retransmits.length, 0);
    r.result(state, 503);
    assert.equal(await pending(moving), 'pending');
    assert.equal(r.frames.length, 2);
    // The session sends the move again at once, as a new command with a new sequence.
    const second = state.sequence;
    assert.notEqual(second, first);
    // The move stays marked as acknowledged, so the ACK of the re-send changes nothing.
    assert.equal(r.ack(), state);
    advance(4_900);
    assert.ok(r.retransmits.length > 0);
    assert.ok(r.retransmits.every((frame) => sequenceOf(frame) === second));
    assert.equal(r.frames.length, 2);
    // Five seconds after the re-send it sends the move again, as another new command.
    advance(100);
    assert.equal(r.frames.length, 3);
    assert.notEqual(state.sequence, second);
    assert.equal(state.retries, 2);
    assert.equal(r.payloads.length, 1);
    r.result(state, -104);
    assert.deepEqual(await moving, { code: 'preset_move_rejected', remoteCode: -104 });
    assert.equal(r.closes(), 0);
  } finally {
    t.mock.timers.reset();
    await r.done();
  }
});

test('a move still queued behind an unacknowledged message is dropped on abort or a session drop', async () => {
  const ends = {
    abort: (_r, controller) => controller.abort(),
    // The session's own drop path, as after a lost heartbeat.
    drop: (r) => r.session._disconnected(),
  };
  const preset = (frame) => frame?.includes(Buffer.from('"commandType":6035')) === true;
  for (const [name, end] of Object.entries(ends)) {
    const r = await sessionRig(),
      controller = new AbortController();
    try {
      // An earlier command that the HomeBase has not acknowledged holds the send queue.
      r.session.messageStates.set(4999, {
        sequence: 4999,
        commandType: CommandType.CMD_SET_ARMING,
        channel: 0,
        data: Buffer.alloc(0),
        retries: 0,
        acknowledged: false,
      });
      const moving = settled(r.t.moveToPreset(s340.device_sn, 1, controller.signal));
      await turn();
      assert.equal(r.payloads.length, 1, name);
      assert.equal(r.session.sendQueue.length, 1, name);
      assert.equal(r.frames.some(preset), false, name);
      end(r, controller);
      assert.deepEqual(
        await moving,
        { code: 'preset_move_unconfirmed', remoteCode: undefined },
        name,
      );
      assert.equal(r.closes(), 1, name);
      assert.equal(r.session.sendQueue.length, 0, name);
      // A reopened, idle session has nothing left to send.
      r.session.connected = true;
      r.session.connectAddress = { host: '192.0.2.1', port: 32108 };
      r.session.sendQueuedMessage();
      await turn();
      assert.equal(r.frames.some(preset), false, name);
      assert.equal(r.payloads.length, 1, name);
    } finally {
      await r.done();
    }
  }
});

test('EufyMegaClient exposes the preset capability and move without opening a connection', async () => {
  const fixture = cloudFixture({ inventory: [homeBase, s340] });
  const client = new EufyMegaClient(fixture.options);
  try {
    await client.connect();
    await client.listDevices();
    assert.deepEqual((await client.getCameraCapabilities(s340.device_sn)).presets, {
      available: true,
      status: 'experimental',
      reason: null,
    });
    await assert.rejects(client.moveToPreset(s340.device_sn, 4), { code: 'invalid_preset' });
    await assert.rejects(client.moveToPreset('T8030_OWNER', 0), { code: 'unknown_camera' });
    // The wrapper forwards the signal: an aborted one ends the move before any connection.
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(client.moveToPreset(s340.device_sn, 0, aborted.signal), {
      code: 'cancelled',
    });
    assert.equal(client.transport.state('T8030_OWNER').connected, false);
  } finally {
    await client.close();
  }
});
