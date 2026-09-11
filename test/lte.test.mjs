import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { EventTransport } from '../dist/event-transport.js';
import { Camera } from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { inventory } from './fixtures/families.mjs';
import { mediaFixture } from './fixtures/media.mjs';
import { lteMedia } from './fixtures/lte-media.mjs';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

const profile = lteMedia[0];

test('T86P2/111 recognition preserves exact inventory ownership and observed state', () => {
  const { camera, rows } = inventory(profile);
  camera.params = [
    { param_type: CommandType.CMD_GET_BATTERY, param_value: '72' },
    { param_type: CommandType.CMD_GET_DEV_STATUS, param_value: '1' },
  ];
  const found = discover(rows);
  const publicCamera = found.result.devices.find((d) => d.id === camera.device_sn);
  assert.equal(publicCamera.model, 'T86P2');
  assert.equal(publicCamera.battery, 72);
  assert.equal(publicCamera.availability, 'online');
  assert.equal(publicCamera.firmware, profile.firmware);
  assert.deepEqual(found.relationships.get(camera.device_sn), {
    kind: 'station',
    ownerId: camera.parent_sn,
  });
  camera.params = [];
  const unknown = discover(rows).result.devices.find((d) => d.id === camera.device_sn);
  assert.equal(unknown.battery, null);
  assert.equal(unknown.availability, null);
  camera.device_type = 110;
  assert.equal(discover(rows).result.issues[0].code, 'unsupported_device');
});

test('T86P2 H3 reuses Camera and correlates supported events without a new adapter', async () => {
  const f = await mediaFixture(profile);
  const received = [];
  const events = new EventTransport(
    {},
    (id) => f.transport.supportsEvent(id, 'notification'),
    (message) => f.transport.processPush(message),
    (message) => f.transport.acceptPush(message),
  );
  f.station.processPushNotification = () => {};
  f.station.hasCommand = () => false;
  f.transport.on('detection', (d) => events.device(d.id, d.type, d.name, d.stranger));
  events.on('event', (event) => received.push(event));
  try {
    const sdk = f.transport.cameras.get(f.camera.device_sn);
    assert.equal(sdk.constructor, Camera);
    assert.equal(sdk.getStationSerial(), f.camera.parent_sn);
    assert.equal(sdk.getChannel(), 2);
    for (const type of ['motion', 'person', 'vehicle'])
      assert.equal(f.transport.supportsEvent(f.camera.device_sn, type), true);
    assert.equal(f.transport.supportsEvent(f.camera.device_sn, 'ring'), false);
    const message = {
      device_sn: f.camera.device_sn,
      station_sn: f.camera.parent_sn,
      event_type: 3102,
      event_time: Date.now(),
      unique_id: 'lte-h3-synthetic',
      type: 111,
      msg_type: 18,
      person_name: 'Synthetic person',
    };
    events.push({ ...message, station_sn: 'T8030_WRONG' });
    assert.equal(sdk.isPersonDetected(), false);
    events.push({ ...message, event_type: 3103 });
    events.push(message);
    assert.equal(sdk.isPersonDetected(), true);
    sdk.emit('person detected', sdk, true, 'Synthetic person');
    await delay(550);
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'person');
    events.push(message);
    await delay(550);
    assert.equal(received.length, 1);
  } finally {
    await events.close();
    await f.close();
  }
});

test('T86P2 standalone LTE or Wi-Fi descriptor stays visible with explicit blocked capabilities', async () => {
  for (const parent of ['', 'T86P2_FIXTURE']) {
    const { camera } = inventory(profile);
    camera.device_sn = 'T86P2_FIXTURE';
    camera.parent_sn = parent;
    const fixture = cloudFixture({ inventory: [camera] });
    const client = new EufyMegaClient(fixture.options);
    try {
      await client.connect();
      const devices = await client.listDevices();
      assert.equal(devices.length, 1);
      assert.equal(devices[0].model, 'T86P2');
      for (const capability of Object.values(await client.getCameraCapabilities(camera.device_sn)))
        assert.deepEqual(capability, {
          available: false,
          status: 'unsupported',
          reason: 'standalone_transport_unverified',
        });
    } finally {
      await client.close();
    }
  }
});

test('LTE-only T8150 and unresolved regional aliases never become H3 cameras', async () => {
  const { rows } = inventory(profile);
  const extras = ['T8150', 'T8151', 'T8152', 'T8153'].map((model) => ({
    ...rows.find((d) => d.device_model === 'T86P2'),
    device_model: model,
    device_type: 110,
    device_sn: model + '_FIXTURE',
  }));
  const found = discover([...rows, ...extras]);
  assert.equal(found.result.issues.length, extras.length);
  assert.ok(found.result.issues.every((i) => i.code === 'unsupported_device'));
  assert.ok(found.raw.has(rows.find((d) => d.device_model === 'T86P2').device_sn));
  const transport = new DeviceTransport();
  try {
    const standalone = discover(extras.map((d) => ({ ...d, parent_sn: '' })));
    await transport.load(standalone.raw, standalone);
    assert.equal(transport.stations.size, 0);
    assert.equal(transport.cameras.size, 0);
    assert.equal(
      transport.cameraCapabilities(extras[0].device_sn).live.reason,
      'unsupported_device',
    );
  } finally {
    await transport.close();
  }
});
