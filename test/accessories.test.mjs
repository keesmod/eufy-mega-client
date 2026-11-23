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
import { cameraInfoReports, parseParamReports } from '../dist/vendor/p2p/param-report.js';
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

test('session reply parameters use the same checks with a larger bound', () => {
  const entry = (channel, type, value) => ({
    dev_type: channel,
    param_type: type,
    param_value: value,
  });
  assert.deepEqual(
    cameraInfoReports([entry(16, 1550, '1'), entry(17, 1552, 0), entry(-1, 1550, '1')]),
    [
      { channel: 16, type: 1550, value: '1' },
      { channel: 17, type: 1552, value: '0' },
    ],
  );
  for (const bad of [undefined, null, 'x', {}, { params: [] }])
    assert.deepEqual(cameraInfoReports(bad), []);
  const many = Array.from({ length: 3000 }, (_, i) => entry(i % 60000, 1550, '1'));
  assert.equal(cameraInfoReports(many).length, 2048);
});

test('encoded session reply entries follow the plain ones, decoded and with the same checks', () => {
  // ha-eufy-cam#306: the reply's db_bypass_str, decoded as the vendored Station decodes it.
  const entry = (channel, type, value) => ({
    dev_type: channel,
    param_type: type,
    param_value: value,
  });
  const encoded = (channel, type, value) => ({
    channel,
    param_type: type,
    param_value: Buffer.from(value).toString('base64'),
  });
  assert.deepEqual(
    cameraInfoReports(
      [entry(16, 1552, '1')],
      [
        encoded(16, 1552, '0'),
        encoded(17, 1101, '90'),
        { channel: 16, param_type: 1552, param_value: 0 },
        encoded(16, 1552, 'x'.repeat(65)),
        encoded(16, 1552, 'x'.repeat(67)),
        encoded(18, 1552, 'y'.repeat(64)),
        encoded(-1, 1552, '0'),
        { dev_type: 16, param_type: 1552, param_value: 'MA==' },
        null,
      ],
    ),
    [
      { channel: 16, type: 1552, value: '1' },
      { channel: 16, type: 1552, value: '0' },
      { channel: 17, type: 1101, value: '90' },
      // 64 characters, 88 in base64, are the longest value kept.
      { channel: 18, type: 1552, value: 'y'.repeat(64) },
    ],
  );
  for (const bad of [undefined, null, 'x', {}])
    assert.deepEqual(cameraInfoReports([entry(16, 1550, '1')], bad), [
      { channel: 16, type: 1550, value: '1' },
    ]);
  // The bound covers both lists.
  const plain = Array.from({ length: 2040 }, (_, i) => entry(i, 1550, '1'));
  const extra = Array.from({ length: 20 }, (_, i) => encoded(i, 1551, '1'));
  const bounded = cameraInfoReports(plain, extra);
  assert.equal(bounded.length, 2048);
  assert.deepEqual(
    bounded.slice(2040).map((r) => [r.channel, r.type]),
    Array.from({ length: 8 }, (_, i) => [i, 1551]),
  );
  assert.equal(
    cameraInfoReports([...plain, ...plain], extra).filter((r) => r.type === 1551).length,
    0,
  );
});

