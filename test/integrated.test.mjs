import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { EventTransport } from '../dist/event-transport.js';
import {
  DoorbellCamera,
  BatteryDoorbellCamera,
  SmartDrop,
  DeviceProperties,
  PropertyName,
} from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
import { mediaFixture } from './fixtures/media.mjs';
import { inventory } from './fixtures/families.mjs';
import { integratedMedia } from './fixtures/integrated-media.mjs';

for (const p of integratedMedia) {
  test(`${p.model}: camera-only adapter, exact owner/channel and observed state`, async () => {
    const f = await mediaFixture(p);
    try {
      const sdk = f.transport.cameras.get(f.camera.device_sn);
      assert.equal(
        sdk.constructor,
        p.type === 90 ? SmartDrop : p.type === 55 ? DoorbellCamera : BatteryDoorbellCamera,
      );
      assert.equal(sdk.getStationSerial(), f.camera.parent_sn);
      assert.equal(sdk.getChannel(), 2);
      assert.equal(f.transport.device(f.camera.device_sn).battery, null);
      assert.equal(f.transport.device(f.camera.device_sn).availability, null);
      sdk.updateRawProperty(CommandType.CMD_GET_BATTERY, '0', 'p2p');
      sdk.updateRawProperty(CommandType.CMD_GET_DEV_STATUS, '1', 'p2p');
      const state = f.transport.device(f.camera.device_sn);
      assert.equal(state.battery, 0);
      assert.equal(state.availability, p.type === 90 ? null : 'online');
      assert.equal(state.kind, 'camera');
      assert.equal(state.stationId, f.camera.parent_sn);
      assert.equal(f.counts.starts, 0);
      assert.equal(f.transport.supportsEvent(f.camera.device_sn, 'person'), true);
      assert.equal(f.transport.supportsEvent(f.camera.device_sn, 'ring'), p.type !== 90);
      assert.equal(f.transport.supportsEvent(f.camera.device_sn, 'motion'), true);
      for (const type of ['locked', 'open', 'package_delivered', 'tampering', 'unknown'])
        assert.equal(f.transport.supportsEvent(f.camera.device_sn, type), false);
    } finally {
      await f.close();
    }
  });

  test(`${p.model}: native/H3 person events deduplicate and non-camera pushes are ignored`, async () => {
    const f = await mediaFixture(p),
      received = [];
    f.station.processPushNotification = () => {};
    f.station.hasCommand = () => false;
    const events = new EventTransport(
      {},
      (id) => f.transport.supportsEvent(id, 'notification'),
      (message) => f.transport.processPush(message),
      (message) => f.transport.acceptPush(message),
    );
    f.transport.on('detection', (d) => events.device(d.id, d.type, d.name, d.stranger));
    events.on('event', (event) => received.push(event));
    try {
      const message = {
        device_sn: f.camera.device_sn,
        station_sn: f.camera.parent_sn,
        type: p.type,
        event_type: 3102,
        event_time: Date.now(),
        unique_id: 'synthetic-person',
        person_name: 'Synthetic visitor',
      };
      for (const event_type of [6, 7, 10, 11, 20, 257, 260, 264, 513, 769, 99999]) {
        const nonCamera = { ...message, event_type, open: 1, pin: 'PRIVATE_PIN' };
        assert.equal(f.transport.acceptPush(nonCamera), false);
        events.push(nonCamera);
      }
      events.push({ ...message, station_sn: 'T8030_WRONG' });
      events.push(message);
      assert.equal(f.transport.cameras.get(f.camera.device_sn).isPersonDetected(), true);
      events.push({ ...message, type: 18, msg_type: 18 });
      events.push(message);
      await delay(550);
      assert.equal(received.length, 1);
      assert.equal(received[0].type, 'person');
      assert.equal(received[0].personName, 'Synthetic visitor');
      assert.ok(events.status.duplicates >= 2);
      assert.equal(JSON.stringify(received).includes('PRIVATE_PIN'), false);
      const ring = { ...message, event_type: 3103, unique_id: 'synthetic-ring' };
      assert.equal(f.transport.acceptPush(ring), p.type !== 90);
      events.push(ring);
      if (p.type !== 90) {
        assert.equal(f.transport.cameras.get(f.camera.device_sn).isRinging(), true);
        await delay(550);
        assert.equal(received.at(-1).type, 'ring');
      }
      const motion = {
        ...message,
        type: 18,
        msg_type: 18,
        event_type: 3101,
        unique_id: 'synthetic-motion',
      };
      events.push(motion);
      assert.equal(f.transport.cameras.get(f.camera.device_sn).isMotionDetected(), true);
      await delay(550);
      assert.equal(received.at(-1).type, 'motion');
      assert.equal(f.counts.starts, 0);
    } finally {
      await events.close();
      await f.close();
    }
  });

  test(`${p.model}: identity and unknown observations survive unavailable owners`, async () => {
    for (const parent of ['', `${p.model}_SYNTHETIC`, 'UNVERIFIED_BRIDGE']) {
      const { camera } = inventory(p, { parent });
      for (const value of ['', 'bad', ' ', true, -1, 101]) {
        camera.params = [{ param_type: CommandType.CMD_GET_BATTERY, param_value: value }];
        const result = discover([camera]).result;
        assert.equal(result.devices[0].id, camera.device_sn);
        assert.equal(result.devices[0].kind, 'camera');
        assert.equal(result.devices[0].battery, null);
        assert.equal(result.devices[0].availability, null);
        assert.equal(
          result.issues[0].code,
          parent === 'UNVERIFIED_BRIDGE'
            ? 'unsupported_station'
            : 'standalone_transport_unverified',
        );
      }
    }
  });
}

