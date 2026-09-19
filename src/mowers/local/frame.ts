// Independent implementation of the documented Tuya LAN protocol 3.5 frame and session-key
// contract. Every protocol fact and its permitted source: docs/MOWER_TRANSPORT_PROVENANCE.md.
// No code, constants, schemas, fixtures or tests were copied from the unlicensed mower fork.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { EufyError } from '../../types.js';
import type { MowerDpValue } from '../../modular-types.js';

/** Default TCP port of the Tuya LAN protocol. */
export const LOCAL_PORT = 6668;
export const FRAME_PREFIX = 0x00006699;
export const FRAME_SUFFIX = 0x00009966;
/** Prefix, two reserved bytes, sequence, command and length. The last 14 bytes are the GCM AAD. */
export const HEADER_LENGTH = 18;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const SUFFIX_LENGTH = 4;
export const MIN_FRAME_LENGTH = HEADER_LENGTH + NONCE_LENGTH + TAG_LENGTH + SUFFIX_LENGTH;
/** Received frames are bounded here. The device itself accepts at most 4 KiB per frame. */
export const MAX_FRAME_LENGTH = 65536;
export const MAX_OUTGOING_FRAME_LENGTH = 4096;
export const KEY_LENGTH = 16;
export const NONCE_EXCHANGE_LENGTH = 16;
export const HMAC_LENGTH = 32;
const RETURN_CODE_LENGTH = 4;
const VERSION_HEADER_LENGTH = 15;
const MAX_DP_COUNT = 512;
const MAX_DP_DEPTH = 8;

export const Command = Object.freeze({
  SESSION_KEY_START: 0x03,
  SESSION_KEY_RESPONSE: 0x04,
  SESSION_KEY_FINISH: 0x05,
  STATUS_REPORT: 0x08,
  HEARTBEAT: 0x09,
  DP_QUERY: 0x0a,
  CONTROL_NEW: 0x0d,
  DP_QUERY_NEW: 0x10,
});

/**
 * Client control payloads carry the 15-byte version header before the JSON document: the
 * text `3.5` followed by twelve zero bytes for the unused checksum, serial and source fields.
 */
export function controlPayload(document: string): Buffer {
  return Buffer.concat([
    Buffer.from('3.5', 'latin1'),
    Buffer.alloc(VERSION_HEADER_LENGTH - 3),
    Buffer.from(document, 'utf8'),
  ]);
}

export interface DecodedFrame {
  sequence: number;
  command: number;
  /** Device frames start with a four-byte return code. Use splitReturnCode. */
  plaintext: Buffer;
}

const protocolError = () => new EufyError('mower_local_protocol_error');
const authenticationError = () => new EufyError('mower_local_authentication_failed');
const u32 = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
export const equal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
export const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Wrap one plaintext in an authenticated 3.5 frame. The nonce is fresh unless a test injects one. */
export function encodeFrame(
  key: Buffer,
  sequence: number,
  command: number,
  plaintext: Buffer,
  nonce: Buffer = randomBytes(NONCE_LENGTH),
): Buffer {
  if (key.length !== KEY_LENGTH || nonce.length !== NONCE_LENGTH || !u32(sequence) || !u32(command))
    throw protocolError();
  if (plaintext.length + MIN_FRAME_LENGTH > MAX_OUTGOING_FRAME_LENGTH) throw protocolError();
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt32BE(FRAME_PREFIX, 0);
  header.writeUInt16BE(0, 4);
  header.writeUInt32BE(sequence, 6);
  header.writeUInt32BE(command, 10);
  header.writeUInt32BE(NONCE_LENGTH + plaintext.length + TAG_LENGTH, 14);
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  cipher.setAAD(header.subarray(4));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const suffix = Buffer.alloc(SUFFIX_LENGTH);
  suffix.writeUInt32BE(FRAME_SUFFIX, 0);
  return Buffer.concat([header, nonce, body, cipher.getAuthTag(), suffix]);
}