test('reading values are strict', () => {
  assert.deepEqual(
    ['0', '1', 0, 1].map((v) => readingValue('entry_sensor', 'open', v)),
    [false, true, false, true],
  );
  for (const v of ['2', '01', 'true', '', ' 1', 1.5, null, undefined, -1, '1e0'])
    assert.equal(readingValue('entry_sensor', 'open', v), undefined, String(v));
  assert.deepEqual(
    ['0', '1', '2', '3', '4'].map((v) => readingValue('keypad', 'charging', v)),
    [false, true, false, true, undefined],
  );
  // ha-eufy-cam#286: a keypad sends battery state 2 with a full battery. An
  // entry sensor's battery low stays 0 or 1.
  assert.deepEqual(
    ['0', '1', '2', 2, '3', '02', 'true'].map((v) => readingValue('keypad', 'batteryLow', v)),
    [false, true, false, false, undefined, undefined, undefined],
  );
  assert.deepEqual(
    ['0', '1', '2', 2].map((v) => readingValue('entry_sensor', 'batteryLow', v)),
    [false, true, undefined, undefined],
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
    cameraInfo: (params, extra = {}) => control(CommandType.CMD_CAMERA_INFO, { params, ...extra }),
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
    const battery = r.transport.accessoryState(SENSORS[1]).readings.batteryLow;
    assert.deepEqual([battery.value, battery.source], [false, 'p2p']);
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

test('keypad device information arrives through the wire, an entry sensor value by its channel', async () => {
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
      [KEYPAD, SENSORS[0]],
    );
    const { batteryLow, charging } = r.transport.accessoryState(KEYPAD).readings;
    assert.deepEqual(
      [batteryLow.value, batteryLow.source, charging.value, charging.source],
      [false, 'p2p', false, 'p2p'],
    );
    // Entry sensors are not in the wire. Their values come from the reply's channels.
    const open = r.transport.accessoryState(SENSORS[0]).readings.open;
    assert.deepEqual([open.value, open.source, open.live], [true, 'p2p', true]);
    assert.deepEqual(r.transport.accessoryObservation(), { ...zero, camera_info: 3 });
  } finally {
    await r.done();
  }
});

test('a session reply gives entry sensors their starting values without other counts', async () => {
  const r = await rig();
  try {
    const camera = r.inventory.result.devices.find((d) => d.kind === 'camera');
    const cameraChannel = r.inventory.raw.get(camera.id).device_channel;
    r.cameraInfo([
      param(255, 1176, '1'),
      param(cameraChannel, 1550, '1'),
      param(CHANNELS[SENSORS[1]], 1550, '1'),
      param(CHANNELS[SENSORS[1]], 1552, '0'),
      param(CHANNELS[SENSORS[3]], 1550, 'x'),
      param(CHANNELS[SENSORS[2]], 1550, '0'),
      param(99, 1550, '1'),
    ]);
    assert.deepEqual(
      r.events.map((e) => e.id),
      [SENSORS[1], SENSORS[2]],
    );
    const { open, batteryLow } = r.transport.accessoryState(SENSORS[1]).readings;
    assert.deepEqual(
      [open.value, open.source, batteryLow.value, batteryLow.source],
      [true, 'p2p', false, 'p2p'],
    );
    assert.equal(r.transport.accessoryState(SENSORS[2]).readings.open.value, false);
    // A camera channel, the HomeBase channel and an unknown channel count nothing.
    assert.deepEqual(r.transport.accessoryObservation(), { ...zero, camera_info: 3 });
    // The same reply again changes nothing and sends no event.
    r.cameraInfo([param(CHANNELS[SENSORS[1]], 1550, '1')]);
    assert.equal(r.events.length, 2);
  } finally {
    await r.done();
  }
});

test('a HomeBase without accessories ignores the session reply for accessories', async () => {
  const r = await rig(withoutAccessories(reportedInventory()));
  try {
    r.cameraInfo([param(16, 1550, '1'), param(17, 1552, '1')]);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.transport.accessoryObservation(), zero);
  } finally {
    await r.done();
  }
});

