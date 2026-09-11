import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { PassThrough } from 'node:stream';
import { Station, CommandName } from '../dist/vendor/http/index.js';
import { CommandType, VideoCodec } from '../dist/vendor/p2p/types.js';
import { mediaFixture } from './fixtures/media.mjs';
import { eufycamMedia } from './fixtures/eufycam-media.mjs';
import { batteryDoorbellMedia } from './fixtures/battery-doorbell-media.mjs';
import { solocamMedia } from './fixtures/solocam-media.mjs';
import { walllightMedia } from './fixtures/walllight-media.mjs';
import { floodlightMedia } from './fixtures/floodlight-media.mjs';
import { integratedMedia } from './fixtures/integrated-media.mjs';
const profiles = [
  ...eufycamMedia,
  ...batteryDoorbellMedia,
  ...solocamMedia,
  ...walllightMedia,
  ...floodlightMedia,
  ...integratedMedia,
];
const newlyAdmittedSolo = solocamMedia.filter((p) => p.model !== 'T8134');

const jpeg = Buffer.from([255, 216, 255, 0, 255, 217]);
const day = '2026-09-11';
const metadata = {
  videoCodec: 0,
  audioCodec: 1,
  videoFPS: 15,
  videoWidth: 1920,
  videoHeight: 1080,
};

test('T8134 keeps its existing media admission without a new owner firmware restriction', async () => {
  const profile = solocamMedia.find((p) => p.model === 'T8134');
  for (const firmware of [undefined, 'unknown', '2.0.9.6']) {
    const f = await mediaFixture({ ...profile, owner: { ...profile.owner, firmware } });
    try {
      for (const feature of Object.values(f.transport.cameraCapabilities(f.camera.device_sn)))
        assert.deepEqual(feature, { available: true, status: 'experimental', reason: null });
      const opening = f.transport.startLive(f.camera.device_sn);
      await turn();
      f.startEvent();
      const live = await opening;
      const stop = live.stop();
      f.ack();
      assert.deepEqual(await stop, { confirmed: true, reason: 'device' });
    } finally {
      await f.close();
    }
  }
});