/** Verify structure and GCM tag of one complete frame, then return its plaintext. */
export function decodeFrame(key: Buffer, frame: Buffer): DecodedFrame {
  if (key.length !== KEY_LENGTH) throw protocolError();
  if (frame.length < MIN_FRAME_LENGTH || frame.length > MAX_FRAME_LENGTH) throw protocolError();
  if (frame.readUInt32BE(0) !== FRAME_PREFIX) throw protocolError();
  if (frame.readUInt32BE(frame.length - SUFFIX_LENGTH) !== FRAME_SUFFIX) throw protocolError();
  const length = frame.readUInt32BE(14);
  if (length !== frame.length - HEADER_LENGTH - SUFFIX_LENGTH) throw protocolError();
  const bodyEnd = frame.length - SUFFIX_LENGTH - TAG_LENGTH;
  const cipher = createDecipheriv(
    'aes-128-gcm',
    key,
    frame.subarray(HEADER_LENGTH, HEADER_LENGTH + NONCE_LENGTH),
  );
  cipher.setAAD(frame.subarray(4, HEADER_LENGTH));
  cipher.setAuthTag(frame.subarray(bodyEnd, bodyEnd + TAG_LENGTH));
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([
      cipher.update(frame.subarray(HEADER_LENGTH + NONCE_LENGTH, bodyEnd)),
      cipher.final(),
    ]);
  } catch {
    throw authenticationError();
  }
  return { sequence: frame.readUInt32BE(6), command: frame.readUInt32BE(10), plaintext };
}

/** Device plaintexts carry a four-byte return code. Zero means accepted. */
export function splitReturnCode(plaintext: Buffer): { accepted: boolean; data: Buffer } {
  if (plaintext.length < RETURN_CODE_LENGTH) throw protocolError();
  const code = plaintext.subarray(0, RETURN_CODE_LENGTH);
  return {
    accepted: code.every((byte) => byte === 0),
    data: plaintext.subarray(RETURN_CODE_LENGTH),
  };
}

