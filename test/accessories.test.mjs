import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { access } from 'node:fs/promises';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import {
  accessoryEvidence,
  accessoryProfiles,
  deviceProfiles,
  exactAccessoryProfile,
  exactDeviceProfile,
} from '../dist/device-profiles.js';
import { AccessoryStore, readingValue } from '../dist/accessories.js';
import { parseParamReports } from '../dist/vendor/p2p/param-report.js';
import { Station } from '../dist/vendor/http/index.js';
import { DeviceType } from '../dist/vendor/http/types.js';
import { CommandType, P2PDataType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
import {
  CHANNELS,
  CHIMES,
  HB,
  KEYPAD,
  SENSORS,
  reportedInventory,
} from './fixtures/reported-275-inventory.mjs';

// ha-eufy-cam#275: HomeBase 3 accessories. A real vendor Station and P2P session
// without a socket. Notifications pass through the session's own parser. All
// identifiers, channels and values are synthetic.
const accessoryModels = new Set(['T8900', 'T8960', 'T8026']);
// The counter keys are a contract with ha-eufy-cam.
const zero = Object.freeze({
  hub_notify: 0,
  sensor_status: 0,
  push_door_sensor: 0,
  camera_info: 0,
  cloud_seeded: 0,
  conflicts: 0,
  unknown_channel: 0,
});
const withoutAccessories = (rows) => rows.filter((r) => !accessoryModels.has(r.device_model));

test('accessory profiles are exact, frozen and separate from device profiles', async () => {
  await access(new URL(`../docs/${accessoryEvidence}`, import.meta.url));
  assert.equal(Object.isFrozen(accessoryProfiles), true);
  assert.deepEqual(Object.keys(accessoryProfiles).sort(), ['T8026', 'T8900', 'T8960']);
  assert.deepEqual(
    Object.entries(accessoryProfiles).map(([model, p]) => [model, p.type, p.category, p.topology]),
    [
      ['T8900', 2, 'entry_sensor', 'h3'],
      ['T8960', 11, 'keypad', 'h3'],
      ['T8026', 600, 'chime', 'self'],
    ],
  );
  for (const [model, profile] of Object.entries(accessoryProfiles)) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.hasOwn(deviceProfiles, model), false, model);
    assert.equal(
      exactAccessoryProfile({ device_model: model, device_type: profile.type }),
      profile,
    );
    assert.equal(exactDeviceProfile({ device_model: model, device_type: profile.type }), undefined);
  }
  for (const [device_model, device_type] of [
    ['T8900', 3],
    ['T8900', '2'],
    ['T8960', 2],
    ['T8026', 601],
    ['T8028', 601],
    ['T8910', 10],
    ['t8900', 2],
    ['T8900 ', 2],
    ['T8900-Z', 2],
    ['constructor', 2],
    ['__proto__', 2],
  ])
    assert.equal(exactAccessoryProfile({ device_model, device_type }), undefined);
});

test('a new store reports every contract counter as zero', () => {
  assert.deepEqual(new AccessoryStore().snapshot(), zero);
});

test('the reported inventory admits seven accessories and leaves cameras and the HomeBase unchanged', () => {
  const rows = reportedInventory();
  const inventory = discover(rows);
  const plain = discover(withoutAccessories(rows));
  assert.deepEqual(inventory.result.issues, []);
  // Devices, relationships, owners and raw are exactly those of the same inventory without accessories.
  assert.deepEqual(inventory.result.devices, plain.result.devices);
  assert.deepEqual(inventory.result.relationships, plain.result.relationships);
  assert.deepEqual([...inventory.raw.keys()], [...plain.raw.keys()]);
  assert.deepEqual([...inventory.owners], [...plain.owners]);
  assert.deepEqual(
    inventory.result.devices.map((d) => [d.model, d.kind]),
    [
      ['T8170', 'camera'],
      ['T8170', 'camera'],
      ['T8214', 'camera'],
      ['T8030', 'station'],
    ],
  );
  assert.deepEqual(
    inventory.result.accessories.map((a) => [a.id, a.category, a.stationId, a.model]),
    [
      [SENSORS[0], 'entry_sensor', HB, 'T8900'],
      [SENSORS[1], 'entry_sensor', HB, 'T8900'],
      [SENSORS[2], 'entry_sensor', HB, 'T8900'],
      [KEYPAD, 'keypad', HB, 'T8960'],
      [CHIMES[0], 'chime', null, 'T8026'],
      [CHIMES[1], 'chime', null, 'T8026'],
      [SENSORS[3], 'entry_sensor', HB, 'T8900'],
    ],
  );
  assert.deepEqual(
    inventory.result.accessories.map((a) => [a.index, a.deviceType]),
    [
      [4, 2],
      [5, 2],
      [6, 2],
      [7, 11],
      [8, 600],
      [9, 600],
      [12, 2],
    ],
  );
  const [sensor, , , keypad, chime] = inventory.result.accessories;
  assert.deepEqual(
    [sensor.firmware, sensor.hardware, keypad.firmware, chime.firmware, chime.hardware],
    [null, '0.0.1', '0.0.1.7', '1.0.2.7', '1.0.0.0'],
  );
  assert.deepEqual(plain.result.accessories, []);
  for (const id of [...SENSORS, KEYPAD, ...CHIMES]) {
    assert.equal(inventory.raw.has(id), false);
    assert.equal(inventory.owners.has(id), false);
    assert.equal(inventory.relationships.has(id), false);
  }
});

