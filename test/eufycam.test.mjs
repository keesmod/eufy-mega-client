import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { EventTransport } from '../dist/event-transport.js';
import { Camera, Station, PropertyName } from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

// Exact catalogue pairs from MODEL_MATRIX.md, independently authored synthetic values.
const models = [
  ['T8111', 1],
  ['T8110', 10035],
  ['T8112', 4],
  ['T8113', 8],
  ['T8114', 9],
  ['T8140', 14],
  ['T8142', 15],
  ['T8160', 19],
  ['T8161', 23],
  ['T8600', 24],
  ['T8162', 26],
  ['T8144', 49],
  ['T8172', 89],
];
const base = (id = 'T8030_BASE') => ({
  category: 'eufy_security',
  device_sn: id,
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  p2p_did: 'synthetic',
  member: { admin_user_id: 'synthetic' },
  params: [],
});
const camera = (model, type, extra = {}) => ({
  category: 'eufy_security',
  device_sn: model + '_SYNTHETIC',
  parent_sn: 'T8030_BASE',
  device_model: model,
  device_type: type,
  device_channel: 2,
  device_name: 'Synthetic camera',
  main_sw_version: '1.2.3',
  main_hw_version: 'fixture',
  params: [],
  ...extra,
});
const params = (battery, status) => [
  { param_type: CommandType.CMD_GET_BATTERY, param_value: battery },
  { param_type: CommandType.CMD_GET_DEV_STATUS, param_value: status },
];
async function fixture(rows, check) {
  const original = Station.getInstance;
  Station.getInstance = async (_provider, wire) =>
    Object.assign(new EventEmitter(), {
      setConnectionType() {},
      initialize() {},
      update() {},
      dispose: async () => {},
      getSerial: () => wire.station_sn,
      hasProperty: () => false,
      isConnected: () => false,
      processPushNotification() {},
    });
  const t = new DeviceTransport();
  try {
    const inventory = discover(rows);
    await t.load(inventory.raw, inventory);
    await check(t, inventory);
  } finally {
    await t.close();
    Station.getInstance = original;
  }
}
for (const [model, type] of models) {
  test(`${model}/${type} selects Camera with its actual HomeBase and observed state`, async () => {
    const raw = camera(model, type, { parent_sn: 'T8030_OTHER', params: params('71', '1') });
    await fixture([base(), base('T8030_OTHER'), raw], async (t, inventory) => {
      const sdk = t.cameras.get(raw.device_sn);
      assert.ok(sdk instanceof Camera);
      assert.equal(sdk.constructor, Camera);
      assert.equal(sdk.getStationSerial(), 'T8030_OTHER');
      assert.equal(t.device(raw.device_sn).stationId, 'T8030_OTHER');
      assert.deepEqual(t.device(raw.device_sn), inventory.result.devices.at(-1));
      assert.equal(t.device(raw.device_sn).firmware, '1.2.3');
      assert.equal(t.device(raw.device_sn).battery, model === 'T8600' ? null : 71);
      assert.equal(t.device(raw.device_sn).availability, [1, 4].includes(type) ? null : 'online');
      assert.equal(t.supportsEvent(raw.device_sn, 'motion'), true);
      assert.equal(t.supportsEvent(raw.device_sn, 'person'), true);
      assert.equal(t.supportsEvent(raw.device_sn, 'ring'), false);
      const events = [];
      t.on('detection', (d) => events.push(d));
      sdk.emit('motion detected', sdk, false);
      sdk.emit('rings', sdk, true);
      sdk.emit('motion detected', sdk, true);
      sdk.emit('person detected', sdk, true, 'Synthetic person');
      assert.deepEqual(
        events.map((e) => e.type),
        ['motion', 'person'],
      );
      if (!['T8160', 'T8142'].includes(model)) {
        await assert.rejects(t.startLive(raw.device_sn), { code: 'camera_media_unverified' });
        await assert.rejects(t.snapshot(raw.device_sn), { code: 'camera_media_unverified' });
      }
    });
  });
}
test('missing and malformed state stays unknown, zero is observed, wired battery is absent', async () => {
  for (const value of [undefined, null, '', 'NaN', '12bad', ' ', true, -1, 101, Infinity]) {
    const raw = camera('T8113', 8, { main_sw_version: '', params: params(value, value) });
    await fixture([base(), raw], async (t, inventory) => {
      const state = t.device(raw.device_sn);
      assert.equal(state.battery, null);
      assert.equal(state.availability, null);
      assert.equal(state.firmware, null);
      assert.deepEqual(state, inventory.result.devices.at(-1));
    });
  }
  await fixture([base(), camera('T8113', 8, { params: params('0', '0') })], async (t) => {
    const state = t.device('T8113_SYNTHETIC');
    assert.equal(state.battery, 0);
    assert.equal(state.availability, 'offline');
  });
});
test('P2P state belongs to the actual owner and channel and refresh removes old observations', async () => {
  const raw = camera('T8113', 8);
  await fixture([base(), base('T8030_WRONG'), raw], async (t) => {
    assert.equal(t.device(raw.device_sn).availability, null);
    const owner = t.stations.get('T8030_BASE');
    const wrong = t.stations.get('T8030_WRONG');
    wrong.emit('runtime state', wrong, 2, 91);
    wrong.emit('raw device property changed', raw.device_sn, {
      [CommandType.CMD_GET_DEV_STATUS]: { value: '1', source: 'p2p' },
    });
    assert.equal(t.device(raw.device_sn).battery, null);
    assert.equal(t.device(raw.device_sn).availability, null);
    owner.emit('runtime state', owner, 2, 34);
    owner.emit('raw device property changed', raw.device_sn, {
      [CommandType.CMD_GET_DEV_STATUS]: { value: '2', source: 'p2p' },
    });
    assert.equal(t.device(raw.device_sn).battery, 34);
    assert.equal(t.device(raw.device_sn).availability, 'disabled');
    owner.emit('runtime state', owner, 2, 'bad');
    assert.equal(t.device(raw.device_sn).battery, 34);
    const next = discover([base(), base('T8030_WRONG'), { ...raw, parent_sn: 'T8030_WRONG' }]);
    await t.load(next.raw, next);
    assert.equal(t.device(raw.device_sn).battery, null);
    assert.equal(t.device(raw.device_sn).availability, null);
  });
});
test('unsupported tuples, owners and failed camera initialization leave other families usable', async () => {
  const rows = [
    base(),
    camera('T8111', 1),
    camera('T8142R', 15),
    camera('T8112', 19),
    camera('T8161', 23, { parent_sn: 'OLD_BASE' }),
    camera('T8213', 91),
    camera('T8134', 63),
    camera('T8144', 49, { params: {} }),
  ];
  await fixture(rows, async (t, inventory) => {
    for (const id of ['T8111', 'T8213', 'T8134']) assert.ok(t.cameras.has(id + '_SYNTHETIC'));
    assert.deepEqual(
      inventory.result.issues.map((i) => i.code),
      ['unsupported_device', 'unsupported_device', 'unsupported_station'],
    );
    assert.throws(() => t.device('T8144_SYNTHETIC'), { code: 'device_initialization_failed' });
    assert.throws(() => t.device('T8161_SYNTHETIC'), { code: 'unsupported_station' });
  });
});
test('public discovery and getDeviceState expose observations without changing identity', async () => {
  const raw = camera('T8111', 1, { params: params('61', '1') });
  const cloud = cloudFixture({ inventory: [raw, { ...base(), p2p_did: undefined }] });
  const client = new EufyMegaClient(cloud.options);
  try {
    await client.connect();
    const listed = (await client.listDevices())[0];
    const state = await client.getDeviceState(raw.device_sn);
    assert.deepEqual(state, listed);
    assert.equal(state.battery, 61);
  } finally {
    await client.close();
  }
});
test('cross-transport person duplicates collapse, ring stays doorbell-only, owner mismatch is ignored', async () => {
  await fixture(
    [base(), base('T8030_WRONG'), camera('T8111', 1), camera('T8213', 91)],
    async (t) => {
      const received = [];
      const events = new EventTransport(
        {},
        (id) => t.supportsEvent(id, 'notification'),
        (message) => t.processPush(message),
        (message) => t.acceptPush(message),
      );
      events.on('event', (event) => received.push(event));
      t.on('detection', (d) => events.device(d.id, d.type, d.name, d.stranger));
      const message = {
        device_sn: 'T8111_SYNTHETIC',
        station_sn: 'T8030_BASE',
        event_type: 3111,
        msg_type: 18,
        event_time: Date.now(),
        unique_id: 'one',
        type: 1,
        person_name: 'Synthetic person',
      };
      try {
        events.push({ ...message, station_sn: 'T8030_WRONG' });
        events.push({ ...message, event_type: 3103 });
        events.push(message);
        events.push({ ...message, type: 2 });
        events.push({
          ...message,
          device_sn: 'T8213_SYNTHETIC',
          event_type: 3103,
          unique_id: 'ring1',
        });
        events.push({
          ...message,
          device_sn: 'T8213_SYNTHETIC',
          event_type: 3103,
          unique_id: 'ring2',
        });
        await delay(550);
        assert.equal(received.length, 3);
        assert.deepEqual(
          received.map((e) => e.type),
          ['person', 'ring', 'ring'],
        );
        assert.equal(received[0].personName, 'Synthetic person');
        assert.equal(received[0].recognition, 'known');
        events.push(message);
        await delay(550);
        assert.equal(received.length, 3);
        assert.equal(events.status.duplicates >= 2, true);
      } finally {
        await events.close();
      }
    },
  );
});

test('HomeBase push state still routes without fabricating a camera detection', async () => {
  await fixture([base(), camera('T8113', 8)], async (t) => {
    const received = [];
    const statePushes = [];
    t.stations.get('T8030_BASE').processPushNotification = (message) => statePushes.push(message);
    const events = new EventTransport(
      {},
      (id) => t.supportsEvent(id, 'notification'),
      (message) => t.processPush(message),
      (message) => t.acceptPush(message),
    );
    events.on('event', (event) => received.push(event));
    const faults = [];
    events.on('fault', (error) => faults.push(error.code));
    try {
      events.push({ device_sn: 'T8030_BASE', station_sn: 'T8030_BASE', type: 18, event_type: 1 });
      events.push(null);
      await delay(550);
      assert.equal(statePushes.length, 1);
      assert.equal(received.length, 0);
      assert.deepEqual(faults, ['invalid_event']);
    } finally {
      await events.close();
    }
  });
});
