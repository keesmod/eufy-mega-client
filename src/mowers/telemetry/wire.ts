// Pure structural parser for base64 raw data points that carry protocol-buffer wire records.
// The envelope facts follow Google's public encoding guide as recorded in docs/MOWER_TELEMETRY.md.
// It exposes field numbers and values only. Field meaning belongs to evidence-gated definitions.
import type { MowerWireFault, MowerWireField, MowerWirePayload } from '../../modular-types.js';

/** Largest accepted decoded payload. Observed DP 107 payloads are at most six bytes. */
export const MAX_WIRE_BYTES = 256;
/** Largest accepted number of records in one payload. */
export const MAX_WIRE_FIELDS = 32;
const MAX_TEXT = Math.ceil(MAX_WIRE_BYTES / 3) * 4;
const MAX_FIELD_NUMBER = 536_870_911;
const MAX_VARINT_BYTES = 10;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type Varint = { value: bigint; end: number } | undefined;

function varint(bytes: Uint8Array, start: number): Varint {
  let value = 0n;
  for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
    const offset = start + index;
    if (offset >= bytes.length) return undefined;
    const byte = bytes[offset]!;
    value |= BigInt(byte & 0x7f) << BigInt(7 * index);
    if ((byte & 0x80) === 0) return { value, end: offset + 1 };
  }
  return undefined;
}

function malformed(reason: MowerWireFault, byteLength: number): MowerWirePayload {
  return { shape: 'malformed', byteLength, reason };
}

/**
 * Decode one raw data-point value. Returns `fields` for a well-formed record sequence,
 * `default` for the observed empty or single-zero-byte payload and `malformed` otherwise.
 * Length-delimited and fixed-width records are copied as bytes and never recursed into.
 * Never throws. The result shares no memory with the input or with earlier results.
 */
export function parseMowerWirePayload(value: unknown): MowerWirePayload {
  if (typeof value !== 'string') return malformed('not_text', 0);
  if (value.length > MAX_TEXT) return malformed('too_long', 0);
  if (!BASE64.test(value)) return malformed('not_base64', 0);
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  const byteLength = bytes.length;
  if (byteLength > MAX_WIRE_BYTES) return malformed('too_long', byteLength);
  if (byteLength === 0 || (byteLength === 1 && bytes[0] === 0))
    return { shape: 'default', byteLength, fields: [] };
  const fields: MowerWireField[] = [];
  let offset = 0;
  while (offset < byteLength) {
    if (fields.length >= MAX_WIRE_FIELDS) return malformed('too_many_fields', byteLength);
    const tag = varint(bytes, offset);
    if (!tag)
      return malformed(offset + MAX_VARINT_BYTES > byteLength ? 'truncated' : 'varint', byteLength);
    offset = tag.end;
    const number = tag.value >> 3n;
    if (number === 0n || number > BigInt(MAX_FIELD_NUMBER))
      return malformed('field_number', byteLength);
    const type = Number(tag.value & 7n);
    if (type === 0) {
      const record = varint(bytes, offset);
      if (!record)
        return malformed(
          offset + MAX_VARINT_BYTES > byteLength ? 'truncated' : 'varint',
          byteLength,
        );
      if (record.value > BigInt(Number.MAX_SAFE_INTEGER)) return malformed('varint', byteLength);
      fields.push({ number: Number(number), wire: 'varint', value: Number(record.value) });
      offset = record.end;
      continue;
    }
    let length: number;
    let wire: 'bytes' | 'fixed32' | 'fixed64';
    if (type === 2) {
      const record = varint(bytes, offset);
      if (!record)
        return malformed(
          offset + MAX_VARINT_BYTES > byteLength ? 'truncated' : 'varint',
          byteLength,
        );
      if (record.value > BigInt(MAX_WIRE_BYTES)) return malformed('truncated', byteLength);
      length = Number(record.value);
      offset = record.end;
      wire = 'bytes';
    } else if (type === 1) {
      length = 8;
      wire = 'fixed64';
    } else if (type === 5) {
      length = 4;
      wire = 'fixed32';
    } else {
      return malformed('wire_type', byteLength);
    }
    if (offset + length > byteLength) return malformed('truncated', byteLength);
    fields.push({ number: Number(number), wire, value: bytes.slice(offset, offset + length) });
    offset += length;
  }
  return { shape: 'fields', byteLength, fields };
}

/**
 * Read the payload as one varint per field number for candidate matching. Returns undefined
 * when the payload is not a record sequence or when any field number repeats or is not a varint,
 * because such a payload is ambiguous for a scalar reading and must stay withheld.
 */
export function wireVarints(payload: MowerWirePayload): Map<number, number> | undefined {
  if (payload.shape !== 'fields') return undefined;
  const result = new Map<number, number>();
  for (const field of payload.fields) {
    if (field.wire !== 'varint' || result.has(field.number)) return undefined;
    result.set(field.number, field.value);
  }
  return result;
}