test('accessories outside their exact topology keep a rejection with the received model and type', () => {
  const home = reportedInventory()[3];
  const sensor = (fields) => ({
    category: 'eufy_security',
    device_sn: 'SYNTH_X',
    parent_sn: HB,
    device_model: 'T8900',
    device_type: 2,
    device_channel: 16,
    params: [],
    ...fields,
  });
  const solo = {
    category: 'eufy_security',
    device_sn: 'SYNTH_SOLO',
    parent_sn: '',
    device_model: 'T8134',
    device_type: 63,
    params: [],
  };
  const cases = [
    [sensor({ parent_sn: '' }), 'invalid_device_relationship'],
    [sensor({ parent_sn: 'SYNTH_X' }), 'invalid_device_relationship'],
    [sensor({ parent_sn: 'SYNTH_MISSING' }), 'unsupported_station'],
    [sensor({ parent_sn: 'SYNTH_SOLO' }), 'unsupported_station'],
    [
      sensor({ device_model: 'T8960', device_type: 11, parent_sn: '' }),
      'invalid_device_relationship',
    ],
    [
      sensor({ device_model: 'T8960', device_type: 11, parent_sn: 'SYNTH_SOLO' }),
      'unsupported_station',
    ],
    [sensor({ device_model: 'T8026', device_type: 600, parent_sn: HB }), 'unsupported_station'],
    [
      sensor({ device_model: 'T8026', device_type: 600, parent_sn: '' }),
      'invalid_device_relationship',
    ],
    [sensor({ device_type: 3 }), 'unsupported_device'],
    [sensor({ device_model: 'T8910', device_type: 10 }), 'unsupported_device'],
    [
      sensor({ device_model: 'T8028', device_type: 601, parent_sn: 'SYNTH_X' }),
      'unsupported_device',
    ],
    [
      sensor({ device_model: 'T8026', device_type: 601, parent_sn: 'SYNTH_X' }),
      'unsupported_device',
    ],
  ];
  for (const [row, code] of cases) {
    const result = discover([home, solo, row]).result;
    assert.deepEqual(result.accessories, [], `${row.device_model}/${row.parent_sn}`);
    const issue = result.issues.find((i) => i.deviceId === 'SYNTH_X');
    assert.equal(issue.code, code, `${row.device_model}/${row.device_type}/${row.parent_sn}`);
    assert.equal(issue.deviceModel, row.device_model);
    assert.equal(issue.deviceType, row.device_type);
    assert.equal(issue.index, 2);
  }
  // A HomeBase that is itself not an owner admits no accessory.
  const foreign = { ...home, parent_sn: 'SYNTH_OTHER' };
  const result = discover([foreign, sensor({})]).result;
  assert.deepEqual(result.accessories, []);
  assert.equal(result.issues.find((i) => i.deviceId === 'SYNTH_X').code, 'unsupported_station');
});

test('param reports parse defensively and keep at most 32 entries', () => {
  const entry = (channel, type, value) => ({
    dev_type: channel,
    param_type: type,
    param_value: value,
  });
  assert.deepEqual(parseParamReports({ params: [entry(16, 1550, '1'), entry(17, 1552, 0)] }), [
    { channel: 16, type: 1550, value: '1' },
    { channel: 17, type: 1552, value: '0' },
  ]);
  assert.deepEqual(parseParamReports(JSON.stringify({ params: [entry(16, 1550, '0')] })), [
    { channel: 16, type: 1550, value: '0' },
  ]);
  for (const bad of [undefined, null, 'not json', 42, {}, { params: {} }, { params: 'x' }])
    assert.deepEqual(parseParamReports(bad), []);
  assert.deepEqual(
    parseParamReports({
      params: [
        entry('16', 1550, '1'),
        entry(16, '1550', '1'),
        entry(16.5, 1550, '1'),
        entry(-1, 1550, '1'),
        entry(16, 1550, null),
        entry(16, 1550, { x: 1 }),
        entry(16, 1550, 'x'.repeat(65)),
        entry(16, 1550, Infinity),
        null,
      ],
    }),
    [],
  );
  const many = Array.from({ length: 40 }, (_, i) => entry(i, 1550, '1'));
  assert.equal(parseParamReports({ params: many }).length, 32);
});

