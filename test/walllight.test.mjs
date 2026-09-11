import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { EventTransport } from '../dist/event-transport.js';
import { Camera, WallLightCam, BatteryDoorbellCamera, Station } from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

// Exact pairs from the pinned MODEL_MATRIX.md. All observations are synthetic.
const models = [
  ['T84A1', 151],
  ['T81A0', 10005],
];
const owner = (id = 'T8030_OWNER') => ({
  category: 'eufy_security',
  device_sn: id,
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  main_sw_version: '3.8.6.0',
  p2p_did: 'synthetic',
  member: { admin_user_id: 'synthetic' },
  params: [],
});
const camera = (model, type, extra = {}) => ({
  category: 'eufy_security',
  device_sn: model + '_FIXTURE',
  parent_sn: 'T8030_OWNER',
  device_model: model,
  device_type: type,
  device_channel: 2,
  device_name: 'Synthetic Wall-light',
  main_sw_version: '1.2.3',
  params: [],
  ...extra,
});
const params = (battery, state) => [
  { param_type: CommandType.CMD_GET_BATTERY, param_value: battery },
  { param_type: CommandType.CMD_GET_DEV_STATUS, param_value: state },
];
async function fixture(rows, check) {
  const original = Station.getInstance;
  Station.getInstance = async (_provider, wire) =>
    Object.assign(new EventEmitter(), {
      getSerial: () => wire.station_sn,
      setConnectionType() {},
      initialize() {},
      update() {},
      dispose: async () => {},
      hasProperty: () => false,
      hasCommand: () => false,
      isConnected: () => false,
      processPushNotification() {},
    });
  const transport = new DeviceTransport();
  try {
    const inventory = discover(rows);
    await transport.load(inventory.raw, inventory);
    await check(transport, inventory);
  } finally {
    await transport.close();
    Station.getInstance = original;
  }
}

for (const [model, type] of models) {
  test(`${model}/${type} selects WallLightCam, keeps actual owner/channel and observed state`, async () => {
    const raw = camera(model, type, { parent_sn: 'T8030_SECOND', params: params('72', '1') });
    await fixture([owner(), owner('T8030_SECOND'), raw], async (t, inventory) => {
      const sdk = t.cameras.get(raw.device_sn);
      assert.equal(sdk?.constructor, WallLightCam);
      assert.equal(sdk.getStationSerial(), 'T8030_SECOND');
      assert.equal(sdk.getChannel(), 2);
      assert.deepEqual(t.device(raw.device_sn), inventory.result.devices.at(-1));
      assert.equal(t.device(raw.device_sn).battery, model === 'T81A0' ? 72 : null);
      // Pinned Wall-light metadata has no DeviceState mapping. Never infer one.
      assert.equal(t.device(raw.device_sn).availability, null);
      assert.equal(t.device(raw.device_sn).firmware, '1.2.3');
      assert.equal(t.supportsEvent(raw.device_sn, 'motion'), true);
      assert.equal(t.supportsEvent(raw.device_sn, 'person'), true);
      assert.equal(t.supportsEvent(raw.device_sn, 'ring'), false);
      assert.equal(t.supportsEvent(raw.device_sn, 'unknown_feature'), false);
      const detections = [];
      t.on('detection', (event) => detections.push(event.type));
      sdk.emit('rings', sdk, true);
      sdk.emit('motion detected', sdk, false);
      sdk.emit('motion detected', sdk, true);
      sdk.emit('person detected', sdk, true, 'Synthetic person');
      assert.deepEqual(detections, ['motion', 'person']);
      if (model === 'T81A0') {
        assert.equal(t.cameraCapabilities(raw.device_sn).live.available, true);
        t.raw.get('T8030_SECOND').main_sw_version = undefined;
      }
      assert.equal(t.cameraCapabilities(raw.device_sn).live.reason, 'camera_media_unverified');
      await assert.rejects(t.startLive(raw.device_sn), { code: 'camera_media_unverified' });
      await assert.rejects(t.snapshot(raw.device_sn), { code: 'camera_media_unverified' });
    });
  });

  test(`${model}/${type} correlates device and push detections, rejects wrong owners and rings`, async () => {
    const raw = camera(model, type);
    await fixture([owner(), owner('T8030_WRONG'), raw], async (t) => {
      const received = [];
      const events = new EventTransport(
        {},
        (id) => t.supportsEvent(id, 'notification'),
        (message) => t.processPush(message),
        (message) => t.acceptPush(message),
      );
      t.on('detection', (d) => events.device(d.id, d.type, d.name, d.stranger));
      events.on('event', (event) => received.push(event));
      const message = {
        device_sn: raw.device_sn,
        station_sn: raw.parent_sn,
        event_type: 3102,
        event_time: Date.now(),
        unique_id: 'one',
        type,
        person_name: 'Synthetic person',
      };
      try {
        events.push({ ...message, station_sn: 'T8030_WRONG' });
        events.push({ ...message, event_type: 3103 });
        assert.equal(t.cameras.get(raw.device_sn).isPersonDetected(), false);
        // Local detection, native Wall-light payload, HB3 companion and replay.
        t.cameras.get(raw.device_sn).emit('motion detected', t.cameras.get(raw.device_sn), true);
        events.push(message);
        assert.equal(t.cameras.get(raw.device_sn).isPersonDetected(), true);
        events.push({ ...message, type: 18, msg_type: 18 });
        t.cameras.get(raw.device_sn).emit('person detected', t.cameras.get(raw.device_sn), true);
        await delay(550);
        assert.equal(received.length, 1);
        assert.equal(received[0].type, 'person');
        assert.equal(received[0].personName, 'Synthetic person');
        events.push(message);
        await delay(550);
        assert.equal(received.length, 1);
        assert.ok(events.status.duplicates >= 2);
      } finally {
        await events.close();
      }
    });
  });

  test(`${model}/${type} standalone descriptors never create a station or enable operations`, async () => {
    for (const parent of ['', model + '_FIXTURE']) {
      const raw = camera(model, type, { parent_sn: parent });
      await fixture([raw, owner(), camera('T8160', 19)], async (t, inventory) => {
        assert.deepEqual(inventory.result.relationships[0], {
          deviceId: raw.device_sn,
          kind: 'standalone',
          ownerId: raw.device_sn,
          reason: 'standalone_transport_unverified',
        });
        assert.equal(inventory.result.devices[0].kind, 'camera');
        assert.equal(t.stations.has(raw.device_sn), false);
        assert.equal(t.cameras.has(raw.device_sn), false);
        assert.equal(t.supportsEvent(raw.device_sn, 'motion'), false);
        for (const operation of [
          () => t.connect(raw.device_sn),
          () => t.startLive(raw.device_sn),
          () => t.snapshot(raw.device_sn),
        ])
          await assert.rejects(operation(), { code: 'standalone_transport_unverified' });
        assert.ok(t.cameras.has('T8160_FIXTURE'));
      });
    }
  });
}

