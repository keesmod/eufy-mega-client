// Pure decoding of DP 155, the E15 work parameters, a one-field encoder and the checks of the
// opt-in write path in the local session. The message numbering comes from the official app's
// product script and the wire rules from Google's public encoding guide, both recorded in
// docs/MOWER_WORK_PARAMETERS.md. No fork schema, constant, fixture or test. No I/O and no
// mutation of the input.
import { EufyError } from '../types.js';
import type {
  MowerBladeSpeed,
  MowerDirectionConfig,
  MowerDirectionMode,
  MowerDpSchemaEntry,
  MowerDpSnapshot,
  MowerMowSpeed,
  MowerSettingsOptions,
  MowerWorkParameterName,
  MowerWorkParameterValue,
  MowerWorkParameters,
  MowerWorkParametersDecoding,
  MowerWorkParametersFault,
  MowerWorkParametersReading,
} from '../modular-types.js';
import { DEFAULT_READ_BACK_MS, MAP_SAVE_DP, readBackBound } from './local/commands.js';

/** The declared raw data point `reserved_raw_155` that carries the message. */
export const WORK_PARAMETERS_DP = '155';
/** The device's own declared code for DP 155, checked against the session schema before a write. */
export const WORK_PARAMETERS_CODE = 'reserved_raw_155';
/** Largest accepted decoded value. */
export const MAX_WORK_PARAMETER_BYTES = 256;
/** Largest number of records read in one value, every level and packed element included. */
export const MAX_WORK_PARAMETER_RECORDS = 64;
/** Deepest accepted nesting. The deepest known message, a direction mode configuration, is 3. */
export const MAX_WORK_PARAMETER_DEPTH = 3;
const MAX_TEXT = Math.ceil(MAX_WORK_PARAMETER_BYTES / 3) * 4;
const MAX_FIELD_NUMBER = 536_870_911;
const MAX_VARINT_BYTES = 10;
const INT32_MIN = -(2n ** 31n);
const INT32_MAX = 2n ** 31n - 1n;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The app's enumerations in wire order. Any other value is kept as `{ unknown }`. */
const MOW_SPEEDS: readonly MowerMowSpeed[] = Object.freeze([
  'low',
  'medium',
  'adaptive_high',
  'auto',
]);
const BLADE_SPEEDS: readonly MowerBladeSpeed[] = Object.freeze(['low', 'medium', 'high']);
const DIRECTION_MODES: readonly MowerDirectionMode[] = Object.freeze([
  'single',
  'multiple',
  'auto_rotate',
]);

/** MainPageWorkParam field numbers from the app's serializers. */
const FIELDS = Object.freeze({
  mowHeight: 1,
  mowSpeed: 2,
  edgeDistance: 3,
  direction: 4,
  mowSpacing: 5,
  bladeSpeed: 6,
  currentMowSpacing: 7,
});
const TOP_FIELDS: readonly number[] = Object.freeze(Object.values(FIELDS));
/** MainDirectionAngleConfig: 1 mode, 2 single, 3 multiple, 4 auto rotate, 5 current angle. */
const DIRECTION_FIELDS: readonly number[] = Object.freeze([1, 2, 3, 4, 5]);
/** OptionalInt, MowSpeed, BladeDiskSpeed and the three mode configurations use field 1 only. */
const VALUE_FIELDS: readonly number[] = Object.freeze([1]);

interface WireRecord {
  wire: 'varint' | 'bytes' | 'fixed32' | 'fixed64';
  /** Varint value, otherwise a view of the input. Never mutated. */
  value: bigint | Uint8Array;
}
type Fields = Map<number, WireRecord[]>;
interface Budget {
  records: number;
}

/** Internal only. Every entry point turns it into a fault result, so nothing throws outward. */
class Fault extends Error {
  constructor(readonly reason: MowerWorkParametersFault) {
    super(reason);
    this.name = 'WorkParameterFault';
  }
}

function varint(bytes: Uint8Array, start: number): { value: bigint; end: number } {
  let value = 0n;
  for (let index = 0; ; index += 1) {
    const offset = start + index;
    if (offset >= bytes.length) throw new Fault('truncated');
    const byte = bytes[offset]!;
    // The tenth byte can only carry bit 63. A longer varint or a higher bit does not fit 64 bits.
    if (index === MAX_VARINT_BYTES - 1 && byte > 1) throw new Fault('varint');
    value |= BigInt(byte & 0x7f) << BigInt(7 * index);
    if (byte < 0x80) return { value, end: offset + 1 };
  }
}