test('reading values are strict', () => {
  assert.deepEqual(
    ['0', '1', 0, 1].map((v) => readingValue('open', v)),
    [false, true, false, true],
  );
  for (const v of ['2', '01', 'true', '', ' 1', 1.5, null, undefined, -1, '1e0'])
    assert.equal(readingValue('open', v), undefined, String(v));
  assert.deepEqual(
    ['0', '1', '2', '3', '4'].map((v) => readingValue('charging', v)),
    [false, true, false, true, undefined],
  );
});

/**
 * A loaded transport with a real vendor Station for the reported HomeBase.
 * `notify` feeds a CMD_NOTIFY_PAYLOAD through the session's parser,
 * `cameraInfo` a CMD_CAMERA_INFO reply.
 */
async function rig(rows = reportedInventory()) {
  const transport = new DeviceTransport();
  const inventory = discover(rows);
  await transport.load(inventory.raw, inventory);
  const station = transport.stations.get(HB);
  assert.ok(station instanceof Station);
  const session = station.p2pSession;
  session.sendMessage = async () => {};
  session.connected = true;
  session.connectAddress = { host: '192.0.2.1', port: 32108 };
  transport.encryption.set(HB, 'lan-derived');
  const sent = [];
  session.sendCommandWithStringPayload = (command, customData) =>
    sent.push({ command, customData, json: JSON.parse(command.value) });
  session.sendCommandWithInt = (command, customData) => sent.push({ command, customData });
  const events = [],
    stations = [];
  transport.on('accessory', (state) => events.push(structuredClone(state)));
  transport.on('station', (state) => stations.push(state));
  const control = (commandId, body, channel = 0) =>
    session.handleDataControl({
      commandId,
      channel,
      signCode: 0,
      type: 0,
      seqNo: 0,
      dataType: P2PDataType.CONTROL,
      data: Buffer.from(JSON.stringify(body) + '\0'),
    });
  return {
    transport,
    inventory,
    station,
    session,
    sent,
    events,
    stations,
    hub: (params) => control(CommandType.CMD_NOTIFY_PAYLOAD, { cmd: 1829, payload: { params } }),
    sensorStatus: (channel, status) =>
      control(CommandType.CMD_NOTIFY_PAYLOAD, { cmd: 1550, payload: { status } }, channel),
    cameraInfo: (params) => control(CommandType.CMD_CAMERA_INFO, { params }),
    push: (fields) =>
      transport.filterPush(
        {
          name: '',
          type: 2,
          event_time: 0,
          station_sn: HB,
          device_sn: SENSORS[0],
          event_type: 3,
          ...fields,
        },
        'cloud',
      ),
    async done() {
      session.connected = false;
      await transport.close();
    },
  };
}
const param = (channel, type, value) => ({
  dev_type: channel,
  param_type: type,
  param_value: value,
});

test('the station wire gains only an admitted keypad, and is unchanged without one', async () => {
  const wireOf = async (rows) => {
    const transport = new DeviceTransport();
    const inventory = discover(rows);
    await transport.load(inventory.raw, inventory);
    try {
      return transport.stationWire(inventory.raw.get(HB));
    } finally {
      await transport.close();
    }
  };
  const rows = reportedInventory();
  const plain = await wireOf(withoutAccessories(rows));
  const sensorsOnly = await wireOf(rows.filter((r) => r.device_model !== 'T8960'));
  const full = await wireOf(rows);
  assert.deepEqual(sensorsOnly, plain);
  assert.deepEqual(
    plain.devices.map((d) => d.device_sn),
    ['SYNTH_T8170_1', 'SYNTH_T8170_2', 'SYNTH_T8214_1'],
  );
  assert.deepEqual(full.devices.slice(0, 3), plain.devices);
  assert.deepEqual(
    full.devices.slice(3).map((d) => [d.device_sn, d.device_type, d.station_sn]),
    [[KEYPAD, 11, HB]],
  );
  assert.deepEqual({ ...full, devices: plain.devices }, plain);
});

