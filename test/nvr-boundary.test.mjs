// Independent synthetic admission probe for #38. No device or cloud traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EufyMegaClient } from '../dist/index.js';
import { hasCameraMedia } from '../dist/camera-media.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

const owner = {
  category: 'eufy_security',
  device_sn: 'T8N00_SYNTHETIC',
  parent_sn: '',
  device_model: 'T8N00',
  device_type: 300,
  main_sw_version: 'unknown',
  params: [],
};
const camera = {
  category: 'eufy_security',
  device_sn: 'T8E00_SYNTHETIC',
  parent_sn: owner.device_sn,
  device_model: 'T8E00',
  device_type: 301,
  device_channel: 0,
  main_sw_version: 'unknown',
  params: [],
};

for (const channel of [0, 1, 3]) {
  test(`NVR channel ${channel}: catalogue identity does not authorize H3 media`, async () => {
    const candidate = { ...camera, device_channel: channel };
    const fixture = cloudFixture({ inventory: [owner, candidate] });
    const client = new EufyMegaClient(fixture.options);
    try {
      await client.connect();
      const result = await client.discoverDevices();
      assert.deepEqual(result.devices, []);
      assert.deepEqual(
        result.issues.map((issue) => issue.code),
        ['unsupported_device', 'unsupported_device'],
      );
      assert.equal(hasCameraMedia(candidate, owner), false);
      await assert.rejects(client.connectStation(owner.device_sn), { code: 'unsupported_device' });
      await assert.rejects(client.startLive(candidate.device_sn), { code: 'unsupported_device' });
      await assert.rejects(client.snapshot(candidate.device_sn), { code: 'unsupported_device' });
      await assert.rejects(client.listRecordings(owner.device_sn, '2026-09-11'), {
        code: 'unsupported_device',
      });
      assert.equal(client.transport.stations.size, 0);
      assert.equal(client.transport.cameras.size, 0);
      assert.equal(client.transport.lives.size, 0);
      assert.ok(fixture.calls.every((call) => !call.path.includes('command')));
    } finally {
      await client.close();
    }
  });
}

test('PoE camera cannot borrow the H3 media owner profile', () => {
  const h3 = {
    ...owner,
    device_sn: 'T8030_SYNTHETIC',
    device_model: 'T8030',
    device_type: 18,
    main_sw_version: '3.8.6.0',
  };
  assert.equal(hasCameraMedia({ ...camera, parent_sn: h3.device_sn }, h3), false);
});