/** Bounded stream parser. The stream must be frame aligned. */
export class FrameReader {
  #buffer = Buffer.alloc(0);
  get pending(): number {
    return this.#buffer.length;
  }
  push(chunk: Buffer): void {
    if (this.#buffer.length + chunk.length > 2 * MAX_FRAME_LENGTH) throw protocolError();
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
  }
  /** Return the next complete raw frame, or undefined while more bytes are needed. */
  next(): Buffer | undefined {
    if (this.#buffer.length < HEADER_LENGTH) return undefined;
    if (this.#buffer.readUInt32BE(0) !== FRAME_PREFIX) throw protocolError();
    const length = this.#buffer.readUInt32BE(14);
    if (
      length < NONCE_LENGTH + TAG_LENGTH ||
      length > MAX_FRAME_LENGTH - HEADER_LENGTH - SUFFIX_LENGTH
    )
      throw protocolError();
    const total = HEADER_LENGTH + length + SUFFIX_LENGTH;
    if (this.#buffer.length < total) return undefined;
    const frame = Buffer.from(this.#buffer.subarray(0, total));
    this.#buffer = Buffer.from(this.#buffer.subarray(total));
    return frame;
  }
  clear(): void {
    this.#buffer.fill(0);
    this.#buffer = Buffer.alloc(0);
  }
}

/** The 16-byte device local key as bytes. Other lengths cannot negotiate a session. */
export function localKeyBytes(localKey: string): Buffer {
  const bytes = Buffer.from(localKey, 'utf8');
  if (bytes.length !== KEY_LENGTH || !/^[\x21-\x7e]+$/.test(localKey))
    throw new EufyError('mower_local_key_invalid');
  return bytes;
}

/** Step 1 payload: a fresh 16-byte client nonce, sent under the local key. */
export function sessionKeyStart(nonce: Buffer = randomBytes(NONCE_EXCHANGE_LENGTH)): Buffer {
  if (nonce.length !== NONCE_EXCHANGE_LENGTH) throw protocolError();
  return nonce;
}

/** Step 2 check: device nonce plus HMAC-SHA256 of the client nonce under the local key. */
export function verifySessionKeyResponse(
  localKey: Buffer,
  clientNonce: Buffer,
  data: Buffer,
): Buffer {
  if (data.length < NONCE_EXCHANGE_LENGTH + HMAC_LENGTH) throw protocolError();
  const deviceNonce = Buffer.from(data.subarray(0, NONCE_EXCHANGE_LENGTH));
  const proof = data.subarray(NONCE_EXCHANGE_LENGTH, NONCE_EXCHANGE_LENGTH + HMAC_LENGTH);
  if (!equal(hmac(localKey, clientNonce), proof)) throw authenticationError();
  return deviceNonce;
}

/** Step 3 payload: HMAC-SHA256 of the device nonce under the local key. */
export function sessionKeyFinish(localKey: Buffer, deviceNonce: Buffer): Buffer {
  return hmac(localKey, deviceNonce);
}

/** Session key: AES-128-GCM under the local key of the XOR of both nonces, IV = client nonce[0..12). */
export function deriveSessionKey(
  localKey: Buffer,
  clientNonce: Buffer,
  deviceNonce: Buffer,
): Buffer {
  if (
    localKey.length !== KEY_LENGTH ||
    clientNonce.length !== NONCE_EXCHANGE_LENGTH ||
    deviceNonce.length !== NONCE_EXCHANGE_LENGTH
  )
    throw protocolError();
  const mixed = Buffer.alloc(KEY_LENGTH);
  for (let i = 0; i < KEY_LENGTH; i++) mixed[i] = clientNonce[i]! ^ deviceNonce[i]!;
  const cipher = createCipheriv('aes-128-gcm', localKey, clientNonce.subarray(0, NONCE_LENGTH));
  const key = Buffer.concat([cipher.update(mixed), cipher.final()]);
  cipher.getAuthTag();
  mixed.fill(0);
  return key;
}

function dpValue(value: unknown, depth: number): MowerDpValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw protocolError();
    return value;
  }
  if (depth >= MAX_DP_DEPTH) throw protocolError();
  if (Array.isArray(value)) return value.map((item) => dpValue(item, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, dpValue(v, depth + 1)]),
    );
  throw protocolError();
}

/** Decode an accepted query response into DP values and the optional reported device ID. */
export function decodeStatus(data: Buffer): {
  dps: Record<string, MowerDpValue>;
  deviceId?: string;
} {
  let body = data;
  // Device reports may carry the 15-byte "3.5" version header before the JSON document.
  if (body.length >= VERSION_HEADER_LENGTH && body.subarray(0, 3).toString('latin1') === '3.5')
    body = body.subarray(VERSION_HEADER_LENGTH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw protocolError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw protocolError();
  const root = parsed as Record<string, unknown>;
  const container =
    root.dps !== undefined
      ? root
      : root.data && typeof root.data === 'object' && !Array.isArray(root.data)
        ? (root.data as Record<string, unknown>)
        : undefined;
  if (
    !container ||
    !container.dps ||
    typeof container.dps !== 'object' ||
    Array.isArray(container.dps)
  )
    throw protocolError();
  const entries = Object.entries(container.dps as Record<string, unknown>);
  if (entries.length > MAX_DP_COUNT) throw protocolError();
  const dps: Record<string, MowerDpValue> = {};
  for (const [id, value] of entries) {
    if (!/^[1-9][0-9]{0,4}$/.test(id)) throw protocolError();
    dps[id] = dpValue(value, 0);
  }
  const deviceId = container.devId ?? root.devId;
  if (deviceId !== undefined && (typeof deviceId !== 'string' || deviceId.length > 64))
    throw protocolError();
  return deviceId === undefined ? { dps } : { dps, deviceId };
}