test('only a keypad in the wire makes the vendored Station accept guard mode 6', async () => {
  const r = await rig();
  try {
    assert.equal(r.station.hasDeviceWithType(DeviceType.KEYPAD), true);
    r.station.setGuardMode(6);
    const command = r.sent.at(-1);
    assert.equal(command.command.commandType, CommandType.CMD_SET_PAYLOAD);
    assert.deepEqual(
      [command.json.cmd, command.json.payload.mode_type],
      [CommandType.CMD_SET_ARMING, 6],
    );
  } finally {
    await r.done();
  }
  const plain = await rig(reportedInventory().filter((row) => row.device_model !== 'T8960'));
  try {
    assert.equal(plain.station.hasDeviceWithType(DeviceType.KEYPAD), false);
    assert.throws(() => plain.station.setGuardMode(6));
    assert.equal(plain.sent.length, 0);
  } finally {
    await plain.done();
  }
});

test('hub notify params set entry sensor and keypad readings by channel', async () => {
  const r = await rig();
  try {
    r.hub([
      param(CHANNELS[SENSORS[0]], 1550, '1'),
      param(CHANNELS[SENSORS[1]], 1552, 0),
      param(CHANNELS[KEYPAD], 1655, '3'),
      param(CHANNELS[KEYPAD], 1550, '1'),
      param(CHANNELS[SENSORS[2]], 1550, '7'),
      param(2, 1101, '50'),
      param(99, 1550, '1'),
    ]);
    assert.deepEqual(
      r.events.map((e) => e.id),
      [SENSORS[0], SENSORS[1], KEYPAD],
    );
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source, open.live], [true, 'p2p', true]);
    assert.ok(Date.parse(open.observedAt) > 0);
    assert.equal(r.transport.accessoryState(SENSORS[1]).readings.batteryLow.value, false);
    assert.equal(r.transport.accessoryState(SENSORS[2]).readings.open, null);
    assert.deepEqual(Object.keys(r.transport.accessoryState(KEYPAD).readings), [
      'batteryLow',
      'charging',
    ]);
    assert.equal(r.transport.accessoryState(KEYPAD).readings.charging.value, true);
    // A camera channel and an unknown channel are no admitted accessory. Invalid
    // values and keys of another category are dropped uncounted.
    assert.deepEqual(r.transport.accessoryObservation(), {
      ...zero,
      hub_notify: 3,
      unknown_channel: 2,
    });
    // A repeated value refreshes the reading without an event.
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '1')]);
    assert.equal(r.events.length, 3);
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '0')]);
    assert.equal(r.events.length, 4);
    assert.equal(r.events.at(-1).readings.open.value, false);
  } finally {
    await r.done();
  }
});

test('the legacy sensor status notification sets the entry sensor on its channel only', async () => {
  const r = await rig();
  try {
    r.sensorStatus(CHANNELS[SENSORS[3]], 1);
    r.sensorStatus(CHANNELS[KEYPAD], 1);
    r.sensorStatus(77, 1);
    r.sensorStatus(CHANNELS[SENSORS[0]], 5);
    assert.deepEqual(
      r.events.map((e) => [e.id, e.readings.open.value, e.readings.open.source]),
      [[SENSORS[3], true, 'p2p']],
    );
    assert.deepEqual(r.transport.accessoryObservation(), {
      ...zero,
      sensor_status: 1,
      unknown_channel: 2,
    });
  } finally {
    await r.done();
  }
});

test('keypad device information arrives through its place in the station wire', async () => {
  const r = await rig();
  try {
    r.cameraInfo([
      param(CHANNELS[KEYPAD], 1653, '0'),
      param(CHANNELS[KEYPAD], 1655, '2'),
      param(CHANNELS[KEYPAD], 1131, '1'),
      param(CHANNELS[SENSORS[0]], 1550, '1'),
    ]);
    assert.deepEqual(
      r.events.map((e) => e.id),
      [KEYPAD],
    );
    const { batteryLow, charging } = r.transport.accessoryState(KEYPAD).readings;
    assert.deepEqual(
      [batteryLow.value, batteryLow.source, charging.value, charging.source],
      [false, 'p2p', false, 'p2p'],
    );
    // Entry sensors are not in the wire, so device information never maps them.
    assert.equal(r.transport.accessoryState(SENSORS[0]).readings.open, null);
    assert.deepEqual(r.transport.accessoryObservation(), { ...zero, camera_info: 2 });
  } finally {
    await r.done();
  }
});