function records(f) {
  const row = {
    record_id: 1,
    device_sn: f.camera.device_sn,
    station_sn: f.camera.parent_sn,
    storage_path: '/synthetic/video',
    thumb_path: '/synthetic/image',
    folder_size: 5,
    start_time: new Date(day + 'T12:00:00'),
    end_time: new Date(day + 'T12:00:10'),
  };
  f.station.databaseQueryByDate = (_ids, _start, _end, _event, _detect, _storage, limit) => {
    assert.equal(limit, 100);
    f.station.emit('database query by date', f.station, 0, [row]);
  };
  f.station.databaseCountByDate = () =>
    f.station.emit('database count by date', f.station, 0, [
      { day: new Date(day + 'T12:00:00'), count: 1 },
    ]);
  f.station.downloadImage = (path) =>
    f.station.emit('image download', f.station, path, Buffer.from(jpeg));
  f.station.startDownload = async (camera, path) => {
    assert.equal(camera.getSerial(), f.camera.device_sn);
    assert.equal(path, row.storage_path);
  };
  f.station.cancelDownload = () => {};
  return row;
}
for (const p of profiles) {
  test(`${p.model}: exact vendor H3 command branches and channel ownership`, async () => {
    const f = await mediaFixture(p);
    try {
      const camera = f.transport.cameras.get(f.camera.device_sn),
        sent = [];
      for (const command of [
        CommandName.DeviceStartLivestream,
        CommandName.DeviceStopLivestream,
        CommandName.DeviceStartDownload,
        CommandName.DeviceCancelDownload,
      ])
        assert.equal(camera.hasCommand(command), true);
      const station = Object.create(Station.prototype);
      station.rawStation = {
        station_sn: f.camera.parent_sn,
        device_type: 18,
        main_sw_version: p.owner.firmware,
        member: { admin_user_id: 'synthetic' },
      };
      station.isLiveStreaming = () => false;
      const key = { exportKey: () => ({ n: Buffer.from([0, 171, 205]) }) };
      station.p2pSession = {
        getRSAPrivateKey: () => key,
        getDownloadRSAPrivateKey: () => key,
        sendCommandWithStringPayload: (c) => sent.push(c),
        sendCommandWithInt: (c) => sent.push(c),
      };
      const envelope =
        p.liveEnvelope ?? (['T8172', 'T8214'].includes(p.model) ? 'doorbell' : 'payload');
      for (const codec of [VideoCodec.H264, VideoCodec.H265]) {
        station.startLivestream(camera, codec);
        const command = sent.pop();
        if (envelope === 'int') {
          assert.deepEqual(command, {
            commandType: CommandType.CMD_START_REALTIME_MEDIA,
            value: 2,
            strValue: 'abcd',
            channel: 2,
          });
          continue;
        }
        const payload = JSON.parse(command.value);
        assert.equal(
          command.commandType,
          !['payload', 'smartdrop'].includes(envelope)
            ? CommandType.CMD_DOORBELL_SET_PAYLOAD
            : CommandType.CMD_SET_PAYLOAD,
        );
        assert.equal(command.channel, 2);
        assert.deepEqual(
          payload,
          !['payload', 'smartdrop'].includes(envelope)
            ? {
                commandType: 1000,
                data: {
                  ...(envelope === 'floodlight'
                    ? { account_id: 'synthetic' }
                    : { accountId: 'synthetic' }),
                  ...(envelope === 'doorbell' ? { camera_type: 0, entrytype: 0 } : {}),
                  encryptkey: 'abcd',
                  streamtype: codec,
                },
              }
            : {
                account_id: 'synthetic',
                cmd: CommandType.CMD_START_REALTIME_MEDIA,
                ...(envelope === 'smartdrop' ? { mChannel: 0 } : {}),
                mValue3: CommandType.CMD_START_REALTIME_MEDIA,
                payload: {
                  ClientOS: 'Android',
                  ...(p.model === 'T8600' || envelope === 'smartdrop' ? { camera_type: 0, entrytype: 0 } : {}),
                  key: 'abcd',
                  streamtype: codec === VideoCodec.H264 ? 1 : 2,
                },
              },
        );
      }
      station.stopLivestream(camera, true);
      assert.deepEqual(sent.pop(), {
        commandType: CommandType.CMD_STOP_REALTIME_MEDIA,
        value: 2,
        channel: 2,
      });
      await station.startDownload(camera, '/synthetic/video', 999);
      const download = sent.pop();
      assert.equal(download.commandType, CommandType.CMD_SET_PAYLOAD);
      assert.equal(download.channel, 2);
      assert.deepEqual(JSON.parse(download.value), {
        account_id: 'synthetic',
        cmd: CommandType.CMD_DOWNLOAD_VIDEO,
        mChannel: 2,
        mValue3: CommandType.CMD_DOWNLOAD_VIDEO,
        payload: { filepath: '/synthetic/video', key: 'ABCD' },
      });
      station.cancelDownload(camera);
      assert.deepEqual(sent.pop(), {
        commandType: CommandType.CMD_DOWNLOAD_CANCEL,
        value: 2,
        channel: 2,
        strValueSub: 'synthetic',
      });
      station.databaseQueryLatestInfo();
      assert.equal(
        JSON.parse(sent.pop().value).payload.cmd,
        CommandType.CMD_DATABASE_QUERY_LATEST_INFO,
      );
      station.downloadImage('/synthetic/image');
      assert.equal(JSON.parse(sent.pop().value).cmd, CommandType.CMD_DATABASE_IMAGE);
      station.databaseQueryByDate([], new Date(day), new Date(day), 0, 0, 0, 500);
      const query = JSON.parse(sent.pop().value);
      assert.equal(query.payload.cmd, CommandType.CMD_DATABASE_QUERY_BY_DATE);
      assert.equal(query.payload.payload.count, 500);
      station.databaseCountByDate(new Date(day), new Date(day));
      assert.equal(
        JSON.parse(sent.pop().value).payload.cmd,
        CommandType.CMD_DATABASE_COUNT_BY_DATE,
      );
      station.rawStation.station_sn = 'T8030_WRONG';
      assert.throws(() => station.startLivestream(camera));
      await assert.rejects(station.startDownload(camera, '/synthetic/video'));
      assert.equal(sent.length, 0);
    } finally {
      await f.close();
    }
  });
  test(`${p.model}: stored snapshot, independent video/audio bytes and confirmed stop`, async () => {
    const f = await mediaFixture(p);
    try {
      records(f);
      f.station.databaseQueryLatestInfo = () =>
        f.station.emit('database query latest', f.station, 0, [
          { device_sn: f.camera.device_sn, crop_local_path: '/synthetic/image' },
        ]);
      const image = await f.transport.snapshot(f.camera.device_sn);
      assert.deepEqual(image.data, jpeg);
      assert.equal(f.counts.starts, 0);
      const opening = f.transport.startLive(f.camera.device_sn);
      await turn();
      const source = f.startEvent(),
        live = await opening;
      const video = [],
        audio = [];
      live.video.on('data', (b) => video.push(b));
      live.audio.on('data', (b) => audio.push(b));
      source.video.push(Buffer.from('synthetic-video'));
      source.audio.push(Buffer.from('synthetic-audio'));
      await turn();
      assert.equal(Buffer.concat(video).toString(), 'synthetic-video');
      assert.equal(Buffer.concat(audio).toString(), 'synthetic-audio');
      assert.equal(live.metadata.audioCodec, 'aac');
      const stop = live.stop();
      f.ack();
      assert.deepEqual(await stop, { confirmed: true, reason: 'device' });
      assert.equal(f.transport.lives.size, 0);
      assert.equal(source.video.listenerCount('error'), 0);
    } finally {
      await f.close();
    }
  });
  test(`${p.model}: calendar, complete history, thumbnail and acknowledged recording completion`, async () => {
    const f = await mediaFixture(p);
    try {
      records(f);
      assert.deepEqual(await f.transport.recordings.calendar(f.camera.parent_sn, '2026-09'), [day]);
      const listed = await f.transport.recordings.list(f.camera.parent_sn, day, [
        f.camera.device_sn,
      ]);
      assert.equal(listed.complete, true);
      assert.equal(listed.recordings.length, 1);
      const id = listed.recordings[0].id;
      assert.deepEqual(await f.transport.recordings.thumbnail(id), jpeg);
      const opening = f.transport.recordings.download(id);
      await turn();
      const video = new PassThrough(),
        audio = new PassThrough();
      f.station.emit('download start', f.station, 2, metadata, video, audio);
      const transfer = await opening,
        v = [],
        a = [];
      transfer.video.on('data', (b) => v.push(b));
      transfer.audio.on('data', (b) => a.push(b));
      video.end(Buffer.from('video'));
      audio.end(Buffer.from('audio'));
      f.station.emit('download finish', f.station, 2);
      await turn();
      assert.equal(f.transport.recordings.active, true, 'EOF does not release ownership');
      await assert.rejects(f.transport.startLive(f.camera.device_sn), { code: 'station_busy' });
      f.station.emit('download complete', f.station, 3);
      assert.equal(f.transport.recordings.active, true);
      f.station.emit('download complete', f.station, 2);
      assert.deepEqual(await transfer.completed, { complete: true, bytes: 10 });
      await turn();
      assert.equal(Buffer.concat(v).toString(), 'video');
      assert.equal(Buffer.concat(a).toString(), 'audio');
      assert.equal(f.transport.recordings.active, false);
      assert.equal(f.station.listenerCount('download complete'), 0);
    } finally {
      await f.close();
    }
  });
  test(`${p.model}: recording cancellation waits for the matching device acknowledgement`, async () => {
    const f = await mediaFixture(p);
    try {
      records(f);
      const { recordings: clips } = await f.transport.recordings.list(f.camera.parent_sn, day);
      const opening = f.transport.recordings.download(clips[0].id);
      await turn();
      f.station.emit(
        'download start',
        f.station,
        2,
        metadata,
        new PassThrough(),
        new PassThrough(),
      );
      const transfer = await opening,
        stop = transfer.cancel();
      f.station.emit('download finish', f.station, 2);
      f.station.emit('command result', f.station, {
        command_type: CommandType.CMD_DOWNLOAD_CANCEL,
        channel: 3,
        return_code: 0,
      });
      assert.equal(f.transport.recordings.active, true);
      await assert.rejects(f.transport.startLive(f.camera.device_sn), { code: 'station_busy' });
      f.station.emit('command result', f.station, {
        command_type: CommandType.CMD_DOWNLOAD_CANCEL,
        channel: 2,
        return_code: 0,
      });
      assert.deepEqual(await stop, {
        complete: false,
        bytes: 0,
        reason: 'cancelled',
        stopConfirmed: true,
      });
      await turn();
      assert.equal(f.transport.recordings.active, false);
      assert.equal(f.station.listenerCount('download start'), 0);
    } finally {
      await f.close();
    }
  });
}

