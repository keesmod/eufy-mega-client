import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { completeHistory, calendarDate } from '../dist/recordings.js';
import { downloadRecording } from '../dist/download.js';

test('days exceeding 100 records are widened without losing any prefix records', async () => {
  const rows = Array.from({ length: 371 }, (_, record_id) => ({ record_id })),
    limits = [];
  const result = await completeHistory(async (limit) => {
    limits.push(limit);
    return rows.slice(0, limit);
  });
  assert.equal(result.length, 371);
  assert.deepEqual(limits, [100, 500]);
});
test('server caps, changing history, duplicate IDs and maximum size are never called complete', async () => {
  for (const read of [
    (limit) => Array.from({ length: 100 }, (_, record_id) => ({ record_id })),
    (limit) =>
      Array.from({ length: limit === 100 ? 100 : 120 }, (_, i) => ({
        record_id: i + (limit === 100 ? 0 : 1),
      })),
    (limit) => [{ record_id: 1 }, { record_id: 1 }],
    (limit) => Array.from({ length: limit }, (_, record_id) => ({ record_id })),
  ])
    await assert.rejects(completeHistory(async (limit) => read(limit)));
});
test('calendar rejects dates that JavaScript would silently normalize', () => {
  for (const day of ['2026-02-30', '2026-13-01', '2026-00-01', '2026-2-01'])
    assert.throws(() => calendarDate(day));
  assert.equal(calendarDate('2024-02-29').getDate(), 29);
});
function fixture() {
  const device = { getSerial: () => 'CAM', getChannel: () => 1 };
  let stops = 0;
  const station = Object.assign(new EventEmitter(), {
    startDownload: async () => {},
    cancelDownload: () => {
      stops++;
      station.emit('download finish', station, 1);
    },
    close: async () => station.emit('close', station),
  });
  const begin = async () => {
    const p = downloadRecording(
      station,
      device,
      { storage_path: '/fixture' },
      new AbortController().signal,
    );
    const video = new PassThrough(),
      audio = new PassThrough();
    station.emit(
      'download start',
      station,
      1,
      { videoCodec: 0, audioCodec: 1, videoFPS: 15, videoWidth: 1920, videoHeight: 1080 },
      video,
      audio,
    );
    const handle = await p;
    handle.video.resume();
    handle.audio.resume();
    video.write(Buffer.from('fixture-video'));
    audio.write(Buffer.from('fixture-audio'));
    return { handle, video, audio };
  };
  return { station, begin, stops: () => stops };
}
test('only a device finish message can complete a download', async () => {
  const f = fixture(),
    { handle, video, audio } = await f.begin();
  video.end();
  audio.end();
  f.station.emit('download finish', f.station, 1);
  assert.equal(await Promise.race([handle.completed, delay(15, 'pending')]), 'pending');
  f.station.emit('download complete', f.station, 1);
  assert.equal((await handle.completed).complete, true);
  assert.equal(f.station.listenerCount('download finish'), 0);
});
test('download cancellation is held until its matching acknowledgement', async () => {
  const f = fixture(),
    { handle } = await f.begin(),
    cancel = handle.cancel();
  assert.equal(await Promise.race([cancel, delay(10, 'pending')]), 'pending');
  f.station.emit('command result', f.station, { command_type: 1051, channel: 2, return_code: 0 });
  assert.equal(await Promise.race([cancel, delay(10, 'pending')]), 'pending');
  f.station.emit('command result', f.station, { command_type: 1051, channel: 1, return_code: 0 });
  const result = await cancel;
  assert.equal(result.complete, false);
  assert.equal(result.stopConfirmed, true);
  assert.equal(result.reason, 'cancelled');
  await handle.cancel();
  assert.equal(f.stops(), 1);
});
test('a late device completion cannot discard source bytes still draining', async () => {
  const f = fixture(),
    { handle, video, audio } = await f.begin();
  f.station.emit('download finish', f.station, 1);
  f.station.emit('download complete', f.station, 1);
  assert.equal(await Promise.race([handle.completed, delay(15, 'pending')]), 'pending');
  video.end(Buffer.from('tail'));
  audio.end();
  assert.deepEqual(await handle.completed, { complete: true, bytes: 30 });
  assert.equal(video.listenerCount('data'), 0);
});
test('disconnect after local EOF cannot turn a truncated recording into success', async () => {
  const f = fixture(),
    { handle, video, audio } = await f.begin();
  video.end();
  audio.end();
  f.station.emit('download finish', f.station, 1);
  await f.station.close();
  const result = await handle.completed;
  assert.equal(result.complete, false);
  assert.equal(result.stopConfirmed, false);
});
