// Independent, bounded research codecs. See E15_KEY_CARRIER_CONTRACT_2026-09-10.md.
import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

const fail = () => {
  throw new Error('invalid-peer-message');
};
export const equal = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const mac = (algorithm, key, data) => createHmac(algorithm, key).update(data).digest();
export function cbcEncrypt(key, iv, plain) {
  if (key.length !== 16 || iv.length !== 16 || plain.length > 1300) fail();
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([iv, cipher.update(plain), cipher.final()]);
}
export function cbcDecrypt(key, bytes) {
  if (key.length !== 16 || bytes.length < 32 || bytes.length > 1328 || bytes.length % 16) fail();
  const cipher = createDecipheriv('aes-128-cbc', key, bytes.subarray(0, 16));
  return Buffer.concat([cipher.update(bytes.subarray(16)), cipher.final()]);
}
function tlv(type, value) {
  const out = Buffer.alloc(4 + value.length + (-value.length & 3));
  out.writeUInt16BE(type);
  out.writeUInt16BE(value.length, 2);
  value.copy(out, 4);
  return out;
}
function root(type, body) {
  if (body.length > 4092) fail();
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt16BE(type);
  out.writeUInt16BE(body.length, 2);
  body.copy(out, 4);
  return out;
}
export function attributes(bytes, expectedType) {
  if (
    bytes.length < 4 ||
    bytes.length > 4096 ||
    bytes.readUInt16BE() !== expectedType ||
    bytes.readUInt16BE(2) + 4 !== bytes.length
  )
    fail();
  const fields = new Map();
  for (let offset = 4; offset < bytes.length;) {
    if (offset + 4 > bytes.length) fail();
    const type = bytes.readUInt16BE(offset),
      size = bytes.readUInt16BE(offset + 2);
    const end = offset + 4 + size,
      padded = end + (-size & 3);
    if (
      fields.has(type) ||
      padded > bytes.length ||
      bytes.subarray(end, padded).some((v) => v !== 0)
    )
      fail();
    fields.set(type, { value: bytes.subarray(offset + 4, end), offset });
    offset = padded;
  }
  return fields;
}
export class RecordReader {
  #buffer = Buffer.alloc(0);
  push(chunk) {
    const records = [];
    // Consume large/coalesced network chunks without allocating a larger accumulator.
    while (chunk.length) {
      let wanted = 4 - this.#buffer.length;
      if (this.#buffer.length >= 4) {
        const size = this.#buffer.readUInt16BE(2) + 4;
        if (size > 4096 || size <= 4) fail();
        wanted = size - this.#buffer.length;
      }
      const n = Math.min(wanted, chunk.length);
      this.#buffer = Buffer.concat([this.#buffer, chunk.subarray(0, n)]);
      chunk = chunk.subarray(n);
      if (this.#buffer.length >= 4) {
        const size = this.#buffer.readUInt16BE(2) + 4;
        if (size > 4096 || size <= 4) fail();
        if (this.#buffer.length === size) {
          records.push(this.#buffer);
          this.#buffer = Buffer.alloc(0);
        }
      }
      if (records.length > 128) fail();
    }
    return records;
  }
  clear() {
    this.#buffer.fill(0);
    this.#buffer = Buffer.alloc(0);
  }
}
export function handshake(token, phase, json, iv) {
  const key = Buffer.from(token.credential).subarray(0, 16);
  const encrypted = cbcEncrypt(key, iv, Buffer.from(JSON.stringify(json))).subarray(16);
  const p = Buffer.alloc(2);
  p.writeUInt16BE(phase);
  const unsigned = root(
    0xf400,
    Buffer.concat([
      tlv(1, p),
      tlv(2, iv),
      tlv(3, Buffer.from(token.sessionId)),
      tlv(4, Buffer.from(token.username)),
      tlv(7, encrypted),
      tlv(8, Buffer.alloc(32)),
    ]),
  );
  mac('sha256', key, unsigned.subarray(0, -32)).copy(unsigned, unsigned.length - 32);
  return unsigned;
}
export function decodeHandshake(token, bytes, phase) {
  const fields = attributes(bytes, 0xf400);
  if (fields.size !== 6 || ![1, 2, 3, 4, 7, 8].every((k) => fields.has(k))) fail();
  const f = (k) => fields.get(k).value;
  const key = Buffer.from(token.credential).subarray(0, 16);
  if (
    f(1).length !== 2 ||
    f(1).readUInt16BE() !== phase ||
    f(2).length !== 16 ||
    fields.get(8).offset + 36 !== bytes.length ||
    !equal(f(3), Buffer.from(token.sessionId)) ||
    !equal(f(4), Buffer.from(token.username)) ||
    !equal(f(8), mac('sha256', key, bytes.subarray(0, -32)))
  )
    fail();
  return JSON.parse(cbcDecrypt(key, Buffer.concat([f(2), f(7)])).toString('utf8'));
}
export function signature(token, account, suffix) {
  const key = Buffer.alloc(64);
  Buffer.from(token.credential).copy(key, 0, 0, 64);
  return mac('sha256', key, `${token.username}:${token.sessionId}:${account}:${suffix}`).toString(
    'hex',
  );
}
export function dataRecord(key, kcp) {
  return root(0xf600, tlv(7, Buffer.concat([kcp, mac('sha1', key, kcp)])));
}
export function decodeData(key, record) {
  const fields = attributes(record, 0xf600);
  if (fields.size !== 1 || !fields.has(7)) fail();
  const b = fields.get(7).value;
  if (b.length < 44 || !equal(b.subarray(-20), mac('sha1', key, b.subarray(0, -20)))) fail();
  return b.subarray(0, -20);
}
export function authorization(credential, request = 0) {
  if (!/^[0-9a-f]{32}$/.test(credential)) fail();
  const b = Buffer.alloc(104);
  b.writeUInt32LE(0x12345678);
  b.writeUInt32LE(request, 4);
  b.write('admin', 8);
  b.write(credential, 40);
  return b;
}
export function versionRequest(request) {
  const b = Buffer.alloc(24);
  b.writeUInt32LE(0x12345678);
  b.writeUInt32LE(request, 4);
  b.writeUInt16LE(10, 12);
  b.writeUInt32LE(4, 16);
  b.writeUInt32LE(0x10000, 20);
  return b;
}
export function versionResponse(bytes, request) {
  if (
    bytes.length !== 24 ||
    bytes.readUInt32LE() !== 0x12345678 ||
    bytes.readUInt32LE(4) !== request ||
    bytes.readUInt32LE(8) !== 1 ||
    bytes.readUInt16LE(12) !== 10 ||
    bytes.readUInt16LE(14) !== 0 ||
    bytes.readUInt32LE(16) !== 4
  )
    fail();
  const version = bytes.readUInt32LE(20);
  return { major: version >>> 16, minor: version & 65535 };
}
