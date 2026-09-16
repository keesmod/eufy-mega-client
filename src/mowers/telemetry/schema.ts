// Parser for the data-point schema the Tuya cloud returns with a device record.
// Field names and property types follow the sources in docs/MOWER_TELEMETRY.md.
import type { MowerDpPropertyType, MowerDpSchemaEntry } from '../../modular-types.js';

const MAX_SCHEMA_TEXT = 65536;
const MAX_ENTRIES = 512;
const MAX_RANGE = 64;
const CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ID = /^[1-9][0-9]{0,4}$/;
const TYPES = new Set<MowerDpPropertyType>(['bool', 'value', 'enum', 'string', 'bitmap', 'raw']);

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 2 ** 31
    ? value
    : undefined;
}

function entry(value: unknown): MowerDpSchemaEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'number' ? String(raw.id) : raw.id;
  if (typeof id !== 'string' || !ID.test(id)) return undefined;
  const mode = raw.mode === undefined ? 'rw' : raw.mode;
  if (mode !== 'ro' && mode !== 'rw' && mode !== 'wr') return undefined;
  const kind = raw.type === undefined ? 'obj' : raw.type;
  if (kind !== 'obj' && kind !== 'raw') return undefined;
  const result: MowerDpSchemaEntry = { id, mode, type: 'raw' };
  if (typeof raw.code === 'string' && CODE.test(raw.code)) result.code = raw.code;
  if (kind === 'raw') return result;
  const property = raw.property;
  if (!property || typeof property !== 'object' || Array.isArray(property)) return undefined;
  const prop = property as Record<string, unknown>;
  if (typeof prop.type !== 'string' || !TYPES.has(prop.type as MowerDpPropertyType))
    return undefined;
  result.type = prop.type as MowerDpPropertyType;
  if (result.type === 'value') {
    for (const key of ['min', 'max', 'scale', 'step'] as const) {
      const number = integer(prop[key]);
      if (number !== undefined) result[key] = number;
    }
    if (result.scale !== undefined && (result.scale < 0 || result.scale > 6)) return undefined;
    if (typeof prop.unit === 'string' && prop.unit.length <= 16) result.unit = prop.unit;
  } else if (result.type === 'enum') {
    if (
      !Array.isArray(prop.range) ||
      prop.range.length > MAX_RANGE ||
      !prop.range.every((item) => typeof item === 'string' && item.length <= 64)
    )
      return undefined;
    result.range = [...(prop.range as string[])];
  } else if (result.type === 'string' || result.type === 'bitmap') {
    const maxlen = integer(prop.maxlen);
    if (maxlen !== undefined && maxlen >= 0) result.maxlen = maxlen;
  }
  return result;
}

/**
 * Accept the cloud's schema text or array. Invalid entries are skipped, so an optional
 * metadata field can never fail discovery. Returns undefined when nothing usable exists.
 */
export function parseSchema(raw: unknown): MowerDpSchemaEntry[] | undefined {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_SCHEMA_TEXT) return undefined;
    try {
      list = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(list) || list.length > MAX_ENTRIES) return undefined;
  const seen = new Set<string>();
  const entries: MowerDpSchemaEntry[] = [];
  for (const item of list) {
    const parsed = entry(item);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    entries.push(parsed);
  }
  return entries.length ? entries : undefined;
}

export function copySchema(
  schema: readonly MowerDpSchemaEntry[] | undefined,
): MowerDpSchemaEntry[] | undefined {
  return schema?.map((item) => ({ ...item, ...(item.range ? { range: [...item.range] } : {}) }));
}