test('Wall-light state retains unknowns, accepts observed zero and follows owner/channel changes', async () => {
  for (const value of [undefined, null, '', '12bad', ' ', true, -1, 101, Infinity]) {
    const raw = camera('T81A0', 10005, { params: params(value, value), main_sw_version: '' });
    await fixture([owner(), raw], async (t, inventory) => {
      const state = t.device(raw.device_sn);
      assert.equal(state.battery, null);
      assert.equal(state.availability, null);
      assert.equal(state.firmware, null);
      assert.deepEqual(state, inventory.result.devices.at(-1));
    });
  }
  const raw = camera('T81A0', 10005, { params: params('0', '0') });
  await fixture([owner(), owner('T8030_SECOND'), raw], async (t) => {
    const sdk = t.cameras.get(raw.device_sn);
    assert.equal(t.device(raw.device_sn).battery, 0);
    assert.equal(t.device(raw.device_sn).availability, null);
    const station = t.stations.get(raw.parent_sn);
    t.stations.get('T8030_SECOND').emit('runtime state', null, 2, 91);
    station.emit('runtime state', station, 3, 91);
    assert.equal(t.device(raw.device_sn).battery, 0);
    station.emit('runtime state', station, 2, 37);
    station.emit('raw device property changed', raw.device_sn, {
      [CommandType.CMD_GET_DEV_STATUS]: { value: '2', source: 'p2p' },
    });
    assert.equal(t.device(raw.device_sn).battery, 37);
    assert.equal(t.device(raw.device_sn).availability, null);
    const next = discover([
      owner(),
      owner('T8030_SECOND'),
      { ...raw, parent_sn: 'T8030_SECOND', params: [] },
    ]);
    await t.load(next.raw, next);
    assert.notEqual(t.cameras.get(raw.device_sn), sdk);
    assert.equal(sdk.eventNames().length, 0);
    assert.equal(t.device(raw.device_sn).battery, null);
    assert.equal(t.device(raw.device_sn).availability, null);
  });
});

test('unsupported Wall-light variants, owners and initialization failures preserve other families', async () => {
  await fixture(
    [
      owner(),
      camera('T84A1V', 151),
      camera('T81A0', 151, { device_sn: 'MISMATCH_FIXTURE' }),
      camera('T84A1', 151, { parent_sn: 'OLD_OWNER' }),
      camera('T81A0', 10005, { params: {} }),
      camera('T8172', 89),
      camera('T8213', 91),
    ],
    async (t, inventory) => {
      assert.deepEqual(
        inventory.result.issues.map((i) => i.code),
        ['unsupported_device', 'unsupported_device', 'unsupported_station'],
      );
      assert.throws(() => t.device('T81A0_FIXTURE'), { code: 'device_initialization_failed' });
      assert.throws(() => t.device('T84A1_FIXTURE'), { code: 'unsupported_station' });
      assert.equal(t.cameras.get('T8172_FIXTURE').constructor, Camera);
      assert.equal(t.cameras.get('T8213_FIXTURE').constructor, BatteryDoorbellCamera);
    },
  );
});

test('public Wall-light inventory and observed-state API preserve existing identities', async () => {
  const rows = [
    owner(),
    ...models.map(([model, type], index) =>
      camera(model, type, { device_channel: index, params: params('64', '1') }),
    ),
  ];
  const cloud = cloudFixture({ inventory: rows });
  const client = new EufyMegaClient(cloud.options);
  try {
    await client.connect();
    const discovery = await client.discoverDevices();
    assert.deepEqual(discovery.issues, []);
    const listed = await client.listDevices();
    assert.equal(listed.length, 3);
    for (const [model] of models) {
      const state = await client.getDeviceState(model + '_FIXTURE');
      assert.deepEqual(
        state,
        listed.find((d) => d.id === model + '_FIXTURE'),
      );
      assert.equal(state.stationId, 'T8030_OWNER');
      assert.equal(state.battery, model === 'T81A0' ? 64 : null);
    }
  } finally {
    await client.shutdown();
  }
});
