// Bounded protocol-buffer wire reader for the E15 map files. It follows Google's public
// encoding guide and exposes records only. Field meaning belongs to geometry.ts, whose
// numbering is recorded with its provenance in docs/MAP_GEOMETRY.md.
/** Deepest message nesting accepted. The deepest known path is eight levels. */
export const MAX_MAP_DEPTH = 12;
/** Largest number of wire records read for one file. A record needs at least two bytes. */
export const MAX_MAP_RECORDS = 4_194_304;
const MAX_FIELD_NUMBER = 536_870_911;
const MAX_VARINT_BYTES = 10;

export type MapWireFault =
  | 'truncated'
  | 'varint'
  | 'field_number'
  | 'wire_type'
  | 'length'
  | 'group'
  | 'too_deep'
  | 'too_many_records'
  | 'field_type';

export interface MapWireRecord {
  number: number;
  wire: 'varint' | 'bytes' | 'fixed32' | 'fixed64';
  /** Varint value, otherwise a view of the file bytes. Never mutate it. */
  value: bigint | Uint8Array;
  /** Absolute offset of the record's tag within the file. */
  offset: number;
  /** Absolute offset of the record's payload within the file. */
  start: number;
}

/** Structural failure. `offset` is absolute within the file and `path` names the message. */
export class MapWireError extends Error {
  constructor(
    readonly reason: MapWireFault,
    readonly offset: number,
    readonly path: string,
  ) {
    super(`${reason} at ${offset} in ${path}`);
    this.name = 'MapWireError';
  }
}

export interface MapWireBudget {
  records: number;
}

export function mapWireBudget(): MapWireBudget {
  return { records: MAX_MAP_RECORDS };
}

function varint(bytes: Uint8Array, start: number, base: number, path: string) {
  let value = 0n;
  for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
    const offset = start + index;
    if (offset >= bytes.length) throw new MapWireError('truncated', base + start, path);
    const byte = bytes[offset]!;
    value |= BigInt(byte & 0x7f) << BigInt(7 * index);
    if ((byte & 0x80) === 0) return { value, end: offset + 1 };
  }
  throw new MapWireError('varint', base + start, path);
}

/**
 * Split one message into records. Length-delimited records are views, not copies, and are
 * never recursed into here. Groups and unknown wire types are structural faults.
 */
export function readMapRecords(
  bytes: Uint8Array,
  base: number,
  depth: number,
  budget: MapWireBudget,
  path: string,
): MapWireRecord[] {
  if (depth > MAX_MAP_DEPTH) throw new MapWireError('too_deep', base, path);
  const records: MapWireRecord[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (budget.records <= 0) throw new MapWireError('too_many_records', base + offset, path);
    budget.records -= 1;
    const start = offset;
    const tag = varint(bytes, offset, base, path);
    offset = tag.end;
    const number = tag.value >> 3n;
    if (number === 0n || number > BigInt(MAX_FIELD_NUMBER))
      throw new MapWireError('field_number', base + start, path);
    const type = Number(tag.value & 7n);
    if (type === 0) {
      const record = varint(bytes, offset, base, path);
      records.push({
        number: Number(number),
        wire: 'varint',
        value: record.value,
        offset: base + start,
        start: base + offset,
      });
      offset = record.end;
      continue;
    }
    if (type === 3 || type === 4) throw new MapWireError('group', base + start, path);
    if (type === 6 || type === 7) throw new MapWireError('wire_type', base + start, path);
    let length: number;
    let wire: MapWireRecord['wire'];
    if (type === 2) {
      const record = varint(bytes, offset, base, path);
      if (record.value > BigInt(bytes.length)) throw new MapWireError('length', base + start, path);
      length = Number(record.value);
      offset = record.end;
      wire = 'bytes';
    } else {
      length = type === 1 ? 8 : 4;
      wire = type === 1 ? 'fixed64' : 'fixed32';
    }
    if (offset + length > bytes.length) throw new MapWireError('length', base + start, path);
    records.push({
      number: Number(number),
      wire,
      value: bytes.subarray(offset, offset + length),
      offset: base + start,
      start: base + offset,
    });
    offset += length;
  }
  return records;
}

/** Decode a zigzag varint into a signed 32-bit integer. */
export function zigzag32(value: bigint): number {
  return Number(BigInt.asIntN(32, (value >> 1n) ^ -(value & 1n)));
}