test('names prefer a non-empty alias, then the device name', () => {
  const rows = reportedInventory().map((row) =>
    row.device_sn === SENSORS[0]
      ? { ...row, device_alias_name: '', device_name: 'Synthetic hall' }
      : row.device_sn === SENSORS[1]
        ? { ...row, device_alias_name: 'Synthetic alias' }
        : row.device_sn === SENSORS[2]
          ? { ...row, device_alias_name: '', device_name: '' }
          : row.device_model === 'T8170'
            ? { ...row, device_alias_name: '' }
            : row,
  );
  const { result } = discover(rows);
  const name = (id) => result.accessories.find((a) => a.id === id).name;
  assert.equal(name(SENSORS[0]), 'Synthetic hall');
  assert.equal(name(SENSORS[1]), 'Synthetic alias');
  assert.equal(name(SENSORS[2]), '');
  assert.equal(name(SENSORS[3]), 'Synthetic T8900');
  for (const device of result.devices.filter((d) => d.model === 'T8170'))
    assert.equal(device.name, 'Synthetic T8170');
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
    // The session reply uses the same exclusion and counts nothing for these channels.
    r.cameraInfo([param(2, 1550, '1'), param(CHANNELS[SENSORS[0]], 1550, '1')]);
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

test('an entry sensor row without battery state reads battery normal, the vendored default', async () => {
  // ha-eufy-cam#306: four T8900 under a T8030 on 3.8.8.0. The inventory had
  // 1552 = 0 for one sensor, no other route carried 1552, and the eufy app
  // showed every battery full.
  const rows = reportedInventory();
  const at = (id) => rows.findIndex((row) => row.device_sn === id);
  rows[at(SENSORS[0])] = {
    ...rows[at(SENSORS[0])],
    params: [
      { param_type: 1550, param_value: '0' },
      { param_type: 1101, param_value: '30' },
    ],
  };
  const { params: _omitted, ...withoutList } = rows[at(SENSORS[1])];
  rows[at(SENSORS[1])] = withoutList;
  rows[at(SENSORS[2])] = {
    ...rows[at(SENSORS[2])],
    params: [{ param_type: 1552, param_value: '0' }],
  };
  rows[at(SENSORS[3])] = {
    ...rows[at(SENSORS[3])],
    params: [{ param_type: 1552, param_value: '1' }],
  };
  rows[at(KEYPAD)] = { ...rows[at(KEYPAD)], params: [{ param_type: 1654, param_value: '1' }] };
  const r = await rig(rows);
  const reading = (id, name) => {
    const value = r.transport.accessoryState(id).readings[name];
    return value && [value.value, value.source, value.live];
  };
  try {
    assert.deepEqual(reading(SENSORS[0], 'batteryLow'), [false, 'cloud', false]);
    assert.deepEqual(reading(SENSORS[0], 'open'), [false, 'cloud', false]);
    // A row without a parameter list gives no reading, and contact has no default.
    assert.equal(reading(SENSORS[1], 'batteryLow'), null);
    assert.equal(reading(SENSORS[1], 'open'), null);
    assert.deepEqual(reading(SENSORS[2], 'batteryLow'), [false, 'cloud', false]);
    assert.deepEqual(reading(SENSORS[3], 'batteryLow'), [true, 'cloud', false]);
    // A keypad has no default.
    assert.equal(reading(KEYPAD, 'batteryLow'), null);
    assert.equal(reading(KEYPAD, 'charging'), null);
    // A default is no inventory value, so only 1550 and the two 1552 count.
    assert.equal(r.transport.accessoryObservation().cloud_seeded, 3);
    // An observation replaces the default and a later discovery never restores it.
    r.hub([param(CHANNELS[SENSORS[0]], 1552, '1')]);
    assert.deepEqual(reading(SENSORS[0], 'batteryLow'), [true, 'p2p', true]);
    assert.deepEqual(
      r.events.map((e) => e.id),
      [SENSORS[0]],
    );
    // Each later discovery reads its rows anew. Unlisted rows stay as reported.
    const reload = async (changes) => {
      const next = discover(
        rows.map((row) => {
          if (!Object.hasOwn(changes, row.device_sn)) return row;
          const { params: _list, ...rest } = row;
          return changes[row.device_sn] === undefined
            ? rest
            : { ...rest, params: changes[row.device_sn] };
        }),
      );
      await r.transport.load(next.raw, next);
    };
    await reload({ [SENSORS[1]]: [], [SENSORS[3]]: [] });
    assert.deepEqual(reading(SENSORS[0], 'batteryLow'), [true, 'p2p', true]);
    assert.deepEqual(reading(SENSORS[1], 'batteryLow'), [false, 'cloud', false]);
    // A default never replaces an earlier inventory value, so a low battery stays low.
    assert.deepEqual(reading(SENSORS[3], 'batteryLow'), [true, 'cloud', false]);
    // An inventory value replaces the default, and a row without a parameter list
    // removes it.
    await reload({ [SENSORS[1]]: [{ param_type: 1552, param_value: '1' }] });
    assert.deepEqual(reading(SENSORS[1], 'batteryLow'), [true, 'cloud', false]);
    await reload({ [SENSORS[1]]: [] });
    assert.deepEqual(reading(SENSORS[1], 'batteryLow'), [true, 'cloud', false]);
    await reload({ [SENSORS[1]]: undefined });
    assert.equal(reading(SENSORS[1], 'batteryLow'), null);
    await reload({ [SENSORS[1]]: [] });
    assert.deepEqual(reading(SENSORS[1], 'batteryLow'), [false, 'cloud', false]);
    assert.equal(r.events.length, 1);
  } finally {
    await r.done();
  }
});

const noParameters = Object.freeze({ types: [], codes: {} });

test('a keypad keeps the parameter types of each route and only its battery codes', async () => {
  const rows = reportedInventory();
  const keypadRow = rows.findIndex((row) => row.device_sn === KEYPAD);
  rows[keypadRow] = {
    ...rows[keypadRow],
    params: [
      { param_type: 1653, param_value: '3' },
      { param_type: 1655, param_value: 2 },
      { param_type: 1101, param_value: '100' },
      { param_type: 1657, param_value: '123456' },
      { param_type: 1141, param_value: '-61' },
      { param_type: '1654', param_value: 'x' },
      { param_type: 'name', param_value: '1' },
      null,
    ],
  };
  const r = await rig(rows);
  try {
    assert.deepEqual(r.transport.accessoryParameters(KEYPAD), {
      cloud: {
        types: [1101, 1141, 1653, 1654, 1655, 1657],
        codes: { 1101: '100', 1653: '3', 1654: 'other', 1655: '2' },
      },
      camera_info: noParameters,
      hub_notify: noParameters,
    });
    // A battery state other than 0, 1 or 2 sets no reading, but stays visible as evidence.
    assert.equal(r.transport.accessoryState(KEYPAD).readings.batteryLow, null);
    r.cameraInfo([
      param(CHANNELS[KEYPAD], 1653, '4'),
      param(CHANNELS[KEYPAD], 1655, '2'),
      param(CHANNELS[KEYPAD], 1657, '0000'),
      param(CHANNELS[KEYPAD], 1101, '1234567'),
      param(CHANNELS[SENSORS[0]], 1101, '90'),
      param(CHANNELS[SENSORS[0]], 1550, '1'),
    ]);
    r.hub([param(CHANNELS[KEYPAD], 1655, '1'), param(CHANNELS[KEYPAD], 1655, '3')]);
    const parameters = r.transport.accessoryParameters(KEYPAD);
    assert.deepEqual(parameters.camera_info, {
      types: [1101, 1653, 1655, 1657],
      codes: { 1101: 'other', 1653: '4', 1655: '2' },
    });
    assert.deepEqual(parameters.hub_notify, { types: [1655], codes: { 1655: '3' } });
    // An entry sensor keeps only its own battery keys, a chime nothing. The counts are unchanged.
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[0]), {
      cloud: noParameters,
      camera_info: { types: [1101, 1550], codes: { 1101: '90' } },
      hub_notify: noParameters,
    });
    assert.equal(r.transport.accessoryParameters(CHIMES[0]), null);
    assert.equal(r.transport.accessoryParameters(HB), null);
    assert.equal(r.transport.accessoryParameters('SYNTH_UNKNOWN'), null);
    assert.deepEqual(r.transport.accessoryObservation(), {
      ...zero,
      hub_notify: 2,
      camera_info: 2,
      cloud_seeded: 1,
    });
    // A later discovery replaces the inventory evidence and keeps the P2P routes.
    const again = discover(
      rows.map((row, i) =>
        i === keypadRow ? { ...row, params: [{ param_type: 1655, param_value: '0' }] } : row,
      ),
    );
    await r.transport.load(again.raw, again);
    assert.deepEqual(r.transport.accessoryParameters(KEYPAD), {
      cloud: { types: [1655], codes: { 1655: '0' } },
      camera_info: parameters.camera_info,
      hub_notify: parameters.hub_notify,
    });
    // The result is a copy.
    r.transport.accessoryParameters(KEYPAD).cloud.types.push(1);
    assert.deepEqual(r.transport.accessoryParameters(KEYPAD).cloud.types, [1655]);
  } finally {
    await r.done();
  }
});