test('a channel shared with a camera or another accessory matches nothing', async () => {
  const rows = reportedInventory();
  rows[5] = { ...rows[5], device_channel: 2 };
  rows[6] = { ...rows[6], device_channel: CHANNELS[SENSORS[0]] };
  const r = await rig(rows);
  try {
    r.hub([param(2, 1550, '1'), param(CHANNELS[SENSORS[0]], 1550, '1')]);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.transport.accessoryObservation(), { ...zero, unknown_channel: 2 });
  } finally {
    await r.done();
  }
});

test('inventory values are labelled cloud, never live, and any observation replaces them', async () => {
  const rows = reportedInventory();
  rows[4] = {
    ...rows[4],
    params: [
      { param_type: 1550, param_value: '1' },
      { param_type: 1552, param_value: 'x' },
    ],
  };
  rows[7] = { ...rows[7], params: [{ param_type: 1653, param_value: '1' }] };
  const r = await rig(rows);
  try {
    const sensor = r.transport.accessoryState(SENSORS[0]).readings;
    assert.deepEqual(
      [sensor.open.value, sensor.open.source, sensor.open.live, sensor.batteryLow],
      [true, 'cloud', false, null],
    );
    assert.equal(r.transport.accessoryState(KEYPAD).readings.batteryLow.source, 'cloud');
    assert.equal(r.transport.accessoryObservation().cloud_seeded, 2);
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '1')]);
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source, open.live], [true, 'p2p', true]);
    assert.equal(r.events.length, 1);
    // A later discovery keeps the observation and never puts a cloud value over it.
    const again = discover(
      rows.map((row, i) =>
        i === 4 ? { ...row, params: [{ param_type: 1550, param_value: '0' }] } : row,
      ),
    );
    await r.transport.load(again.raw, again);
    assert.deepEqual(
      [
        r.transport.accessoryState(SENSORS[0]).readings.open.value,
        r.transport.accessoryState(SENSORS[0]).readings.open.source,
      ],
      [true, 'p2p'],
    );
  } finally {
    await r.done();
  }
});

test('a closed HomeBase session keeps accessory values and marks them not live', async () => {
  const r = await rig();
  try {
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '1'), param(CHANNELS[KEYPAD], 1655, '1')]);
    r.events.length = 0;
    r.station.emit('close', r.station);
    assert.deepEqual(
      r.events.map((e) => e.id),
      [SENSORS[0], KEYPAD],
    );
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source, open.live], [true, 'p2p', false]);
    // The same value after a reconnect is live again and reported once.
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '1')]);
    assert.equal(r.events.length, 3);
    assert.equal(r.events.at(-1).readings.open.live, true);
    // Only the sensor observed again becomes not live, and a second close changes nothing.
    r.station.emit('close', r.station);
    r.station.emit('close', r.station);
    assert.deepEqual(
      r.events.slice(3).map((e) => e.id),
      [SENSORS[0]],
    );
  } finally {
    await r.done();
  }
});

test('door sensor pushes are consumed and set only an entry sensor of its own HomeBase', async () => {
  const r = await rig();
  try {
    assert.equal(r.push({ sensor_open: true }), false);
    assert.deepEqual(
      r.events.map((e) => [e.id, e.readings.open.value, e.readings.open.source]),
      [[SENSORS[0], true, 'push']],
    );
    assert.equal(r.push({ station_sn: 'SYNTH_OTHER', sensor_open: false }), false);
    assert.equal(r.push({ event_type: 3101, sensor_open: false }), false);
    assert.equal(r.push({ device_sn: KEYPAD, sensor_open: false }), false);
    assert.equal(r.push({ device_sn: CHIMES[0], station_sn: CHIMES[0], event_type: 1 }), false);
    assert.equal(r.push({}), false);
    assert.equal(r.push({ sensor_open: 'false' }), false);
    assert.equal(r.events.length, 1);
    assert.deepEqual(r.transport.accessoryObservation(), { ...zero, push_door_sensor: 1 });
    // A push that names no accessory keeps the existing path.
    assert.equal(r.push({ device_sn: 'SYNTH_UNKNOWN', sensor_open: true }), false);
    assert.equal(r.transport.accessoryObservation().push_door_sensor, 1);
  } finally {
    await r.done();
  }
});