test('unproven integrated models stay unadmitted and do not fail a known camera', () => {
  const { rows, camera } = inventory(integratedMedia[0]);
  const unknown = [
    ['T8531', 189],
    ['E85V0', 203],
    ['T8530V', 55],
    ['UNKNOWN_GUN', 101],
    ['UNKNOWN_SNAIL', 102],
  ];
  const result = discover([
    ...rows,
    ...unknown.map(([device_model, device_type]) => ({
      ...camera,
      device_sn: device_model + '_FIXTURE',
      device_model,
      device_type,
    })),
    { ...camera, device_sn: 'MISMATCH_FIXTURE', device_type: 90 },
  ]).result;
  assert.equal(result.devices.length, 2);
  assert.equal(result.issues.length, unknown.length + 1);
  assert.ok(result.issues.every((issue) => issue.code === 'unsupported_device'));
  // The E330 source has no camera detection metadata. Product compatibility cannot supply it.
  for (const name of [
    PropertyName.DeviceMotionDetected,
    PropertyName.DevicePersonDetected,
    PropertyName.DeviceRinging,
  ])
    assert.equal(DeviceProperties[189][name], undefined);
});

test('public integrated camera API exposes no lock, lid or credential controls', async () => {
  const rows = integratedMedia.flatMap((p, index) => {
    const data = inventory(p);
    data.camera.device_channel = index;
    return index === 0 ? data.rows : [data.camera];
  });
  const cloud = cloudFixture({ inventory: rows }),
    client = new EufyMegaClient(cloud.options);
  try {
    await client.connect();
    assert.deepEqual((await client.discoverDevices()).issues, []);
    assert.equal((await client.listDevices()).length, 4);
    for (const p of integratedMedia) {
      const state = await client.getDeviceState(`${p.model}_SYNTHETIC`);
      assert.equal(state.kind, 'camera');
      assert.equal('locked' in state, false);
      assert.equal('pin' in state, false);
      assert.equal('open' in state, false);
    }
    for (const method of ['lock', 'unlock', 'open', 'openSmartDrop', 'addUser', 'setPasscode'])
      assert.equal(typeof client[method], 'undefined');
  } finally {
    await client.shutdown();
  }
});