test('keypad evidence keeps at most 64 other parameter types per route, and always the battery keys', () => {
  const store = new AccessoryStore();
  const inventory = discover(reportedInventory());
  store.load(inventory.accessories);
  for (let type = 2000; type < 2070; type++) store.parameter(KEYPAD, 'camera_info', type, '1');
  store.parameter(KEYPAD, 'camera_info', 1655, '1');
  store.parameter(KEYPAD, 'camera_info', 1653, 0);
  store.parameter(KEYPAD, 'camera_info', 2000, '1');
  store.parameter(KEYPAD, 'camera_info', 3000, '1');
  for (const type of [-1, 65536, 1.5, NaN, '01x', null])
    store.parameter(KEYPAD, 'hub_notify', type, '1');
  const parameters = store.parameters(KEYPAD);
  assert.equal(parameters.camera_info.types.length, 66);
  assert.deepEqual(parameters.camera_info.types.slice(0, 2), [1653, 1655]);
  assert.equal(parameters.camera_info.types.at(-1), 2063);
  assert.deepEqual(parameters.camera_info.codes, { 1653: '0', 1655: '1' });
  assert.deepEqual(parameters.hub_notify, noParameters);
});

test('encoded device information entries reach the keypad evidence like their readings', async () => {
  const r = await rig();
  try {
    const encoded = (type, value) => ({
      channel: CHANNELS[KEYPAD],
      param_type: type,
      param_value: Buffer.from(value).toString('base64'),
    });
    r.cameraInfo([param(CHANNELS[KEYPAD], 1101, '100')], {
      db_bypass_str: [encoded(1655, '1'), encoded(1653, '0'), encoded(1657, '4321')],
    });
    const { batteryLow, charging } = r.transport.accessoryState(KEYPAD).readings;
    assert.deepEqual([batteryLow.value, charging.value], [false, true]);
    assert.deepEqual(r.transport.accessoryParameters(KEYPAD).camera_info, {
      types: [1101, 1653, 1655, 1657],
      codes: { 1101: '100', 1653: '0', 1655: '1' },
    });
    // An encoded entry overrides a plain one of the same type, in the reading and the code.
    r.cameraInfo([param(CHANNELS[KEYPAD], 1655, '0')], {
      db_bypass_str: [encoded(1655, '1')],
    });
    assert.equal(r.transport.accessoryState(KEYPAD).readings.charging.value, true);
    assert.equal(r.transport.accessoryParameters(KEYPAD).camera_info.codes[1655], '1');
    r.cameraInfo([param(CHANNELS[KEYPAD], 1655, '2')]);
    assert.equal(r.transport.accessoryState(KEYPAD).readings.charging.value, false);
    assert.equal(r.transport.accessoryParameters(KEYPAD).camera_info.codes[1655], '2');
  } finally {
    await r.done();
  }
});

