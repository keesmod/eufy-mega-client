import test from 'node:test';
import assert from 'node:assert/strict';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

// Pinned catalogue pairs. Synthetic inventory is not a physical connection test.
const models = [
  ['T8200', 5],
  ['T8201', 5],
  ['T8202', 5],
  ['T8203', 93],
];
const camera = (model, type, extra = {}) => ({
  category: 'eufy_security',
  device_sn: model + '_SYNTHETIC',
  parent_sn: '',
  device_model: model,
  device_type: type,
  device_channel: 0,
  device_name: 'Synthetic wired doorbell',
  main_sw_version: '1.2.3.4',
  params: [],
  ...extra,
});
const owner = {
  category: 'eufy_security',
  device_sn: 'T8030_SYNTHETIC',
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  params: [],
};
for (const [model, type] of models) {
  test(`${model}/${type} preserves standalone identity without creating a HomeBase`, async () => {
    for (const parent of ['', model + '_SYNTHETIC']) {
      const raw = camera(model, type, { parent_sn: parent });
      const inventory = discover([raw]);
      assert.equal(inventory.result.devices[0].kind, 'camera');
      assert.equal(inventory.result.devices[0].stationId, raw.device_sn);
      assert.equal(inventory.owners.get(raw.device_sn).kind, 'standalone');
      assert.deepEqual(inventory.result.relationships[0], {
        deviceId: raw.device_sn,
        kind: 'standalone',
        ownerId: raw.device_sn,
        reason: 'standalone_transport_unverified',
      });
      const cloud = cloudFixture({ inventory: [raw] });
      const client = new EufyMegaClient(cloud.options);
      try {
        await client.connect();
        assert.deepEqual(await client.listDevices(), inventory.result.devices);
        const caps = await client.getCameraCapabilities(raw.device_sn);
        for (const feature of Object.values(caps)) {
          assert.deepEqual(feature, {
            available: false,
            status: 'unsupported',
            reason: 'standalone_transport_unverified',
          });
        }
        for (const operation of [
          () => client.getDeviceState(raw.device_sn),
          () => client.snapshot(raw.device_sn),
          () => client.startLive(raw.device_sn),
          () => client.connectStation(raw.device_sn),
          () => client.listRecordings(raw.device_sn, '2026-09-11'),
        ])
          await assert.rejects(operation(), { code: 'standalone_transport_unverified' });
        assert.equal(client.transport.stations.size, 0);
        assert.equal(client.transport.cameras.size, 0);
        assert.equal(client.transport.supportsEvent(raw.device_sn, 'ring'), false);
        assert.ok(cloud.calls.every((call) => !call.path.includes('command')));
      } finally {
        await client.close();
      }
    }
  });
  test(`${model}/${type} rejects H3 and foreign owners without removing valid siblings`, async () => {
    for (const parent of ['T8030_SYNTHETIC', 'T8010_UNKNOWN', 'T8200_OTHER']) {
      const raw = camera(model, type, { parent_sn: parent });
      const sibling = camera('T8160', 19, { parent_sn: owner.device_sn });
      const inventory = discover([owner, sibling, raw]);
      assert.deepEqual(inventory.result.relationships.at(-1), {
        deviceId: raw.device_sn,
        kind: 'unsupported',
        reason: 'unsupported_station',
      });
      assert.equal(inventory.relationships.get(sibling.device_sn).ownerId, owner.device_sn);
      assert.equal(inventory.result.devices.length, 3);
      assert.deepEqual(
        inventory.result.issues.map(({ context, ...issue }) => issue),
        [{ index: 2, deviceId: raw.device_sn, code: 'unsupported_station' }],
      );
      assert.equal(
        inventory.result.issues[0].context.parentStatus,
        parent === owner.device_sn ? 'present' : 'missing',
      );
      // The inventory issue must block admission even when a recognized H3 is present.
      const transport = new DeviceTransport();
      try {
        await transport.load(new Map([[raw.device_sn, raw]]), inventory);
        assert.equal(transport.cameras.size, 0);
        assert.equal(transport.stations.size, 0);
        assert.equal(
          transport.cameraCapabilities(raw.device_sn).live.reason,
          'unsupported_station',
        );
      } finally {
        await transport.close();
      }
    }
  });
  test(`${model}/${type} preserves observed inventory values and rejects mismatched catalogue types`, () => {
    const row = camera(model, type, {
      params: [
        { param_type: CommandType.CMD_GET_BATTERY, param_value: '75' },
        { param_type: CommandType.CMD_GET_DEV_STATUS, param_value: '1' },
      ],
    });
    const state = discover([row]).result.devices[0];
    assert.equal(state.firmware, '1.2.3.4');
    assert.equal(state.battery, null, 'wired devices have no battery property');
    assert.equal(state.availability, type === 93 ? 'online' : null);
    // Type 5 has no numeric DeviceState parameter in the pinned metadata.
    for (const value of [undefined, '', '1bad', true, -1, 6]) {
      const unknown = discover([
        {
          ...row,
          main_sw_version: '',
          params: [{ param_type: CommandType.CMD_GET_DEV_STATUS, param_value: value }],
        },
      ]).result.devices[0];
      assert.equal(unknown.availability, null);
      assert.equal(unknown.firmware, null);
    }
    for (const wrong of [type === 5 ? 93 : 5, 94, 999]) {
      const rejected = discover([camera(model, wrong)]).result;
      assert.deepEqual(rejected.devices, []);
      assert.equal(rejected.issues[0].code, 'unsupported_device');
    }
  });
}