for (const p of [
  eufycamMedia[0],
  ...batteryDoorbellMedia.slice(1),
  ...newlyAdmittedSolo,
  ...walllightMedia,
  ...floodlightMedia,
  ...integratedMedia,
])
  test(`${p.model}: new media profile rejects unknown tuple, owner and firmware before any command`, async () => {
    for (const change of [
      (f) => (f.transport.raw.get(f.camera.parent_sn).main_sw_version = undefined),
      (f) => (f.transport.raw.get(f.camera.parent_sn).main_sw_version = 'bad'),
      (f) => (f.transport.raw.get(f.camera.parent_sn).main_sw_version = '99999999999999999.0.0.0'),
      (f) => (f.transport.raw.get(f.camera.parent_sn).main_sw_version = '2.0.9.6'),
      (f) => (f.transport.raw.get(f.camera.parent_sn).device_type = 0),
      (f) => (f.transport.raw.get(f.camera.parent_sn).device_model = 'T8010'),
      (f) => (f.transport.raw.get(f.camera.device_sn).device_type = 19),
      (f) => (f.transport.raw.get(f.camera.device_sn).device_model = 'T8142R'),
    ]) {
      const f = await mediaFixture(p);
      try {
        records(f);
        change(f);
        await assert.rejects(f.transport.snapshot(f.camera.device_sn), {
          code: 'camera_media_unverified',
        });
        await assert.rejects(f.transport.startLive(f.camera.device_sn), {
          code: 'camera_media_unverified',
        });
        const { recordings: clips } = await f.transport.recordings.list(f.camera.parent_sn, day);
        await assert.rejects(f.transport.recordings.download(clips[0].id), {
          code: 'camera_media_unverified',
        });
        await assert.rejects(f.transport.recordings.thumbnail(clips[0].id), {
          code: 'camera_media_unverified',
        });
        assert.equal(f.transport.recordings.active, false);
        assert.equal(f.counts.starts, 0);
      } finally {
        await f.close();
      }
    }
  });