test('an entry sensor keeps the parameter types of each route and only its battery codes', async () => {
  // ha-eufy-cam#306: four T8900 under a T8030 on 3.8.8.0 showed battery unknown
  // while the eufy app showed them full. Only one had a battery value, from the
  // inventory. Values here are synthetic.
  const rows = reportedInventory();
  const sensorRow = (id) => rows.findIndex((row) => row.device_sn === id);
  rows[sensorRow(SENSORS[0])] = {
    ...rows[sensorRow(SENSORS[0])],
    params: [
      { param_type: 1550, param_value: '0' },
      { param_type: 1551, param_value: '1700000000' },
      { param_type: 1552, param_value: '0' },
      { param_type: 1101, param_value: 95 },
    ],
  };
  rows[sensorRow(SENSORS[2])] = {
    ...rows[sensorRow(SENSORS[2])],
    params: [{ param_type: 1552, param_value: '2' }],
  };
  const r = await rig(rows);
  const encoded = (id, type, value) => ({
    channel: CHANNELS[id],
    param_type: type,
    param_value: Buffer.from(value).toString('base64'),
  });
  try {
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[0]).cloud, {
      types: [1101, 1550, 1551, 1552],
      codes: { 1101: '95', 1552: '0' },
    });
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[1]), {
      cloud: noParameters,
      camera_info: noParameters,
      hub_notify: noParameters,
    });
    // A battery state other than 0 or 1 sets no reading, but stays visible as evidence.
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[2]).cloud, {
      types: [1552],
      codes: { 1552: '2' },
    });
    assert.equal(r.transport.accessoryState(SENSORS[2]).readings.batteryLow, null);
    // A row without battery state reads the vendored default.
    const fallback = r.transport.accessoryState(SENSORS[1]).readings.batteryLow;
    assert.deepEqual([fallback.value, fallback.source], [false, 'cloud']);

    // Encoded entries of the session reply reach an entry sensor like plain ones.
    r.cameraInfo([param(CHANNELS[SENSORS[1]], 1550, '1')], {
      db_bypass_str: [
        encoded(SENSORS[1], 1552, '0'),
        encoded(SENSORS[1], 1560, '3'),
        encoded(SENSORS[2], 1552, '2'),
        encoded(SENSORS[3], 1552, 'x'.repeat(70)),
      ],
    });
    assert.deepEqual(
      r.events.map((e) => e.id),
      [SENSORS[1]],
    );
    let { open, batteryLow } = r.transport.accessoryState(SENSORS[1]).readings;
    assert.deepEqual(
      [open.value, open.source, batteryLow.value, batteryLow.source, batteryLow.live],
      [true, 'p2p', false, 'p2p', true],
    );
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[1]).camera_info, {
      types: [1550, 1552, 1560],
      codes: { 1552: '0' },
    });
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[2]).camera_info, {
      types: [1552],
      codes: { 1552: '2' },
    });
    assert.equal(r.transport.accessoryState(SENSORS[2]).readings.batteryLow, null);
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[3]).camera_info, noParameters);

    // An encoded entry overrides a plain one of the same type, in the reading and the code,
    // without an intermediate change: the unchanged reading sends no event and counts once.
    r.cameraInfo([param(CHANNELS[SENSORS[1]], 1552, '1')], {
      db_bypass_str: [encoded(SENSORS[1], 1552, '0')],
    });
    ({ batteryLow } = r.transport.accessoryState(SENSORS[1]).readings);
    assert.equal(batteryLow.value, false);
    assert.equal(r.events.length, 1);
    assert.equal(r.transport.accessoryParameters(SENSORS[1]).camera_info.codes[1552], '0');
    // An encoded value that no reading accepts wins over the plain one and
    // leaves the reading unchanged, as for a device in the wire.
    r.cameraInfo([param(CHANNELS[SENSORS[1]], 1552, '1')], {
      db_bypass_str: [encoded(SENSORS[1], 1552, '2')],
    });
    assert.equal(r.transport.accessoryState(SENSORS[1]).readings.batteryLow.value, false);
    assert.equal(r.transport.accessoryParameters(SENSORS[1]).camera_info.codes[1552], '2');
    assert.equal(r.events.length, 1);

    // A hub notify battery state is kept as evidence and read.
    r.hub([param(CHANNELS[SENSORS[0]], 1552, '1')]);
    ({ batteryLow } = r.transport.accessoryState(SENSORS[0]).readings);
    assert.deepEqual([batteryLow.value, batteryLow.source], [true, 'p2p']);
    assert.deepEqual(r.transport.accessoryParameters(SENSORS[0]).hub_notify, {
      types: [1552],
      codes: { 1552: '1' },
    });
    assert.deepEqual(r.transport.accessoryObservation(), {
      ...zero,
      cloud_seeded: 2,
      camera_info: 3,
      hub_notify: 1,
    });
  } finally {
    await r.done();
  }
});

