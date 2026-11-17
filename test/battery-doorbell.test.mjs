import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { EventTransport } from '../dist/event-transport.js';
import { BatteryDoorbellCamera, PropertyName, Station } from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { PushNotificationService } from '../dist/vendor/push/service.js';
import { hasCameraMedia } from '../dist/camera-media.js';
import { EufyMegaClient } from '../dist/index.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

// Independently authored tuples from the pinned catalogue and MODEL_MATRIX.md.
// T8224/96 is the reported C30 pair from ha-eufy-cam#40. T8210/7 and T8210C/7 rest
// on the public evidence for ha-eufy-cam#198. T8215/97 is the reported Video Doorbell
// S4 pair from ha-eufy-cam#252.
const models = [
  ['T8213', 91],
  ['T8214', 94],
  ['T8224', 95],
  ['T8223', 96],
  ['T8224', 96],
  ['T8210', 7],
  ['T8210C', 7],
  ['T8215', 97],
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
const doorbell = (model, type, extra = {}) => ({
  category: 'eufy_security',
  device_sn: model + '_FIXTURE',
  parent_sn: 'T8030_OWNER',
  device_model: model,
  device_type: type,
  device_channel: 2,
  device_name: 'Synthetic doorbell',
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
      setKeyWithoutAnswer() {},
      initialize() {},
      update() {},
      dispose: async () => {},
      hasProperty: () => false,
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
  test(`${model}/${type} selects battery doorbell, preserves owner and reads only observations`, async () => {
    const raw = doorbell(model, type, { parent_sn: 'T8030_SECOND', params: params('72', '1') });
    await fixture([owner(), owner('T8030_SECOND'), raw], async (t, inventory) => {
      const sdk = t.cameras.get(raw.device_sn);
      assert.equal(sdk.constructor, BatteryDoorbellCamera);
      assert.equal(sdk.getStationSerial(), 'T8030_SECOND');
      assert.equal(sdk.getChannel(), 2);
      assert.deepEqual(t.device(raw.device_sn), inventory.result.devices.at(-1));
      assert.equal(t.device(raw.device_sn).firmware, '1.2.3');
      assert.equal(t.device(raw.device_sn).battery, 72);
      assert.equal(t.device(raw.device_sn).availability, 'online');
      for (const kind of ['motion', 'person', 'ring'])
        assert.equal(t.supportsEvent(raw.device_sn, kind), true);
      assert.equal(t.supportsEvent(raw.device_sn, 'unknown_feature'), false);
      const received = [];
      t.on('detection', (event) => received.push(event.type));
      sdk.emit('rings', sdk, false);
      sdk.emit('motion detected', sdk, true);
      sdk.emit('person detected', sdk, true, 'Synthetic person');
      sdk.emit('rings', sdk, true);
      assert.deepEqual(received, ['motion', 'person', 'ring']);
      const hasProperty = sdk.hasProperty.bind(sdk);
      sdk.hasProperty = () => false;
      sdk.emit('rings', sdk, true);
      assert.equal(
        t.acceptPush({ device_sn: raw.device_sn, station_sn: raw.parent_sn, event_type: 3103 }),
        false,
      );
      assert.deepEqual(received, ['motion', 'person', 'ring']);
      sdk.hasProperty = hasProperty;
      assert.equal(hasCameraMedia(raw, owner('T8030_SECOND')), true);
      assert.equal(hasCameraMedia(raw), model === 'T8213');
      if (model !== 'T8213') {
        t.raw.get(raw.parent_sn).main_sw_version = '2.0.9.6';
        await assert.rejects(t.startLive(raw.device_sn), { code: 'camera_media_unverified' });
        await assert.rejects(t.snapshot(raw.device_sn), { code: 'camera_media_unverified' });
        assert.throws(() => t.camera(raw.device_sn, 'recordings'), {
          code: 'camera_media_unverified',
        });
      }
    });
  });
  test(`${model}/${type} rejects missing/malformed state and accepts zero and runtime owner/channel`, async () => {
    for (const value of [undefined, null, '', '12bad', ' ', true, -1, 101]) {
      await fixture(
        [owner(), doorbell(model, type, { main_sw_version: '', params: params(value, value) })],
        async (t) => {
          const state = t.device(model + '_FIXTURE');
          assert.equal(state.firmware, null);
          assert.equal(state.battery, null);
          assert.equal(state.availability, null);
        },
      );
    }
    const raw = doorbell(model, type, { params: params('0', '0') });
    await fixture([owner(), owner('T8030_SECOND'), raw], async (t) => {
      assert.equal(t.device(raw.device_sn).battery, 0);
      assert.equal(t.device(raw.device_sn).availability, 'offline');
      const right = t.stations.get('T8030_OWNER'),
        wrong = t.stations.get('T8030_SECOND');
      wrong.emit('runtime state', wrong, 2, 99);
      right.emit('runtime state', right, 3, 99);
      wrong.emit('raw device property changed', raw.device_sn, {
        [CommandType.CMD_GET_DEV_STATUS]: { value: '1', source: 'p2p' },
      });
      assert.equal(t.device(raw.device_sn).battery, 0);
      assert.equal(t.device(raw.device_sn).availability, 'offline');
      right.emit('runtime state', right, 2, 43);
      right.emit('raw device property changed', raw.device_sn, {
        [CommandType.CMD_GET_DEV_STATUS]: { value: '2', source: 'p2p' },
      });
      assert.equal(t.device(raw.device_sn).battery, 43);
      assert.equal(t.device(raw.device_sn).availability, 'disabled');
      const next = discover([
        owner(),
        owner('T8030_SECOND'),
        { ...raw, parent_sn: 'T8030_SECOND', params: [] },
      ]);
      const old = t.cameras.get(raw.device_sn);
      await t.load(next.raw, next);
      assert.notEqual(t.cameras.get(raw.device_sn), old);
      assert.equal(t.device(raw.device_sn).battery, null);
      assert.equal(t.device(raw.device_sn).availability, null);
      assert.equal(old.listenerCount('rings'), 0);
    });
  });
  test(`${model}/${type} preserves cross-transport detection settling, distinct rings and replay filtering`, async () => {
    const raw = doorbell(model, type);
    await fixture([owner(), owner('T8030_SECOND'), raw], async (t) => {
      const events = new EventTransport(
        {},
        (id) => t.supportsEvent(id, 'notification'),
        (message) => t.processPush(message),
        (message) => t.acceptPush(message),
      );
      const received = [];
      events.on('event', (event) => received.push(event));
      t.on('detection', (d) => events.device(d.id, d.type, d.name, d.stranger));
      const message = {
        device_sn: raw.device_sn,
        station_sn: raw.parent_sn,
        event_type: 3111,
        msg_type: 18,
        event_time: Date.now(),
        unique_id: 'person',
        type: 1,
        person_name: 'Synthetic person',
      };
      try {
        events.push({ ...message, station_sn: 'T8030_SECOND' });
        events.push(message);
        events.push({ ...message, type: 2 });
        events.device(raw.device_sn, 'person', 'Synthetic person');
        events.push({ ...message, event_type: 3103, unique_id: 'ring-one' });
        events.push({ ...message, event_type: 3103, unique_id: 'ring-two' });
        await delay(550);
        assert.deepEqual(
          received.map((e) => e.type),
          ['person', 'ring', 'ring'],
        );
        assert.equal(received[0].personName, 'Synthetic person');
        events.push(message);
        events.push({ ...message, event_type: 3103, unique_id: 'ring-one' });
        await delay(550);
        assert.equal(received.length, 3);
      } finally {
        await events.close();
      }
    });
  });
}
test('unknown candidate pairs, wrong types, unavailable owners and broken initialization isolate failures', async () => {
  const candidates = [
    ['T8210', 16],
    ['T8212', 7],
    ['T8220', 16],
    ['T8221', 16],
    ['T8222', 16],
    ['T8214R', 94],
    ['T8223', 95],
  ];
  const rows = [
    owner(),
    ...candidates.map(([m, t]) => doorbell(m, t)),
    doorbell('T8214', 94, { parent_sn: 'OLDER_OWNER' }),
    doorbell('T8224', 95, { params: {} }),
    doorbell('T8160', 19),
    doorbell('T8213', 91),
  ];
  await fixture(rows, async (t, inventory) => {
    assert.equal(
      inventory.result.issues.filter((i) => i.code === 'unsupported_device').length,
      candidates.length,
    );
    assert.throws(() => t.device('T8214_FIXTURE'), { code: 'unsupported_station' });
    assert.throws(() => t.device('T8224_FIXTURE'), { code: 'device_initialization_failed' });
    assert.equal(t.supportsEvent('T8224_FIXTURE', 'ring'), false);
    for (const id of ['T8160_FIXTURE', 'T8213_FIXTURE']) assert.ok(t.cameras.has(id));
  });
});
test('public doorbell identity and observations agree across discovery and lazy state access', async () => {
  const cloud = cloudFixture({
    inventory: [
      owner(),
      ...models.map(([m, t]) =>
        doorbell(m, t, { device_sn: `${m}_${t}_FIXTURE`, params: params('61', '1') }),
      ),
    ],
  });
  const client = new EufyMegaClient(cloud.options);
  try {
    await client.connect();
    const listed = await client.listDevices();
    for (const [model, type] of models) {
      const state = await client.getDeviceState(`${model}_${type}_FIXTURE`);
      assert.deepEqual(
        state,
        listed.find((d) => d.id === state.id),
      );
      assert.equal(state.battery, 61);
      assert.equal(state.stationId, 'T8030_OWNER');
    }
  } finally {
    await client.close();
  }
});

// ha-eufy-cam#252: type 97 joins Device.isCamera() in 0.30.4, so a push that a HomeBase 3
// relays for it is read by the HomeBase branch, like the C31 type 96.
const relayed = (type, a) => ({
  payload: {
    type: String(type),
    station_sn: 'T8030_OWNER',
    device_sn: 'DOORBELL_FIXTURE',
    event_time: '1762804800',
    push_time: '1762804800',
    title: 'Synthetic',
    content: 'Synthetic',
    payload: {
      a,
      channel: 2,
      msg_type: 18,
      nick_name: 'Synthetic person',
      session_id: 'session',
      pic_url: '',
      file_path: '/synthetic/path',
      name: 'Synthetic doorbell',
      unique_id: 'one',
      storage_type: 1,
    },
  },
});
test('T8215/97 pushes relayed by a HomeBase 3 normalize like the C31 type 96', () => {
  const service = Object.create(PushNotificationService.prototype);
  const fields = (message) => {
    const { type, ...rest } = message;
    return rest;
  };
  for (const a of [3101, 3102, 3103]) {
    const s4 = service._normalizePushMessage(relayed(97, a));
    assert.equal(s4.type, 97);
    assert.equal(s4.event_type, a);
    assert.equal(s4.msg_type, 18);
    assert.equal(s4.channel, 2);
    assert.equal(s4.person_name, 'Synthetic person');
    assert.equal(s4.file_path, '/synthetic/path');
    assert.deepEqual(fields(s4), fields(service._normalizePushMessage(relayed(96, a))));
  }
  // A type outside Device.isCamera() takes the generic branch, which reads it differently.
  assert.notDeepEqual(
    fields(service._normalizePushMessage(relayed(92, 3103))),
    fields(service._normalizePushMessage(relayed(96, 3103))),
  );
});
// One push relayed by a HomeBase 3, read through the device and event transports. For a
// ring (3103) a ringing property change comes first.
const relay = async (model, type, a) => {
  const service = Object.create(PushNotificationService.prototype);
  const raw = doorbell(model, type, { device_sn: 'DOORBELL_FIXTURE' });
  const outcome = {};
  await fixture([owner(), raw], async (t) => {
    // Without a command table the event image fallback does nothing, so the camera
    // handler reaches its event case instead of stopping at the missing method.
    t.stations.get('T8030_OWNER').hasCommand = () => false;
    const sdk = t.cameras.get(raw.device_sn);
    outcome.adapter = sdk.constructor;
    const detections = [];
    t.on('detection', (event) => detections.push(event.type));
    if (a === 3103) {
      assert.equal(sdk.updateProperty(PropertyName.DeviceRinging, true), true);
      sdk.updateProperty(PropertyName.DeviceRinging, false);
      outcome.propertyChange = [...detections];
    }
    const events = new EventTransport(
      {},
      (id) => t.supportsEvent(id, 'notification'),
      (message) => t.processPush(message),
      (message) => t.acceptPush(message),
    );
    const received = [];
    events.on('event', (event) => received.push(event));
    t.on('detection', (d) => events.device(d.id, d.type, d.name, d.stranger));
    try {
      const message = service._normalizePushMessage(relayed(type, a));
      outcome.accepted = t.acceptPush(message);
      events.push(message);
      await delay(550);
      outcome.ringing = sdk.isRinging();
      outcome.detections = detections;
      outcome.events = received.map(({ id, receivedAt, ...event }) => event);
    } finally {
      await events.close();
    }
  });
  return outcome;
};
test('T8215/97 rings reach the ring event like T8223/96, from a property change and a relayed push', async () => {
  const s4 = await relay('T8215', 97, 3103);
  assert.equal(s4.adapter, BatteryDoorbellCamera);
  assert.deepEqual(s4.propertyChange, ['ring']);
  assert.equal(s4.accepted, true);
  assert.equal(s4.ringing, true);
  assert.deepEqual(s4.detections, ['ring', 'ring']);
  assert.deepEqual(
    s4.events.map((event) => [event.deviceId, event.type]),
    [['DOORBELL_FIXTURE', 'ring']],
  );
  assert.deepEqual(s4, await relay('T8223', 96, 3103));
});
// The HomeBase 3 push codes include identity (3111) and stranger (3112) person events.
// Type 97 carries both states, so the device emits them like T8223/96 under a T8030.
test('T8215/97 relayed identity and stranger pushes reach the person event like T8223/96', async () => {
  for (const [a, detections] of [
    [3111, ['person']],
    [3112, ['person', 'person']],
  ]) {
    const s4 = await relay('T8215', 97, a);
    assert.equal(s4.accepted, true);
    assert.deepEqual(s4.detections, detections);
    assert.deepEqual(
      s4.events.map((event) => [event.deviceId, event.type]),
      [['DOORBELL_FIXTURE', 'person']],
    );
    assert.deepEqual(s4, await relay('T8223', 96, a));
  }
});