/**
 * Split one message into records grouped by field number. Length-delimited records are views
 * and are only read further by the schema below. Groups and undefined wire types are faults.
 */
function read(bytes: Uint8Array, depth: number, budget: Budget): Fields {
  if (depth > MAX_WORK_PARAMETER_DEPTH) throw new Fault('too_deep');
  const fields: Fields = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    if (budget.records <= 0) throw new Fault('too_many_fields');
    budget.records -= 1;
    const tag = varint(bytes, offset);
    offset = tag.end;
    const number = tag.value >> 3n;
    if (number === 0n || number > BigInt(MAX_FIELD_NUMBER)) throw new Fault('field_number');
    const type = Number(tag.value & 7n);
    let record: WireRecord;
    if (type === 0) {
      const item = varint(bytes, offset);
      record = { wire: 'varint', value: item.value };
      offset = item.end;
    } else if (type === 1 || type === 2 || type === 5) {
      let length = type === 1 ? 8 : 4;
      if (type === 2) {
        const item = varint(bytes, offset);
        offset = item.end;
        if (item.value > BigInt(bytes.length - offset)) throw new Fault('truncated');
        length = Number(item.value);
      }
      if (offset + length > bytes.length) throw new Fault('truncated');
      const wire = type === 2 ? 'bytes' : type === 1 ? 'fixed64' : 'fixed32';
      record = { wire, value: bytes.subarray(offset, offset + length) };
      offset += length;
    } else throw new Fault('wire_type');
    const list = fields.get(Number(number));
    if (list) list.push(record);
    else fields.set(Number(number), [record]);
  }
  return fields;
}

/** A negative int32 is sign-extended to 64 bits on the wire. Anything outside int32 is a fault. */
function int32Of(raw: bigint): number {
  const value = BigInt.asIntN(64, raw);
  if (value < INT32_MIN || value > INT32_MAX) throw new Fault('varint');
  return Number(value);
}

/** A scalar int32 or enumeration. Every record must be a valid varint and the last one wins. */
function int32(fields: Fields, number: number): number | undefined {
  let result: number | undefined;
  for (const record of fields.get(number) ?? []) {
    if (record.wire !== 'varint') throw new Fault('field_type');
    result = int32Of(record.value as bigint);
  }
  return result;
}

/** A repeated int32 in packed or unpacked records, or both, in wire order. */
function int32List(fields: Fields, number: number, budget: Budget): number[] {
  const values: number[] = [];
  for (const record of fields.get(number) ?? []) {
    if (record.wire === 'varint') {
      values.push(int32Of(record.value as bigint));
      continue;
    }
    if (record.wire !== 'bytes') throw new Fault('field_type');
    const view = record.value as Uint8Array;
    let offset = 0;
    while (offset < view.length) {
      if (budget.records <= 0) throw new Fault('too_many_fields');
      budget.records -= 1;
      const item = varint(view, offset);
      values.push(int32Of(item.value));
      offset = item.end;
    }
  }
  return values;
}

/** A present message field. Several records merge, as a parser merges their concatenation. */
function message(
  fields: Fields,
  number: number,
  depth: number,
  budget: Budget,
): Fields | undefined {
  const list = fields.get(number);
  if (!list) return undefined;
  const parts = list.map((record) => {
    if (record.wire !== 'bytes') throw new Fault('field_type');
    return record.value as Uint8Array;
  });
  return read(parts.length === 1 ? parts[0]! : Buffer.concat(parts), depth + 1, budget);
}

function complete(fields: Fields, known: readonly number[]): boolean {
  for (const number of fields.keys()) if (!known.includes(number)) return false;
  return true;
}

function enumeration<T extends string>(names: readonly T[], code: number): T | { unknown: number } {
  return code >= 0 && code < names.length ? names[code]! : { unknown: code };
}

