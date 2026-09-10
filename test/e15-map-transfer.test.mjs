import test from 'node:test';
import assert from 'node:assert/strict';
import {
  albumRequest,
  downloadRequest,
  cancelRequest,
  albumFiles,
  MapFileReader,
  CommandReader,
} from '../scripts/research/e15-map-transfer.mjs';
const files = ['map.bin.stream', 'cleanPath.bin.stream', 'navPath.bin.stream'];
function packet(name, index, data, end = 1, total = data.length) {
  const b = Buffer.alloc(80 + data.length);
  b.writeUInt32LE(1);
  b.writeUInt32LE(1000, 4);
  b.writeUInt16LE(1, 10);
  b.writeInt32LE(index, 12);
  b.writeUInt32LE(3, 16);
  b.write(name, 20);
  b.writeUInt32LE(data.length, 68);
  b.writeUInt32LE(total, 72);
  b.writeUInt32LE(end, 76);
  data.copy(b, 80);
  return b;
}
test('only established album and exact map allowlist can be requested', () => {
  assert.equal(albumRequest(17).length, 136);
  assert.equal(downloadRequest(0x10002, files).length, 228);
  assert.equal(cancelRequest(18).readUInt32LE(24), 4);
  for (const names of [['secret'], [], [...files, 'other'], [...files].reverse()])
    assert.throws(() => downloadRequest(1, names));
});
test('album parsing requires complete response and every allowed file', () => {
  const b = Buffer.alloc(520 + 240);
  b.writeUInt32LE(3, 4);
  b.writeUInt32LE(3, 516);
  files.forEach((n, i) => {
    b[524 + i * 80] = 1;
    b.write(n, 528 + i * 80);
  });
  assert.deepEqual(albumFiles(b), files);
  assert.throws(() => albumFiles(b.subarray(0, -1)));
  b.writeUInt32LE(1, 4);
  assert.throws(() => albumFiles(b));
});
test('ordered file chunks survive every byte split and require exact completion', () => {
  const data = Buffer.from('synthetic-map');
  const b = Buffer.concat([
    packet(files[0], 0, data.subarray(0, 5), 0, data.length),
    packet(files[0], 1, data.subarray(5), 1, data.length),
  ]);
  for (let split = 0; split <= b.length; split++) {
    const r = new MapFileReader(1);
    const got = [...r.push(b.subarray(0, split)), ...r.push(b.subarray(split))];
    assert.equal(got.length, 1);
    assert.deepEqual(got[0].data, data);
    assert.equal(r.ready, false);
    r.close();
  }
  const bad = packet(files[0], 0, data, 1, data.length + 1);
  assert.throws(() => new MapFileReader(1).push(bad), /incomplete/);
});
test('foreign files, tasks, out-of-order packets and interleaving fail closed', () => {
  assert.throws(() => new MapFileReader(1).push(packet('secret', 0, Buffer.from('x'))));
  assert.throws(() => new MapFileReader(2).push(packet(files[0], 0, Buffer.from('x'))));
  for (const second of [
    packet(files[0], 2, Buffer.from('x')),
    packet(files[1], 1, Buffer.from('x')),
  ]) {
    const r = new MapFileReader(1);
    r.push(packet(files[0], 0, Buffer.from('x'), 0, 2));
    assert.throws(() => r.push(second));
  }
});
test('command reader rejects bad markers and request frames', () => {
  const b = albumRequest(7);
  assert.throws(() => new CommandReader().push(b));
  b.writeUInt32LE(1, 8);
  assert.equal(new CommandReader().push(b)[0].request, 7);
  b[0] = 0;
  assert.throws(() => new CommandReader().push(b));
});
test('an incomplete replacement prevents settling after three complete files', () => {
  const r = new MapFileReader(1);
  files.forEach((f, i) => r.push(packet(f, i, Buffer.from('x'))));
  assert.equal(r.settled, true);
  r.push(packet(files[1], 3, Buffer.from('a'), 0, 2));
  assert.equal(r.ready, true);
  assert.equal(r.settled, false);
  const finished = r.push(packet(files[1], 4, Buffer.from('b'), 1, 2));
  assert.equal(finished[0].data.toString(), 'ab');
  assert.equal(r.settled, true);
});
test('empty evidenced carrier heartbeats survive all split boundaries', async () => {
  const { RecordReader } = await import('../scripts/research/e15-peer-wire.mjs');
  const heartbeat = Buffer.from([0xf5, 0, 0, 0]);
  for (let i = 0; i <= 4; i++) {
    const r = new RecordReader();
    assert.deepEqual(
      [...r.push(heartbeat.subarray(0, i)), ...r.push(heartbeat.subarray(i))],
      [heartbeat],
    );
  }
  assert.throws(() => new RecordReader().push(Buffer.from([0xf6, 0, 0, 0])));
});
test('file and command readers reject data after resource closure', () => {
  for (const r of [new CommandReader(), new MapFileReader(1)]) {
    r.close();
    assert.throws(() => r.push(Buffer.from('late')), /reader-closed/);
  }
});
test('file KCP channel is independently ordered and cannot send', async () => {
  const { TrialKcp } = await import('../scripts/research/e15-peer-kcp.mjs');
  const sender = new TrialKcp({ channel: 5, sendLimit: 1 });
  const receiver = new TrialKcp({ channel: 5, sendLimit: 0 });
  const wire = sender.send(Buffer.from('synthetic'), 0);
  assert.equal(wire.readUInt32LE(), 5);
  const result = receiver.receive(wire);
  assert.equal(result.messages[0].toString(), 'synthetic');
  assert.equal(result.output[0].readUInt32LE(), 5);
  assert.throws(() => receiver.send(Buffer.from('x'), 0));
  assert.throws(() => new TrialKcp().receive(wire));
  receiver.close();
  assert.throws(() => receiver.receive(wire));
});
