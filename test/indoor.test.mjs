import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { EventTransport } from '../dist/event-transport.js';
import { Camera, IndoorCamera, BatteryDoorbellCamera, Station } from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { PushNotificationService } from '../dist/vendor/push/service.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

// Exact pairs from the pinned MODEL_MATRIX.md. All observations are synthetic.
const models = [
  ['T8400', 30],
  ['T8410', 31],
  // Admitted for ha-eufy-cam#149 from public T8410C type 31 evidence.
  ['T8410C', 31],
  ['T8401', 34],
  ['T8411', 35],
  ['T8441', 45],
  ['T8442', 46],
  ['T8414', 100],
  ['T8416', 104],
  ['T8417', 105],
  ['T817L', 10031],
  // ha-eufy-cam#283: Window Camera E10 under a T8030.
  ['T8404', 314],
];
// ha-eufy-cam#283: the E10 lists human, pet, vehicle and other motion, without sound or crying.
const withoutSound = new Set(['T8404']);
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
  device_name: 'Synthetic Indoor',
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
  test(`${model}/${type} selects IndoorCamera, keeps actual owner/channel and observed state`, async () => {
    const raw = camera(model, type, { parent_sn: 'T8030_SECOND', params: params('72', '1') });
    await fixture([owner(), owner('T8030_SECOND'), raw], async (t, inventory) => {
      const sdk = t.cameras.get(raw.device_sn);
      assert.equal(sdk?.constructor, IndoorCamera);
      assert.equal(sdk.getStationSerial(), 'T8030_SECOND');
      assert.equal(sdk.getChannel(), 2);
      assert.deepEqual(t.device(raw.device_sn), inventory.result.devices.at(-1));
      assert.equal(t.device(raw.device_sn).battery, null);
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
      assert.equal(t.cameraCapabilities(raw.device_sn).live.available, true);
      t.raw.get('T8030_SECOND').main_sw_version = undefined;
      assert.equal(t.cameraCapabilities(raw.device_sn).live.reason, 'camera_media_unverified');
      await assert.rejects(t.startLive(raw.device_sn), { code: 'camera_media_unverified' });
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
        // Local detection, native Indoor payload, HB3 companion and replay.
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

  test(`${model}/${type} native Indoor extra events use the owner-aware property map`, async () => {
    const raw = camera(model, type);
    await fixture([owner(), raw], async (t) => {
      const received = [];
      t.on('detection', (e) => received.push(e.type));
      const sound = !withoutSound.has(model);
      assert.equal(t.supportsEvent(raw.device_sn, 'sound'), sound);
      assert.equal(t.supportsEvent(raw.device_sn, 'pet'), true);
      assert.equal(t.supportsEvent(raw.device_sn, 'crying'), sound);
      assert.equal(t.supportsEvent(raw.device_sn, 'vehicle'), true);
      for (const event_type of [3106, 3105, 3104, 3107])
        t.processPush({ device_sn: raw.device_sn, station_sn: raw.parent_sn, type, event_type });
      assert.deepEqual(received, sound ? ['pet', 'sound', 'crying'] : ['pet']);
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
          descriptor: { did: false, license: false, adminUser: false, lanAddress: false },
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

test('public Indoor inventory and observed-state API preserve existing identities', async () => {
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
    assert.equal(listed.length, models.length + 1);
    for (const [model] of models) {
      const state = await client.getDeviceState(model + '_FIXTURE');
      assert.deepEqual(
        state,
        listed.find((d) => d.id === model + '_FIXTURE'),
      );
      assert.equal(state.stationId, 'T8030_OWNER');
      assert.equal(state.battery, null);
    }
  } finally {
    await client.shutdown();
  }
});

test('Indoor observations retain unknowns and owner changes clear state and listeners', async () => {
  for (const value of [undefined, null, '', '12bad', ' ', true, -1, 101, Infinity]) {
    const raw = camera('T8400', 30, { params: params(value, value), main_sw_version: '' });
    await fixture([owner(), raw], async (t, inventory) => {
      assert.deepEqual(t.device(raw.device_sn), inventory.result.devices.at(-1));
      assert.equal(t.device(raw.device_sn).battery, null);
      assert.equal(t.device(raw.device_sn).availability, null);
      assert.equal(t.device(raw.device_sn).firmware, null);
    });
  }
  const raw = camera('T8400', 30, { params: params('0', '0') });
  await fixture([owner(), owner('T8030_SECOND'), raw], async (t) => {
    const sdk = t.cameras.get(raw.device_sn);
    assert.equal(t.device(raw.device_sn).battery, null, 'mains camera has no battery property');
    assert.equal(t.device(raw.device_sn).availability, null);
    const station = t.stations.get(raw.parent_sn);
    t.stations.get('T8030_SECOND').emit('raw device property changed', raw.device_sn, {
      [CommandType.CMD_GET_DEV_STATUS]: { value: '1', source: 'p2p' },
    });
    assert.equal(t.device(raw.device_sn).availability, null);
    station.emit('runtime state', station, 2, 37);
    assert.equal(t.device(raw.device_sn).battery, null);
    station.emit('raw device property changed', raw.device_sn, {
      [CommandType.CMD_GET_DEV_STATUS]: { value: '2', source: 'p2p' },
    });
    assert.equal(t.device(raw.device_sn).availability, null);
    const next = discover([
      owner(),
      owner('T8030_SECOND'),
      { ...raw, parent_sn: 'T8030_SECOND', params: [] },
    ]);
    await t.load(next.raw, next);
    assert.notEqual(t.cameras.get(raw.device_sn), sdk);
    assert.equal(sdk.eventNames().length, 0);
    assert.equal(t.device(raw.device_sn).availability, null);
  });
});

test('Indoor rejects unresolved aliases, mismatched types and unsupported owners independently', async () => {
  await fixture(
    [
      owner(),
      camera('T8440', 44),
      camera('T8W11C', 10008),
      camera('T8419', 10009),
      camera('T8419N', 10011),
      camera('T8400', 31),
      camera('T8411', 35, { parent_sn: 'OLD_OWNER' }),
      camera('T8414', 100, { params: {} }),
      camera('T8416', 104),
      camera('T8172', 89),
      camera('T8213', 91),
    ],
    async (t, inventory) => {
      assert.deepEqual(
        inventory.result.issues.map((i) => i.code),
        [...Array(5).fill('unsupported_device'), 'unsupported_station'],
      );
      assert.throws(() => t.device('T8414_FIXTURE'), { code: 'device_initialization_failed' });
      assert.throws(() => t.device('T8411_FIXTURE'), { code: 'unsupported_station' });
      assert.equal(t.cameras.get('T8416_FIXTURE').constructor, IndoorCamera);
      assert.equal(t.cameras.get('T8172_FIXTURE').constructor, Camera);
      assert.equal(t.cameras.get('T8213_FIXTURE').constructor, BatteryDoorbellCamera);
    },
  );
});

test('T817L and T8404 pushes relayed by a HomeBase 3 normalize like the other Indoor cameras', () => {
  const service = Object.create(PushNotificationService.prototype);
  const raw = (type) => ({
    payload: {
      type: String(type),
      station_sn: 'T8030_OWNER',
      device_sn: 'CAMERA_FIXTURE',
      event_time: '1759651200',
      push_time: '1759651200',
      title: 'Synthetic',
      content: 'Synthetic',
      payload: {
        a: 3102,
        channel: 2,
        msg_type: 18,
        nick_name: 'Synthetic person',
        session_id: 'session',
        pic_url: '',
        file_path: '/synthetic/path',
        name: 'Synthetic Indoor',
        unique_id: 'one',
        storage_type: 1,
      },
    },
  });
  const fields = (message) => {
    const { type, ...rest } = message;
    return rest;
  };
  for (const type of [10031, 314]) {
    const message = service._normalizePushMessage(raw(type));
    assert.equal(message.type, type);
    assert.equal(message.event_type, 3102);
    assert.equal(message.msg_type, 18);
    assert.equal(message.channel, 2);
    assert.equal(message.person_name, 'Synthetic person');
    assert.equal(message.file_path, '/synthetic/path');
    assert.deepEqual(fields(message), fields(service._normalizePushMessage(raw(104))));
  }
});

// ha-eufy-cam#283: on a HomeBase 3 the E10 delivered no event. A push that names
// the camera as its own station is the unconfirmed candidate shape.
test('a T8404 push that names the camera as its own station keeps its event code', () => {
  const service = Object.create(PushNotificationService.prototype);
  // No HomeBase serial, so the vendored generic camera branch reads the inner payload.
  const message = service._normalizePushMessage({
    payload: {
      type: '314',
      station_sn: 'CAMERA_FIXTURE',
      device_sn: 'CAMERA_FIXTURE',
      event_time: '1759651200',
      push_time: '1759651200',
      payload: {
        event_type: 3102,
        msg_type: 18,
        session_id: 'session',
        unique_id: 'one',
        notification_style: 1,
        name: 'Synthetic Indoor',
      },
    },
  });
  assert.deepEqual(
    [
      message.type,
      message.station_sn,
      message.device_sn,
      message.event_type,
      message.event_session,
      message.unique_id,
    ],
    [314, 'CAMERA_FIXTURE', 'CAMERA_FIXTURE', 3102, 'session', 'one'],
  );
});

test('T8404 pushes that name the camera as its own station reach its HomeBase 3 owner', async () => {
  const e10 = camera('T8404', 314);
  const c31 = camera('T817L', 10031);
  await fixture([owner(), e10, c31], async (t) => {
    const received = [];
    const unrouted = [];
    const events = new EventTransport(
      {},
      (id) => t.supportsEvent(id, 'notification'),
      (message) => t.processPush(message),
      (message, source) => t.filterPush(message, source),
      (message) => t.routePush(message),
      (message, source) => unrouted.push(t.unroutedPush(message, source)),
    );
    events.on('event', (event) => received.push(event));
    const push = (raw, type, extra = {}) => ({
      device_sn: raw.device_sn,
      station_sn: raw.device_sn,
      type,
      event_type: 3102,
      event_time: Date.now(),
      unique_id: raw.device_model,
      ...extra,
    });
    try {
      assert.equal(t.routePush(push(e10, 314)).station_sn, 'T8030_OWNER');
      // Only the exact profile opts in, and a push naming the real owner is unchanged.
      assert.equal(t.routePush(push(c31, 10031)).station_sn, c31.device_sn);
      const owned = push(e10, 314, { station_sn: 'T8030_OWNER' });
      assert.equal(t.routePush(owned), owned);
      events.push(push(e10, 314));
      assert.equal(t.cameras.get(e10.device_sn).isPersonDetected(), true);
      events.push(push(c31, 10031));
      await delay(550);
      assert.deepEqual(
        received.map((event) => [event.deviceId, event.type]),
        [[e10.device_sn, 'person']],
      );
      assert.deepEqual(unrouted, [
        {
          reason: 'owner_mismatch',
          source: 'cloud',
          model: 'T817L',
          station: 'device',
          pushType: 10031,
          eventCode: 3102,
          msgType: null,
        },
      ]);
    } finally {
      await events.close();
    }
  });
});

test('unrouted pushes carry only a reason, the admitted model and push numbers', async () => {
  const e10 = camera('T8404', 314);
  await fixture([owner(), owner('T8030_WRONG'), e10], async (t) => {
    const record = (message, source = 'cloud') => t.unroutedPush(message, source);
    const base = { device_sn: e10.device_sn, station_sn: 'T8030_OWNER', type: 314 };
    assert.deepEqual(record({ device_sn: '', station_sn: '', type: -1 }), {
      reason: 'no_serial',
      source: 'cloud',
      model: null,
      station: 'missing',
      pushType: -1,
      eventCode: null,
      msgType: null,
    });
    assert.deepEqual(
      record({
        device_sn: 'T9999_UNKNOWN',
        station_sn: 'T8030_OWNER',
        type: 999,
        event_type: 3101,
      }),
      {
        reason: 'unknown_device',
        source: 'cloud',
        model: null,
        station: 'station',
        pushType: 999,
        eventCode: 3101,
        msgType: null,
      },
    );
    assert.equal(
      record({ device_sn: 'T9999_UNKNOWN', station_sn: 'T9999_UNKNOWN' }).station,
      'device',
    );
    assert.equal(record({ device_sn: 'T9999_UNKNOWN', station_sn: 'OTHER' }).station, 'unknown');
    // A station push is reported only with a camera detection code.
    assert.equal(record({ device_sn: '', station_sn: 'T8030_OWNER', event_type: 9 }), undefined);
    assert.deepEqual(
      record(
        { device_sn: 'T8030_OWNER', station_sn: 'T8030_OWNER', event_type: 3101, msg_type: 18 },
        'local',
      ),
      {
        reason: 'station_detection',
        source: 'local',
        model: null,
        station: 'device',
        pushType: null,
        eventCode: 3101,
        msgType: 18,
      },
    );
    assert.deepEqual(
      [
        record({ ...base, station_sn: 'T8030_WRONG' }).reason,
        record({ ...base, station_sn: 'T8030_WRONG' }).station,
      ],
      ['owner_mismatch', 'station'],
    );
    assert.deepEqual(record({ ...base, event_type: 3103, msg_type: 18 }), {
      reason: 'unsupported_event',
      source: 'cloud',
      model: 'T8404',
      station: 'owner',
      pushType: 314,
      eventCode: 3103,
      msgType: 18,
    });
    for (const value of [1.5, '314', 100000, -2, NaN])
      assert.equal(record({ ...base, type: value, event_type: value }).pushType, null);
    t.failures.set(e10.device_sn, 'device_initialization_failed');
    assert.equal(record(base).reason, 'camera_unavailable');
    t.failures.delete(e10.device_sn);
    t.failures.set('T8030_OWNER', 'connection_failed');
    assert.equal(record(base).reason, 'camera_unavailable');
  });
});

test('only T8404 detections are routed, and a relayed and a routed copy are one event', async () => {
  const e10 = camera('T8404', 314);
  await fixture([owner(), e10], async (t) => {
    const received = [];
    const unrouted = [];
    const station = t.stations.get('T8030_OWNER');
    const stationPushes = [];
    station.processPushNotification = (message) => stationPushes.push(message.event_type);
    const events = new EventTransport(
      {},
      (id) => t.supportsEvent(id, 'notification'),
      (message) => t.processPush(message),
      (message, source) => t.filterPush(message, source),
      (message) => t.routePush(message),
      (message, source) => unrouted.push(t.unroutedPush(message, source)),
    );
    events.on('event', (event) => received.push([event.deviceId, event.type]));
    const self = {
      device_sn: e10.device_sn,
      station_sn: e10.device_sn,
      type: 314,
      event_time: Date.now(),
    };
    try {
      // The camera's own mode and microSD pushes never reach the HomeBase.
      for (const message of [
        { ...self, event_type: 9, station_guard_mode: 0, station_current_mode: 0 },
        { ...self, msg_type: 2, tfcard_status: 3 },
      ]) {
        assert.equal(t.routePush(message), message);
        events.push(message);
      }
      assert.deepEqual(stationPushes, []);
      assert.deepEqual(
        unrouted.map((record) => [record.reason, record.station, record.eventCode, record.msgType]),
        [
          ['owner_mismatch', 'device', 9, null],
          ['owner_mismatch', 'device', null, 2],
        ],
      );
      // A relayed copy with the event session and a self-named copy with its unique_id.
      events.push({ ...self, station_sn: 'T8030_OWNER', event_type: 3102, event_session: 'S' });
      events.push({ ...self, event_type: 3102, event_session: 'S', unique_id: 'U' });
      await delay(550);
      assert.deepEqual(received, [[e10.device_sn, 'person']]);
      assert.deepEqual(stationPushes, [3102, 3102]);
      assert.equal(unrouted.length, 2);
      // Not routed without a HomeBase the client set up.
      t.stations.delete('T8030_OWNER');
      const detection = { ...self, event_type: 3101 };
      assert.equal(t.routePush(detection), detection);
      t.stations.set('T8030_OWNER', station);
    } finally {
      await events.close();
    }
  });
  // A T8404 that is its own station is not admitted, so nothing is routed.
  const own = camera('T8404', 314, { parent_sn: '' });
  await fixture([owner(), own], async (t) => {
    const detection = {
      device_sn: own.device_sn,
      station_sn: own.device_sn,
      type: 314,
      event_type: 3101,
    };
    assert.equal(t.routePush(detection), detection);
    assert.equal(t.unroutedPush(detection, 'cloud').reason, 'unknown_device');
  });
});