function direction(
  fields: Fields,
  budget: Budget,
  markUndecoded: () => void,
): MowerDirectionConfig {
  if (!complete(fields, DIRECTION_FIELDS)) markUndecoded();
  const result: MowerDirectionConfig = {
    mode: enumeration(DIRECTION_MODES, int32(fields, 1) ?? 0),
  };
  // Each mode configuration carries its value in field 1. The direction message is level 2.
  const config = (number: number): Fields | undefined => {
    const inner = message(fields, number, 2, budget);
    if (inner && !complete(inner, VALUE_FIELDS)) markUndecoded();
    return inner;
  };
  const single = config(2);
  if (single) result.singleAngle = int32(single, 1) ?? 0;
  const multiple = config(3);
  if (multiple) result.multipleAngles = int32List(multiple, 1, budget);
  const auto = config(4);
  if (auto) result.autoRotateInterval = int32(auto, 1) ?? 0;
  const current = int32(fields, 5);
  if (current !== undefined) result.currentAngle = current;
  return result;
}

function workParameters(bytes: Uint8Array): {
  parameters: MowerWorkParameters;
  undecodedFields: number[];
} {
  const budget: Budget = { records: MAX_WORK_PARAMETER_RECORDS };
  const top = read(bytes, 1, budget);
  const undecoded = new Set<number>();
  for (const number of top.keys()) if (!TOP_FIELDS.includes(number)) undecoded.add(number);
  // A wrapper message with field 1 only. An empty wrapper is a present zero.
  const wrapped = (number: number): number | undefined => {
    const inner = message(top, number, 1, budget);
    if (!inner) return undefined;
    if (!complete(inner, VALUE_FIELDS)) undecoded.add(number);
    return int32(inner, 1) ?? 0;
  };
  const parameters: MowerWorkParameters = {};
  const height = wrapped(FIELDS.mowHeight);
  if (height !== undefined) parameters.mowHeight = height;
  const speed = wrapped(FIELDS.mowSpeed);
  if (speed !== undefined) parameters.mowSpeed = enumeration(MOW_SPEEDS, speed);
  const edge = wrapped(FIELDS.edgeDistance);
  if (edge !== undefined) parameters.edgeDistance = edge;
  const config = message(top, FIELDS.direction, 1, budget);
  if (config)
    parameters.direction = direction(config, budget, () => undecoded.add(FIELDS.direction));
  const spacing = wrapped(FIELDS.mowSpacing);
  if (spacing !== undefined) parameters.mowSpacing = spacing;
  const blade = wrapped(FIELDS.bladeSpeed);
  if (blade !== undefined) parameters.bladeSpeed = enumeration(BLADE_SPEEDS, blade);
  const current = int32(top, FIELDS.currentMowSpacing);
  if (current !== undefined) parameters.currentMowSpacing = current;
  return { parameters, undecodedFields: [...undecoded].sort((a, b) => a - b) };
}

function malformed(reason: MowerWorkParametersFault): MowerWorkParametersDecoding {
  return { shape: 'malformed', reason };
}

/**
 * Decode one DP 155 value from its base64 text. Returns `decoded` with the fields that are on
 * the wire, or `malformed` with the first fault. An empty value and the app's single byte 0x00
 * decode to empty parameters. Unknown fields are skipped and listed by their top-level field
 * number. Never throws. The result shares no memory with the input or with earlier results.
 */
