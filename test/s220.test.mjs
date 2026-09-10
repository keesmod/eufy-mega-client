import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceTransport } from '../dist/device-transport.js';
import { Station, CommandName } from '../dist/vendor/http/index.js';
import { CommandType } from '../dist/vendor/p2p/types.js';

for (const [model, type, command] of [
  ['T8142', 15, CommandType.CMD_SET_PAYLOAD],
  ['T8134', 63, CommandType.CMD_DOORBELL_SET_PAYLOAD],
]) {
  test(`${model} uses its existing protocol camera capabilities and livestream command`, async () => {
    const transport = new DeviceTransport();
    const id = `${model}FIXTURE`;
    try {
      // Exercise the adapter's actual camera factory without opening a station connection.
      await transport.load(
        new Map([
          [
            id,
            {
              device_sn: id,
              parent_sn: 'T8030FIXTURE',
              device_model: model,
              device_type: type,
              device_name: 'S220',
              device_channel: 2,
              main_sw_version: '1.0.0',
              params: [],
            },
          ],
        ]),
      );
      const camera = transport.cameras.get(id);
      assert.ok(camera.hasCommand(CommandName.DeviceStartLivestream));
      assert.ok(camera.hasCommand(CommandName.DeviceStopLivestream));
      assert.equal(camera.getStationSerial(), 'T8030FIXTURE');
      assert.equal(transport.device(id).kind, 'camera');
      const sent = [];
      const station = Object.create(Station.prototype);
      station.rawStation = {
        station_sn: 'T8030FIXTURE',
        device_type: 18,
        main_sw_version: '3.8.6.0',
        member: { admin_user_id: 'fixture' },
      };
      station.isLiveStreaming = () => false;
      station.getSoftwareVersion = () => '3.8.6.0';
      station.p2pSession = {
        getRSAPrivateKey: () => undefined,
        sendCommandWithStringPayload: (value) => sent.push(value),
      };
      station.startLivestream(camera);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].commandType, command);
      assert.equal(sent[0].channel, camera.getChannel());
    } finally {
      await transport.close();
    }
  });
}