test('an older push never replaces a newer P2P reading, and an untimed one is counted', async () => {
  const r = await rig();
  try {
    const before = Date.now();
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '0')]);
    // The push of the earlier open arrives after the P2P close.
    r.push({ sensor_open: true, event_time: before - 5000 });
    let open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source], [false, 'p2p']);
    // A push of the same value confirms it without an event.
    r.push({ sensor_open: false, event_time: before - 1000 });
    // A newer push applies.
    r.push({ sensor_open: true, event_time: Date.now() + 1000 });
    open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source], [true, 'push']);
    // An older push than the last push reading is late, whatever the local time.
    r.push({ sensor_open: false, event_time: before - 5000 });
    assert.equal(r.transport.accessoryState(SENSORS[0]).readings.open.value, true);
    // Without an event time the latest receipt wins and a P2P difference is counted.
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '0')]);
    r.push({ sensor_open: true, event_time: 0 });
    assert.equal(r.transport.accessoryState(SENSORS[0]).readings.open.value, true);
    // Two late pushes and one untimed difference.
    assert.deepEqual(r.transport.accessoryObservation(), {
      ...zero,
      hub_notify: 2,
      push_door_sensor: 3,
      conflicts: 3,
    });
    assert.deepEqual(
      r.events.map((e) => [e.readings.open.value, e.readings.open.source]),
      [
        [false, 'p2p'],
        [true, 'push'],
        [false, 'p2p'],
        [true, 'push'],
      ],
    );
  } finally {
    await r.done();
  }
});

test('an older push of the same value never moves the push reference back', async () => {
  const r = await rig();
  try {
    const t = Date.now() + 10000;
    // Open at t+200, then the older open at t+100, then the close at t+150.
    r.push({ sensor_open: true, event_time: t + 200 });
    r.push({ sensor_open: true, event_time: t + 100 });
    r.push({ sensor_open: false, event_time: t + 150 });
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source], [true, 'push']);
    assert.equal(r.transport.accessoryObservation().conflicts, 1);
  } finally {
    await r.done();
  }
});

test('a push with a whole-second time just before the P2P receipt still applies', async () => {
  const r = await rig();
  try {
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '1')]);
    // The close missed over P2P arrives as a push timed on another clock.
    r.push({ sensor_open: false, event_time: Math.floor(Date.now() / 1000) * 1000 - 500 });
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source], [false, 'push']);
  } finally {
    await r.done();
  }
});

test('a HomeBase replaced by a new discovery ends the live readings of its accessories', async () => {
  const r = await rig();
  try {
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '1')]);
    r.events.length = 0;
    const rows = reportedInventory().map((row) =>
      row.device_sn === HB ? { ...row, p2p_did: 'SYNTHETIC-000275-FGHIJ' } : row,
    );
    const again = discover(rows);
    await r.transport.load(again.raw, again);
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source, open.live], [true, 'p2p', false]);
    assert.deepEqual(
      r.events.map((e) => [e.id, e.readings.open.live]),
      [[SENSORS[0], false]],
    );
  } finally {
    await r.done();
  }
});

test('push order uses push times, and P2P receipt times with an allowance', () => {
  const store = new AccessoryStore();
  store.load(discover(reportedInventory()).accessories);
  const L = 1_800_000_000_000;
  const value = (id) => store.state(id).readings.open.value;
  // P2P open at L. Its delayed push confirms it at L+6 s. The close at L+3 s still applies.
  assert.equal(store.observe(SENSORS[0], 'open', true, 'p2p', undefined, L), 'changed');
  assert.equal(store.observe(SENSORS[0], 'open', true, 'push', L, L + 6000), 'same');
  assert.equal(store.observe(SENSORS[0], 'open', false, 'push', L + 3000, L + 7000), 'changed');
  assert.equal(value(SENSORS[0]), false);
  // A push open at L, confirmed over P2P at L+60 s. A close pushed at L+30 s is late.
  assert.equal(store.observe(SENSORS[1], 'open', true, 'push', L, L + 500), 'changed');
  assert.equal(store.observe(SENSORS[1], 'open', true, 'p2p', undefined, L + 60000), 'same');
  assert.equal(store.observe(SENSORS[1], 'open', false, 'push', L + 30000, L + 61000), 'late');
  assert.equal(value(SENSORS[1]), true);
  // A push time an hour ahead gives no order and never blocks later changes.
  assert.equal(store.observe(SENSORS[2], 'open', true, 'push', L + 3600000, L), 'changed');
  assert.equal(store.observe(SENSORS[2], 'open', false, 'p2p', undefined, L + 10000), 'changed');
  assert.equal(store.observe(SENSORS[2], 'open', true, 'push', L + 40000, L + 41000), 'changed');
  assert.equal(store.observe(SENSORS[2], 'open', false, 'push', L + 50000, L + 51000), 'changed');
  assert.equal(value(SENSORS[2]), false);
  // A P2P confirmation of a pushed value makes an untimed difference a conflict.
  const before = store.snapshot().conflicts;
  assert.equal(store.observe(SENSORS[3], 'open', true, 'push', L, L + 500), 'changed');
  assert.equal(store.observe(SENSORS[3], 'open', true, 'p2p', undefined, L + 1000), 'same');
  // A clock stepping back never lowers the P2P reference.
  assert.equal(store.observe(SENSORS[3], 'open', true, 'p2p', undefined, L - 60000), 'same');
  assert.equal(store.observe(SENSORS[3], 'open', false, 'push', L - 1000, L + 2000), 'late');
  assert.equal(store.observe(SENSORS[3], 'open', false, 'push', undefined, L + 3000), 'changed');
  assert.equal(store.snapshot().conflicts, before + 1);
});