export function decodeMowerWorkParameters(value: unknown): MowerWorkParametersDecoding {
  if (typeof value !== 'string') return malformed('not_text');
  if (value.length > MAX_TEXT) return malformed('too_long');
  if (!BASE64.test(value)) return malformed('not_base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_WORK_PARAMETER_BYTES) return malformed('too_long');
  if (bytes.length === 0 || (bytes.length === 1 && bytes[0] === 0))
    return { shape: 'decoded', parameters: {}, undecodedFields: [] };
  try {
    return { shape: 'decoded', ...workParameters(bytes) };
  } catch (error) {
    if (error instanceof Fault) return malformed(error.reason);
    throw error;
  }
}

/**
 * The bounded reader alone: the distinct field numbers of one message read at `depth`, 1 for
 * the top level, in order of first appearance, or its first fault. Never throws. For tests.
 */
export function readWorkParameterFields(
  bytes: Uint8Array,
  depth: number,
): number[] | MowerWorkParametersFault {
  try {
    return [...read(bytes, depth, { records: MAX_WORK_PARAMETER_RECORDS }).keys()];
  } catch (error) {
    if (error instanceof Fault) return error.reason;
    throw error;
  }
}

/** One work parameter to encode. Not public API while the write design is open. */
export type MowerWorkParameterChange =
  | { name: 'mowSpeed'; value: MowerMowSpeed }
  | { name: 'bladeSpeed'; value: MowerBladeSpeed }
  | { name: 'edgeDistance'; value: number }
  | { name: 'mowSpacing'; value: number };

/** The encodable parameters: their field and, for an enumeration, its names in wire order. */
const CHANGES: Readonly<
  Record<MowerWorkParameterChange['name'], { field: number; names?: readonly string[] }>
> = Object.freeze({
  mowSpeed: Object.freeze({ field: FIELDS.mowSpeed, names: MOW_SPEEDS }),
  bladeSpeed: Object.freeze({ field: FIELDS.bladeSpeed, names: BLADE_SPEEDS }),
  edgeDistance: Object.freeze({ field: FIELDS.edgeDistance }),
  mowSpacing: Object.freeze({ field: FIELDS.mowSpacing }),
});

function writeVarint(out: number[], value: bigint): void {
  // A negative int32 is sign-extended to 64 bits and always takes ten bytes.
  let rest = BigInt.asUintN(64, value);
  while (rest >= 0x80n) {
    out.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  out.push(Number(rest));
}

function changeValue(names: readonly string[] | undefined, value: unknown): number {
  if (names) {
    const code = typeof value === 'string' ? names.indexOf(value) : -1;
    if (code < 0) throw new EufyError('mower_setting_invalid');
    return code;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < Number(INT32_MIN) ||
    value > Number(INT32_MAX)
  )
    throw new EufyError('mower_setting_invalid');
  return value;
}

/**
 * Encode one work parameter as a partial DP 155 message in base64, the way the app's encoder
 * sets only the changed field: the field's wrapper message around field 1, left empty for a
 * zero because proto3 omits it, with a negative integer as a ten-byte varint. Pure, nothing is
 * sent. The write path calls it only for the parameters of `WRITABLE_WORK_PARAMETERS`, the
 * integer parameters wait for a source of their bounds. Direction and mow height are not
 * encoded, mow height has its own DP 110 setting. Throws `mower_setting_invalid` for an unknown
 * name, a value of the wrong type, a non-integer or an integer outside int32.
 */
export function encodeMowerWorkParameter(change: MowerWorkParameterChange): string {
  if (!change || typeof change !== 'object' || Array.isArray(change))
    throw new EufyError('mower_setting_invalid');
  const { name, value } = change as Record<string, unknown>;
  if (typeof name !== 'string' || !Object.hasOwn(CHANGES, name))
    throw new EufyError('mower_setting_invalid');
  const { field, names } = CHANGES[name as MowerWorkParameterChange['name']];
  const content = changeValue(names, value);
  // Field 1 as a varint inside the wrapper. A zero stays absent, so the wrapper is empty.
  const inner: number[] = [];
  if (content !== 0) {
    writeVarint(inner, 1n << 3n);
    writeVarint(inner, BigInt(content));
  }
  // The wrapper as a length-delimited record of its top-level field.
  const out: number[] = [];
  writeVarint(out, (BigInt(field) << 3n) | 2n);
  writeVarint(out, BigInt(inner.length));
  return Buffer.from([...out, ...inner]).toString('base64');
}

/**
 * The work parameters the write path writes and the values it writes for each. The mow speeds
 * are the three that both of the app's mow speed types name, the blade speeds the app's whole
 * blade disk speed type. Edge distance and mow spacing have no bound from a permitted source,
 * and a direction write replaces a nested configuration, so all three stay read only.
 */
export const WRITABLE_WORK_PARAMETERS: Readonly<
  Record<MowerWorkParameterName, { readonly field: number; readonly values: readonly string[] }>
> = Object.freeze({
  mowSpeed: Object.freeze({
    field: FIELDS.mowSpeed,
    values: Object.freeze(['low', 'medium', 'adaptive_high']),
  }),
  bladeSpeed: Object.freeze({ field: FIELDS.bladeSpeed, values: BLADE_SPEEDS }),
});
/** The decoded parameters that the write path refuses as read only whatever the value. */
const READ_ONLY: readonly string[] = Object.freeze([
  'mowHeight',
  'edgeDistance',
  'direction',
  'mowSpacing',
  'currentMowSpacing',
]);

export interface ValidWorkParameterRequest {
  name: MowerWorkParameterName;
  field: number;
  value: MowerWorkParameterValue;
  encoded: string;
  readBackMs: number;
}

/** Decided before any I/O. A read-only parameter is refused whatever the value. */
export function validateWorkParameterRequest(
  request: unknown,
  options: MowerSettingsOptions,
): ValidWorkParameterRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request))
    throw new EufyError('mower_setting_invalid');
  const { name, value, readBackMs } = request as Record<string, unknown>;
  if (typeof name === 'string' && READ_ONLY.includes(name))
    throw new EufyError('mower_setting_read_only');
  if (typeof name !== 'string' || !Object.hasOwn(WRITABLE_WORK_PARAMETERS, name))
    throw new EufyError('mower_setting_invalid');
  const parameter = WRITABLE_WORK_PARAMETERS[name as MowerWorkParameterName];
  if (typeof value !== 'string' || !parameter.values.includes(value))
    throw new EufyError('mower_setting_invalid');
  if (readBackMs !== undefined && !readBackBound(readBackMs))
    throw new EufyError('mower_setting_invalid');
  const change = { name, value } as MowerWorkParameterChange;
  return {
    name: name as MowerWorkParameterName,
    field: parameter.field,
    value: value as MowerWorkParameterValue,
    encoded: encodeMowerWorkParameter(change),
    readBackMs: readBackMs ?? options.readBackMs ?? DEFAULT_READ_BACK_MS,
  };
}

