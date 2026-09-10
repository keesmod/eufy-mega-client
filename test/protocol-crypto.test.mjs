import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../dist/vendor/p2p/utils.js';

test('camera AES decoding matches the NIST AES-128 ECB vector', () => {
  const key = '2b7e151628aed2a6abf7158809cf4f3c';
  const plaintext = '6bc1bee22e409f96e93d7e117393172a';
  const encrypted = '3ad77bb40d7a3660a89ecaf32466ef97';
  assert.equal(
    protocol.decryptAESData(key, Buffer.from(encrypted, 'hex')).toString('hex'),
    plaintext,
  );
});
test('device AES rejects truncated blocks and invalid CBC padding', () => {
  const key = '00'.repeat(16),
    iv = '11'.repeat(16);
  assert.throws(() => protocol.decryptAESData(key, Buffer.alloc(15)));
  assert.throws(() => protocol.decryptLockAESData(key, iv, Buffer.alloc(16)));
  const data = Buffer.from('p2p fixture');
  assert.deepEqual(
    protocol.decryptLockAESData(key, iv, protocol.encryptLockAESData(key, iv, data)),
    data,
  );
});