test('wrong-channel local stop cannot combine with a correct ACK to finish the live session', async () => {
  const f = await mediaFixture(eufycamMedia[0]);
  try {
    f.station.stopLivestream = () => {};
    const opening = f.transport.startLive(f.camera.device_sn);
    await turn();
    f.startEvent();
    const live = await opening,
      stop = live.stop();
    f.station.emit('livestream stop', f.station, 3);
    f.ack();
    assert.equal(f.transport.lives.size, 1);
    f.station.emit('livestream stop', f.station, 2);
    assert.deepEqual(await stop, { confirmed: true, reason: 'device' });
  } finally {
    await f.close();
  }
});

for (const p of profiles) {
  for (const reason of ['missing', 'rejected']) {
    test(`${p.model}: ${reason} download cancel ACK cannot report successful cleanup`, async (t) => {
      const f = await mediaFixture(p);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        records(f);
        const { recordings: clips } = await f.transport.recordings.list(f.camera.parent_sn, day);
        const opening = f.transport.recordings.download(clips[0].id);
        await turn();
        const video = new PassThrough(),
          audio = new PassThrough();
        const ends = [video.listenerCount('end'), audio.listenerCount('end')];
        f.station.emit('download start', f.station, 2, metadata, video, audio);
        const transfer = await opening,
          cancel = transfer.cancel();
        f.station.emit('download finish', f.station, 2);
        const listeners = video.listenerCount('end');
        f.station.emit('download finish', f.station, 2);
        assert.equal(video.listenerCount('end'), listeners, 'duplicate finish adds no listener');
        if (reason === 'missing') {
          t.mock.timers.tick(4999);
          assert.equal(f.transport.recordings.active, true);
          t.mock.timers.tick(1);
        } else
          f.station.emit('command result', f.station, {
            command_type: CommandType.CMD_DOWNLOAD_CANCEL,
            channel: 2,
            return_code: -1,
          });
        const outcome = await cancel;
        assert.equal(outcome.stopConfirmed, false);
        assert.equal(outcome.complete, false);
        await turn();
        assert.equal(f.transport.recordings.active, false);
        assert.ok(f.counts.closes > 0);
        assert.equal(f.station.listenerCount('download complete'), 0);
        assert.equal(video.listenerCount('data'), 0);
        assert.equal(video.listenerCount('end'), ends[0]);
        assert.equal(audio.listenerCount('end'), ends[1]);
        f.station.emit('command result', f.station, {
          command_type: CommandType.CMD_DOWNLOAD_CANCEL,
          channel: 2,
          return_code: 0,
        });
        assert.equal((await transfer.completed).stopConfirmed, false);
      } finally {
        await f.close();
      }
    });
  }
}

