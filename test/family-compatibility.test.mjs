import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EufyMegaClient } from '../dist/index.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { Station, CommandName } from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
import { families, firmwareProfiles, inventory } from './fixtures/families.mjs';

test('every matrix family has a synthetic representative with an exact catalogue type', async () => {
  const matrix = await readFile(new URL('../docs/MODEL_MATRIX.md', import.meta.url), 'utf8');
  const catalogue = matrix.split('## Catalogue rows')[1].split('## Core features')[0];
  const rows = catalogue
    .split('\n')
    .filter((line) => /^\| \d/.test(line))
    .map((line) => line.split('|').map((s) => s.trim()));
  assert.deepEqual(
    [...new Set(families.map((p) => p.family))].sort(),
    [...new Set(rows.map((r) => r[5]))].sort(),
  );
  for (const p of families) {
    const match = rows.find((r) => Number(r[1]) === p.type);
    assert.ok(match, p.id);
    assert.equal(match[5], p.family);
    if (p.family !== 'unresolved') assert.ok(match[3].includes(p.model), p.id);
    assert.match(p.firmwareEvidence, /synthetic/);
  }
});
for (const p of families) {
  test(`${p.id}: public discovery preserves the matrix admission boundary`, async () => {
    const { camera, rows } = inventory(p);
    const f = cloudFixture({ inventory: rows }),
      client = new EufyMegaClient(f.options);
    try {
      await client.connect();
      const devices = await client.listDevices();
      const result = devices.find((d) => d.id === camera.device_sn);
      if (p.admitted) {
        assert.equal(result.model, p.model);
        assert.equal(result.kind, 'camera');
        assert.equal(result.stationId, camera.parent_sn);
        assert.equal(result.firmware, p.firmware);
        assert.equal(result.battery, null);
      } else {
        if (p.recognized) {
          assert.equal(result.model, p.model);
          assert.equal(result.kind, 'camera');
          assert.equal(result.stationId, camera.device_sn);
        } else assert.equal(result, undefined);
        const code = p.recognized ? 'standalone_transport_unverified' : 'unsupported_device';
        // A separate unsupported-only inventory avoids loading even a synthetic HomeBase.
        const blocked = cloudFixture({ inventory: [camera] });
        const denied = new EufyMegaClient(blocked.options);
        try {
          await denied.connect();
          await denied.listDevices();
          await assert.rejects(denied.startLive(camera.device_sn), { code });
          await assert.rejects(denied.snapshot(camera.device_sn), { code });
          assert.equal(denied.transport.stations.size, 0);
          assert.equal(denied.transport.lives.size, 0);
          assert.ok(blocked.calls.every((c) => !c.path.includes('command')));
        } finally {
          await denied.close();
        }
      }
    } finally {
      await client.close();
    }
  });
}
for (const p of families.filter((p) => p.command).concat(firmwareProfiles)) {
  test(`${p.id}: isolated vendor command selection, without enabling public support`, async () => {
    const ownerId = p.topology === 'W' ? `${p.model}_SYNTHETIC` : `${p.owner.model}_SYNTHETIC`;
    const { camera } = inventory(p, { parent: ownerId });
    const transport = new DeviceTransport();
    try {
      await transport.load(new Map([[camera.device_sn, camera]]));
      const device = transport.cameras.get(camera.device_sn);
      assert.equal(device.getDeviceType(), p.type);
      assert.equal(device.getSoftwareVersion(), p.firmware);
      const station = Object.create(Station.prototype),
        sent = [];
      station.rawStation = {
        station_sn: ownerId,
        device_type: p.topology === 'W' ? p.type : p.owner.type,
        main_sw_version: p.owner.firmware,
        member: { admin_user_id: 'synthetic-account' },
      };
      station.isLiveStreaming = () => false;
      station.p2pSession = {
        getRSAPrivateKey: () => undefined,
        sendCommandWithStringPayload: (value) => sent.push({ method: 'payload', ...value }),
        sendCommandWithInt: (value) => sent.push({ method: 'int', ...value }),
      };
      station.startLivestream(device);
      const expected = {
        payload: CommandType.CMD_SET_PAYLOAD,
        doorbell: CommandType.CMD_DOORBELL_SET_PAYLOAD,
        int: CommandType.CMD_START_REALTIME_MEDIA,
      };
      assert.equal(sent.length, 1);
      assert.equal(sent[0].commandType, expected[p.command]);
      assert.equal(sent[0].channel, camera.device_channel);
      assert.equal(sent[0].method, p.command === 'int' ? 'int' : 'payload');
      if (p.command === 'payload')
        assert.equal(JSON.parse(sent[0].value).cmd, CommandType.CMD_START_REALTIME_MEDIA);
      if (p.command === 'doorbell') assert.equal(JSON.parse(sent[0].value).commandType, 1000);
      const hasCommand = device.hasCommand.bind(device);
      device.hasCommand = (command) =>
        command === CommandName.DeviceStartLivestream ? false : hasCommand(command);
      assert.throws(() => station.startLivestream(device), { name: 'NotSupportedError' });
      assert.equal(sent.length, 1, 'unsupported capability must not issue a command');
      device.hasCommand = hasCommand;
      station.rawStation.station_sn = 'WRONG_OWNER_SYNTHETIC';
      assert.throws(() => station.startLivestream(device), { name: 'WrongStationError' });
      assert.equal(sent.length, 1, 'wrong ownership must not issue a command');
    } finally {
      await transport.close();
    }
  });
}
for (const owner of [
  { topology: 'H1/E/2', model: 'T8010', type: 0 },
  { topology: 'HM', model: 'T8025', type: 28 },
  { topology: 'Chime / bridge', model: 'T8023', type: 25 },
  { topology: 'N', model: 'T8N00', type: 300 },
  { topology: 'Unknown', model: 'T9000', type: 999 },
  { topology: 'W', model: 'T8134', type: 63 },
]) {
  test(`${owner.topology}: a recognized camera cannot inherit H3 admission from another owner`, async () => {
    const p = families.find((p) => p.id === 'solo-h3');
    const { rows } = inventory(p, {
      parent: `${owner.model}_OWNER`,
      owner: { ...owner, firmware: 'synthetic' },
    });
    const f = cloudFixture({ inventory: rows }),
      client = new EufyMegaClient(f.options);
    try {
      await client.connect();
      const result = await client.discoverDevices();
      assert.equal(
        result.issues.find((i) => i.deviceId === 'T8134_SYNTHETIC').code,
        'unsupported_station',
      );
      assert.equal(result.devices.find((d) => d.id === 'T8134_SYNTHETIC').kind, 'camera');
      assert.equal(client.transport, undefined);
    } finally {
      await client.close();
    }
  });
}