test('a HomeBase that fails a later load ends the live readings of its accessories', async () => {
  const r = await rig();
  try {
    r.hub([param(CHANNELS[SENSORS[0]], 1550, '1')]);
    r.events.length = 0;
    r.station.update = () => {
      throw new Error('synthetic update failure');
    };
    await r.transport.load(r.inventory.raw, r.inventory);
    assert.equal(r.transport.failures.get(HB), 'device_initialization_failed');
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source, open.live], [true, 'p2p', false]);
    assert.deepEqual(
      r.events.map((e) => [e.id, e.readings.open.live]),
      [[SENSORS[0], false]],
    );
  } finally {
    await r.done();
  }
});

test('a push for an accessory of a failed HomeBase is refused', async () => {
  const r = await rig();
  try {
    r.transport.failures.set(HB, 'device_initialization_failed');
    r.push({ sensor_open: true });
    assert.deepEqual(r.transport.accessoryObservation(), zero);
    assert.deepEqual(r.events, []);
  } finally {
    await r.done();
  }
});

test('a HomeBase without accessories ignores hub notify params and counts nothing', async () => {
  const r = await rig(withoutAccessories(reportedInventory()));
  try {
    r.hub([param(16, 1550, '1')]);
    r.sensorStatus(16, 1);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.transport.accessoryObservation(), zero);
    assert.deepEqual(r.transport.state(HB).availableModes, [0, 1, 2, 3, 4, 5, 47, 63]);
  } finally {
    await r.done();
  }
});

test('guard mode 6 is read on every HomeBase and offered only with a keypad', async () => {
  const plain = await rig(reportedInventory().filter((row) => row.device_model !== 'T8960'));
  try {
    plain.station.emit('parameter observed', plain.station, CommandType.CMD_SET_ARMING, '6', 'p2p');
    plain.station.emit(
      'parameter observed',
      plain.station,
      CommandType.CMD_GET_ALARM_MODE,
      '6',
      'p2p',
    );
    assert.deepEqual(
      [plain.transport.state(HB).guardMode, plain.transport.state(HB).currentMode],
      [6, 6],
    );
    assert.deepEqual(plain.transport.state(HB).availableModes, [0, 1, 2, 3, 4, 5, 47, 63]);
    // A repeated mode is not a change.
    plain.station.emit('parameter observed', plain.station, CommandType.CMD_SET_ARMING, '6', 'p2p');
    assert.equal(plain.stations.length, 2);
    plain.station.emit(
      'parameter observed',
      plain.station,
      CommandType.CMD_SET_ARMING,
      '6',
      'http',
    );
    plain.station.emit('parameter observed', plain.station, CommandType.CMD_SET_ARMING, '7', 'p2p');
    assert.equal(plain.stations.length, 2);
    await assert.rejects(plain.transport.setGuardMode(HB, 6), { code: 'invalid_guard_mode' });
    for (const mode of [7, -1, 6.5, '6', NaN])
      await assert.rejects(plain.transport.setGuardMode(HB, mode), { code: 'invalid_guard_mode' });
    assert.equal(plain.sent.length, 0);
  } finally {
    await plain.done();
  }
});

test('with a keypad, setGuardMode sends 6 and confirms it with a P2P read', async () => {
  const r = await rig();
  let mode = '63';
  r.session.sendCommandWithInt = (command) => {
    r.sent.push({ command });
    if (command.commandType === CommandType.CMD_CAMERA_INFO)
      setImmediate(() =>
        r.station.emit('parameter observed', r.station, CommandType.CMD_SET_ARMING, mode, 'p2p'),
      );
  };
  r.session.sendCommandWithStringPayload = (command, customData) => {
    const json = JSON.parse(command.value);
    r.sent.push({ command, json });
    mode = String(json.payload.mode_type);
    setImmediate(() =>
      r.station.emit('command result', r.station, {
        command_type: CommandType.CMD_SET_ARMING,
        channel: 255,
        return_code: 0,
        customData,
      }),
    );
  };
  try {
    assert.deepEqual(r.transport.state(HB).availableModes, [0, 1, 2, 3, 4, 5, 6, 47, 63]);
    const result = await r.transport.setGuardMode(HB, 6);
    assert.deepEqual(
      [result.confirmed, result.commandSent, result.state.guardMode],
      [true, true, 6],
    );
    assert.equal(r.sent.filter((s) => s.json?.payload?.mode_type === 6).length, 1);
    // Reading 6 now confirms without a second command.
    const again = await r.transport.setGuardMode(HB, 6);
    assert.equal(again.commandSent, false);
  } finally {
    await r.done();
  }
});

