import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { Camera } from '../dist/vendor/http/index.js';
import { EventTransport } from '../dist/event-transport.js';
import { discover } from '../dist/discovery.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
import { inventory } from './fixtures/families.mjs';
import { mediaFixture } from './fixtures/media.mjs';
import { eufycamMedia } from './fixtures/eufycam-media.mjs';

const profile = eufycamMedia.find((p) => p.model === 'T8110');

test('C35 retains eufyCam identity, H3 detection semantics and event isolation', async () => {
  const f = await mediaFixture(profile),
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
    const sdk = f.transport.cameras.get(f.camera.device_sn);
    assert.equal(sdk.constructor, Camera);
    assert.equal(f.transport.supportsEvent(f.camera.device_sn, 'ring'), false);
    const message = {
      device_sn: f.camera.device_sn,
      station_sn: f.camera.parent_sn,
      type: profile.type,
      msg_type: 18,
      event_type: 3102,
      event_time: Date.now(),
      unique_id: 'synthetic-c35-person',
      person_name: 'Synthetic visitor',
    };
    assert.equal(f.transport.acceptPush({ ...message, station_sn: 'T8030_OTHER' }), false);
    assert.equal(f.transport.acceptPush({ ...message, event_type: 3103 }), false);
    events.push(message);
    assert.equal(sdk.isPersonDetected(), true);
    events.push({ ...message, type: 18 });
    sdk.emit('person detected', sdk, true, 'Synthetic visitor');
    await delay(550);
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'person');
    assert.equal(received[0].personName, 'Synthetic visitor');
    events.push({ ...message, event_type: 3101, unique_id: 'synthetic-c35-motion' });
    assert.equal(sdk.isMotionDetected(), true);
    await delay(550);
    assert.equal(received.at(-1).type, 'motion');
    assert.equal(f.counts.starts, 0);
  } finally {
    await events.close();
    await f.close();
  }
});

test('C35 unsupported owner and model variants never grant media or create a fake HomeBase', async () => {
  for (const parent of ['', 'T8110_SYNTHETIC', 'OLD_OWNER']) {
    const { camera } = inventory(profile, { parent });
    const cloud = cloudFixture({ inventory: [camera] }),
      client = new EufyMegaClient(cloud.options);
    try {
      await client.connect();
      const discovery = await client.discoverDevices();
      const reason =
        parent === 'OLD_OWNER' ? 'unsupported_station' : 'standalone_transport_unverified';
      assert.equal(discovery.devices[0].model, 'T8110');
      assert.equal(discovery.devices[0].kind, 'camera');
      assert.equal(discovery.issues[0].code, reason);
      await assert.rejects(client.startLive(camera.device_sn), { code: reason });
      await assert.rejects(client.snapshot(camera.device_sn), { code: reason });
      assert.equal(client.transport.stations.size, 0);
    } finally {
      await client.shutdown();
    }
  }
  const { camera, rows } = inventory(profile);
  for (const change of [
    { device_model: 'T8110V' },
    { device_model: 'E8110' },
    { device_type: 1 },
  ]) {
    const result = discover([rows[0], { ...camera, ...change }]).result;
    assert.equal(result.devices.length, 1);
    assert.equal(result.issues[0].code, 'unsupported_device');
  }
});
