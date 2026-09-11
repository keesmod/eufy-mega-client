import test from 'node:test';
import assert from 'node:assert/strict';
import { EufyMegaClient } from '../dist/index.js';
import { mediaFixture } from './fixtures/media.mjs';
import { eufycamMedia } from './fixtures/eufycam-media.mjs';
import { batteryDoorbellMedia } from './fixtures/battery-doorbell-media.mjs';
import { indoorMedia } from './fixtures/indoor-media.mjs';
import { solocamMedia } from './fixtures/solocam-media.mjs';
import { walllightMedia } from './fixtures/walllight-media.mjs';
import { floodlightMedia } from './fixtures/floodlight-media.mjs';
import { integratedMedia } from './fixtures/integrated-media.mjs';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
for (const profile of [
  ...eufycamMedia,
  ...batteryDoorbellMedia,
  ...solocamMedia,
  ...walllightMedia,
  ...floodlightMedia,
  ...integratedMedia,
  ...indoorMedia,
]) {
  test(`${profile.model}: capabilities share media admission and do not start commands`, async () => {
    const f = await mediaFixture(profile);
    try {
      const result = f.transport.cameraCapabilities(f.camera.device_sn);
      for (const feature of Object.values(result))
        assert.deepEqual(feature, { available: true, status: 'experimental', reason: null });
      result.live.available = false;
      assert.equal(f.transport.cameraCapabilities(f.camera.device_sn).live.available, true);
      assert.equal(f.counts.starts, 0);
      assert.equal(f.counts.stops, 0);
      f.transport.failures.set(f.camera.parent_sn, 'invalid_connection_credentials');
      assert.equal(
        f.transport.cameraCapabilities(f.camera.device_sn).live.reason,
        'invalid_connection_credentials',
      );
      f.transport.failures.clear();
      if (!['T8142', 'T8160', 'T8213', 'T8134'].includes(profile.model)) {
        f.transport.raw.get(f.camera.parent_sn).main_sw_version = '2.0.9.6';
        assert.equal(
          f.transport.cameraCapabilities(f.camera.device_sn).snapshot.reason,
          'camera_media_unverified',
        );
        await assert.rejects(f.transport.snapshot(f.camera.device_sn), {
          code: 'camera_media_unverified',
        });
      }
    } finally {
      await f.close();
    }
  });
}
test('public capabilities retain standalone reason without creating a connection owner', async () => {
  const fixture = cloudFixture({
    inventory: [
      {
        category: 'eufy_security',
        device_sn: 'SOLO',
        parent_sn: '',
        device_model: 'T8134',
        device_type: 63,
        device_name: 'Solo',
        params: [],
      },
    ],
  });
  const client = new EufyMegaClient(fixture.options);
  try {
    await client.connect();
    await client.listDevices();
    const result = await client.getCameraCapabilities('SOLO');
    for (const feature of Object.values(result))
      assert.deepEqual(feature, {
        available: false,
        status: 'unsupported',
        reason: 'standalone_transport_unverified',
      });
    assert.equal(client.transport.stations.size, 0);
    assert.equal((await client.getCameraCapabilities('MISSING')).live.reason, 'unknown_camera');
  } finally {
    await client.close();
  }
});