for (const p of [
  eufycamMedia[0],
  ...batteryDoorbellMedia,
  ...solocamMedia,
  ...walllightMedia,
  ...floodlightMedia,
  ...integratedMedia,
])
  test(`${p.model}: one failed HomeBase stream leaves a simultaneous second owner and audio stream intact`, async () => {
    const f = await mediaFixture(p);
    const g = await mediaFixture(
      eufycamMedia.find((p) => p.model === 'T8600'),
      { parent: 'T8030_SECOND' },
    );
    try {
      for (const [id, raw] of g.transport.raw) f.transport.raw.set(id, raw);
      for (const [id, camera] of g.transport.cameras) f.transport.cameras.set(id, camera);
      g.transport.cameras.clear();
      g.transport.stations.clear();
      g.station.removeAllListeners();
      f.transport.stations.set(g.camera.parent_sn, g.station);
      f.transport.encryption.set(g.camera.parent_sn, 'lan-derived');
      f.transport.bind(g.station);
      const first = f.transport.startLive(f.camera.device_sn),
        second = f.transport.startLive(g.camera.device_sn);
      await turn();
      f.startEvent();
      const sources = g.startEvent();
      const a = await first,
        b = await second;
      assert.equal(f.transport.lives.size, 2);
      const stop = a.stop();
      f.ack(-1);
      assert.equal((await stop).confirmed, false);
      assert.equal(f.transport.lives.size, 1);
      assert.equal(g.counts.closes, 0);
      const audio = [];
      b.audio.on('data', (data) => audio.push(data));
      sources.audio.push(Buffer.from('still-active'));
      await turn();
      assert.equal(Buffer.concat(audio).toString(), 'still-active');
      const done = b.stop();
      g.ack();
      assert.equal((await done).confirmed, true);
      assert.equal(f.transport.lives.size, 0);
    } finally {
      await f.close();
      g.station.removeAllListeners();
      await g.close();
    }
  });

for (const p of [
  eufycamMedia[0],
  ...batteryDoorbellMedia.slice(1),
  ...newlyAdmittedSolo,
  ...walllightMedia,
  ...floodlightMedia,
  ...integratedMedia,
])
  test(`${p.model}: the new profile admits the existing additional-H3 firmware boundary`, async () => {
    for (const firmware of ['2.0.9.7', '3.8.6.0']) {
      const f = await mediaFixture({ ...p, owner: { ...p.owner, firmware } });
      try {
        const opening = f.transport.startLive(f.camera.device_sn);
        await turn();
        f.startEvent();
        const live = await opening;
        const stop = live.stop();
        f.ack();
        assert.equal((await stop).confirmed, true);
      } finally {
        await f.close();
      }
    }
  });

// S100 storage compatibility alone is not command-owner evidence.
test('T84A1 stays media-unverified beside the admitted T81A0 profile', async () => {
  const f = await mediaFixture({ ...walllightMedia[0], model: 'T84A1', type: 151 });
  try {
    for (const feature of Object.values(f.transport.cameraCapabilities(f.camera.device_sn)))
      assert.deepEqual(feature, {
        available: false,
        status: 'unsupported',
        reason: 'camera_media_unverified',
      });
    records(f);
    await assert.rejects(f.transport.snapshot(f.camera.device_sn), {
      code: 'camera_media_unverified',
    });
    await assert.rejects(f.transport.startLive(f.camera.device_sn), {
      code: 'camera_media_unverified',
    });
    const { recordings } = await f.transport.recordings.list(f.camera.parent_sn, day);
    await assert.rejects(f.transport.recordings.download(recordings[0].id), {
      code: 'camera_media_unverified',
    });
    await assert.rejects(f.transport.recordings.thumbnail(recordings[0].id), {
      code: 'camera_media_unverified',
    });
    assert.equal(f.counts.starts, 0);
    assert.equal(f.transport.recordings.active, false);
  } finally {
    await f.close();
  }
});