test('entry sensor evidence keeps at most 64 other parameter types per route, and always its battery keys', () => {
  const store = new AccessoryStore();
  const inventory = discover(reportedInventory());
  store.load(inventory.accessories);
  for (let type = 2000; type < 2070; type++) store.parameter(SENSORS[0], 'camera_info', type, '1');
  store.parameter(SENSORS[0], 'camera_info', 1552, '0');
  store.parameter(SENSORS[0], 'camera_info', 1101, 80);
  store.parameter(SENSORS[0], 'camera_info', 1653, '1');
  const parameters = store.parameters(SENSORS[0]);
  assert.equal(parameters.camera_info.types.length, 66);
  assert.deepEqual(parameters.camera_info.types.slice(0, 2), [1101, 1552]);
  assert.equal(parameters.camera_info.types.at(-1), 2063);
  // A keypad battery key is no entry sensor battery key, so it is neither exempt nor kept.
  assert.deepEqual(parameters.camera_info.codes, { 1101: '80', 1552: '0' });
  assert.equal(store.parameters(CHIMES[0]), undefined);
});

test('a keypad battery state 2 reads not low on every route, an entry sensor 2 changes nothing', async () => {
  // ha-eufy-cam#286: a T8960 under a T8030 on 3.8.8.0 sent 1653 = 2, 1654 = 1
  // and 1655 = 2 from the inventory and the HomeBase while the eufy app showed
  // its battery full.
  const rows = reportedInventory();
  const keypadRow = rows.findIndex((row) => row.device_sn === KEYPAD);
  rows[keypadRow] = {
    ...rows[keypadRow],
    params: [
      { param_type: 1653, param_value: '2' },
      { param_type: 1654, param_value: '1' },
      { param_type: 1655, param_value: '2' },
    ],
  };
  const r = await rig(rows);
  try {
    let { batteryLow, charging } = r.transport.accessoryState(KEYPAD).readings;
    assert.deepEqual(
      [batteryLow.value, batteryLow.source, charging.value, charging.source],
      [false, 'cloud', false, 'cloud'],
    );
    r.cameraInfo([
      param(CHANNELS[KEYPAD], 1653, '2'),
      param(CHANNELS[KEYPAD], 1654, '1'),
      param(CHANNELS[KEYPAD], 1655, '2'),
    ]);
    ({ batteryLow, charging } = r.transport.accessoryState(KEYPAD).readings);
    assert.deepEqual(
      [batteryLow.value, batteryLow.source, charging.value, charging.source],
      [false, 'p2p', false, 'p2p'],
    );
    assert.deepEqual(r.transport.accessoryParameters(KEYPAD).camera_info.codes, {
      1653: '2',
      1654: '1',
      1655: '2',
    });
    // A hub notify battery state 2 counts for the keypad. For an entry sensor it
    // changes nothing, so the default of its inventory row stays.
    r.hub([param(CHANNELS[KEYPAD], 1653, 2), param(CHANNELS[SENSORS[0]], 1552, '2')]);
    const sensor = r.transport.accessoryState(SENSORS[0]).readings.batteryLow;
    assert.deepEqual([sensor.value, sensor.source], [false, 'cloud']);
    assert.deepEqual(r.transport.accessoryObservation(), {
      ...zero,
      cloud_seeded: 2,
      camera_info: 2,
      hub_notify: 1,
    });
  } finally {
    await r.done();
  }
});