test('accessory IDs never reach camera, station, media or recording paths', async () => {
  const r = await rig();
  try {
    for (const id of [...SENSORS, KEYPAD, ...CHIMES]) {
      assert.throws(() => r.transport.device(id), { code: 'unknown_device' });
      assert.throws(() => r.transport.state(id), { code: 'unknown_station' });
      const capabilities = r.transport.cameraCapabilities(id);
      for (const feature of ['snapshot', 'live', 'recordings', 'presets'])
        assert.deepEqual(
          [capabilities[feature].available, capabilities[feature].reason],
          [false, 'unknown_camera'],
        );
      await assert.rejects(r.transport.snapshot(id), { code: 'unknown_camera' });
      await assert.rejects(r.transport.startLive(id), { code: 'unknown_camera' });
      await assert.rejects(r.transport.connect(id), { code: 'unknown_station' });
      await assert.rejects(r.transport.setGuardMode(id, 63), { code: 'unknown_station' });
      assert.equal(r.transport.stations.has(id), false);
      assert.equal(r.transport.cameras.has(id), false);
      assert.equal(r.transport.supportsEvent(id, 'notification'), false);
    }
    // A recording filter naming an accessory is refused before any request.
    await assert.rejects(r.transport.recordings.list(HB, '2026-11-19', [SENSORS[0]]), {
      code: 'invalid_camera_filter',
    });
    assert.equal(r.sent.length, 0);
    // The chime has no session or connection at all.
    assert.deepEqual([...r.transport.stations.keys()], [HB]);
    assert.throws(() => r.transport.accessoryState('SYNTH_T8170_1'), { code: 'unknown_device' });
  } finally {
    await r.done();
  }
});

test('a rejected accessory reports its discovery code', async () => {
  const rows = reportedInventory();
  rows[4] = { ...rows[4], parent_sn: 'SYNTH_MISSING' };
  const r = await rig(rows);
  try {
    assert.throws(() => r.transport.accessoryState(SENSORS[0]), { code: 'unsupported_station' });
    assert.equal(r.transport.accessoryState(SENSORS[1]).category, 'entry_sensor');
  } finally {
    await r.done();
  }
});

test('the public client lists accessories, reports their state and forwards accessory events', async () => {
  const fixture = cloudFixture({ inventory: reportedInventory() });
  const client = new EufyMegaClient(fixture.options);
  try {
    assert.deepEqual(client.accessoryObservation, zero);
    await client.connect();
    const result = await client.discoverDevices();
    assert.equal(result.accessories.length, 7);
    assert.deepEqual(
      (await client.listDevices()).map((d) => d.model),
      ['T8170', 'T8170', 'T8214', 'T8030'],
    );
    assert.deepEqual(
      (await client.listAccessories()).map((a) => a.category),
      ['entry_sensor', 'entry_sensor', 'entry_sensor', 'keypad', 'chime', 'chime', 'entry_sensor'],
    );
    const chime = await client.getAccessoryState(CHIMES[0]);
    assert.deepEqual(chime, { id: CHIMES[0], stationId: null, category: 'chime', readings: {} });
    const sensor = await client.getAccessoryState(SENSORS[0]);
    assert.deepEqual(sensor.readings, { open: null, batteryLow: null });
    await assert.rejects(client.getAccessoryState('SYNTH_T8170_1'), { code: 'unknown_device' });
    const states = [];
    client.on('accessory', (state) => states.push(state));
    client.transport.filterPush(
      {
        name: '',
        type: 2,
        event_time: 0,
        station_sn: HB,
        device_sn: SENSORS[0],
        event_type: 3,
        sensor_open: true,
      },
      'cloud',
    );
    await turn();
    assert.deepEqual(
      states.map((s) => [s.id, s.readings.open.value]),
      [[SENSORS[0], true]],
    );
    assert.equal(client.accessoryObservation.push_door_sensor, 1);
    assert.deepEqual(
      (await client.getStationState(HB)).availableModes,
      [0, 1, 2, 3, 4, 5, 6, 47, 63],
    );
  } finally {
    await client.close();
  }
});