/** The device itself must declare DP 155 as a readable and writable raw point with its code. */
export function requireDeclaredWorkParameters(
  schema: readonly MowerDpSchemaEntry[] | undefined,
): void {
  const entry = schema?.find((item) => item.id === WORK_PARAMETERS_DP);
  if (
    !entry ||
    entry.type !== 'raw' ||
    entry.mode !== 'rw' ||
    (entry.code !== undefined && entry.code !== WORK_PARAMETERS_CODE)
  )
    throw new EufyError('mower_setting_undeclared');
}

/**
 * Typed refusals decided on the cloud reading and the fresh query taken right before the write.
 * Without a writable value in a decoded reading there is nothing to restore, a running map save
 * refuses like a command, and a parameter already at the requested value cannot produce a fresh
 * change. Returns the value before the write and a copy of the reading's parameters.
 */
export function requireWorkParameterWritable(
  reading: MowerWorkParametersReading,
  before: MowerDpSnapshot,
  request: ValidWorkParameterRequest,
): {
  previous: MowerWorkParameterValue;
  cloud: { observedAt: string; parameters: MowerWorkParameters };
} {
  const progress = before.dps[MAP_SAVE_DP];
  if (
    reading.state !== 'reported' ||
    typeof progress !== 'number' ||
    !Number.isInteger(progress) ||
    progress < 0 ||
    progress > 100
  )
    throw new EufyError('mower_setting_evidence_missing');
  const current = reading.parameters[request.name];
  if (
    reading.undecodedFields.includes(request.field) ||
    typeof current !== 'string' ||
    !WRITABLE_WORK_PARAMETERS[request.name].values.includes(current)
  )
    throw new EufyError('mower_setting_evidence_missing');
  if (progress > 0 && progress < 100) throw new EufyError('mower_setting_map_saving');
  if (current === request.value) throw new EufyError('mower_setting_already_set');
  return {
    previous: current as MowerWorkParameterValue,
    cloud: { observedAt: reading.observedAt, parameters: structuredClone(reading.parameters) },
  };
}

/** The parameter in one reported DP 155 value, or undefined when the value carries none. */
export function reportedWorkParameter(
  value: unknown,
  name: MowerWorkParameterName,
):
  | {
      value: MowerMowSpeed | MowerBladeSpeed | { unknown: number };
      parameters: MowerWorkParameters;
    }
  | undefined {
  const decoded = decodeMowerWorkParameters(value);
  if (decoded.shape !== 'decoded') return undefined;
  const reported = decoded.parameters[name];
  return reported === undefined ? undefined : { value: reported, parameters: decoded.parameters };
}