test('an open HomeBase session with accessories asks for device information every five minutes', async (t) => {
  // ha-eufy-cam#286: the HomeBase sent no update when a keypad was plugged in
  // during an open session. Only device information carries the charger state.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const requests = (r) =>
    r.sent.filter(
      ({ command }) =>
        command.commandType === CommandType.CMD_CAMERA_INFO &&
        command.value === 255 &&
        command.channel === Station.CHANNEL,
    ).length;
  const r = await rig();
  try {
    r.cameraInfo([param(CHANNELS[KEYPAD], 1655, '2')]);
    r.events.length = 0;
    t.mock.timers.tick(299_999);
    assert.equal(requests(r), 0);
    t.mock.timers.tick(1);
    assert.equal(requests(r), 1);
    // The reply takes the session reply's path, so the keypad follows the plug.
    r.cameraInfo([param(CHANNELS[KEYPAD], 1655, '1')]);
    assert.deepEqual(
      r.events.map((e) => [e.id, e.readings.charging.value, e.readings.charging.live]),
      [[KEYPAD, true, true]],
    );
    // A busy or disconnected session waits for the next round.
    const holds = [
      [() => r.transport.lives.set(HB, {}), () => r.transport.lives.delete(HB)],
      [() => r.transport.starting.set(HB, 0), () => r.transport.starting.delete(HB)],
      [
        () => r.transport.recordings.operations.add(HB),
        () => r.transport.recordings.operations.delete(HB),
      ],
      [() => r.transport.commands.add(HB), () => r.transport.commands.delete(HB)],
      [() => (r.session.connected = false), () => (r.session.connected = true)],
    ];
    for (const [hold, release] of holds) {
      hold();
      t.mock.timers.tick(300_000);
      release();
      assert.equal(requests(r), 1);
    }
    t.mock.timers.tick(300_000);
    assert.equal(requests(r), 2);
    // A closed session asks nothing.
    r.station.emit('close', r.station);
    t.mock.timers.tick(300_000);
    assert.equal(requests(r), 2);
  } finally {
    await r.done();
  }
  t.mock.timers.tick(300_000);
  assert.equal(requests(r), 2);
  // A HomeBase without accessories gets no extra requests.
  const plain = await rig(withoutAccessories(reportedInventory()));
  try {
    t.mock.timers.tick(300_000);
    assert.equal(requests(plain), 0);
  } finally {
    await plain.done();
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
  assert.equal(store.observe(SENSORS[3], 'open', true, 'p2p', undefined, L + 10000), 'same');
  // A clock stepping back never lowers the P2P reference, so a close pushed at L+5 s is late.
  assert.equal(store.observe(SENSORS[3], 'open', true, 'p2p', undefined, L - 60000), 'same');
  assert.equal(store.observe(SENSORS[3], 'open', false, 'push', L + 5000, L + 11000), 'late');
  assert.equal(store.observe(SENSORS[3], 'open', false, 'push', undefined, L + 12000), 'changed');
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
    assert.equal(client.accessoryParameters(KEYPAD), null);
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
    assert.equal(sensor.readings.open, null);
    assert.deepEqual(
      [sensor.readings.batteryLow.value, sensor.readings.batteryLow.source],
      [false, 'cloud'],
    );
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
    for (const id of [KEYPAD, SENSORS[0]])
      assert.deepEqual(client.accessoryParameters(id), {
        cloud: { types: [], codes: {} },
        camera_info: { types: [], codes: {} },
        hub_notify: { types: [], codes: {} },
      });
    assert.equal(client.accessoryParameters(CHIMES[0]), null);
    assert.deepEqual(
      (await client.getStationState(HB)).availableModes,
      [0, 1, 2, 3, 4, 5, 6, 47, 63],
    );
  } finally {
    await client.close();
  }
});
