import test from 'node:test';
import assert from 'node:assert/strict';
import * as product from '../dist/mowers/maps/wire.js';
import * as research from '../scripts/research/e15-peer-wire.mjs';
import * as frames from '../dist/mowers/maps/framing.js';
import * as proven from '../scripts/research/e15-map-transfer.mjs';
import { MapKcp } from '../dist/mowers/maps/kcp.js';
import { TrialKcp } from '../scripts/research/e15-peer-kcp.mjs';

test('typed codecs preserve the separately oracle-validated research wire encodings', () => {
  const key = Buffer.alloc(16, 7),
    iv = Buffer.alloc(16, 9),
    plain = Buffer.from('synthetic');
  const token = { credential: 'synthetic-credential', username: 'user', sessionId: 'session' };
  for (const [name, args] of [
    ['cbcEncrypt', [key, iv, plain]],
    ['authorization', ['a'.repeat(32), 17]],
    ['versionRequest', [17]],
    ['handshake', [token, 0, { method: 'request', authorization: 'random=synthetic' }, iv]],
    ['signature', [token, 'account', 'synthetic']],
    ['dataRecord', [key, Buffer.alloc(30, 1)]],
  ])
    assert.deepEqual(product[name](...args), research[name](...args));
  for (const [name, args] of [
    ['albumRequest', [65537]],
    ['downloadRequest', [65538, frames.FILES]],
    ['cancelRequest', [65539]],
  ])
    assert.deepEqual(frames[name](...args), proven[name](...args));
  const bytes = research.dataRecord(key, Buffer.alloc(30, 1));
  for (let i = 0; i < bytes.length; i++) {
    const damaged = Buffer.from(bytes);
    damaged[i] ^= 1;
    assert.throws(() => product.decodeData(key, damaged));
  }
  for (let i = 0; i <= bytes.length; i++) {
    const reader = new product.RecordReader();
    assert.deepEqual(
      [...reader.push(bytes.subarray(0, i)), ...reader.push(bytes.subarray(i))],
      [bytes],
    );
    reader.clear();
    assert.throws(() => reader.push(bytes));
  }
  const old = new TrialKcp({ sendLimit: 5, messageLimit: 16384 }),
    typed = new MapKcp({ sendLimit: 5, messageLimit: 16384 });
  for (let i = 0; i < 5; i++) assert.deepEqual(typed.send(plain, i), old.send(plain, i));
  assert.throws(() => typed.send(plain, 6));
});
