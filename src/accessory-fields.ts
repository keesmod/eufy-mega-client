import type { WireDevice } from './types.js';

/**
 * Diagnostics for an accessory's inventory row (ha-eufy-cam#275): which keys
 * hold text and which parameter types hold text. Keys and numbers only. Values,
 * such as names or serials, never leave this function.
 */
export interface AccessoryFieldDiagnostics {
  stringFields: string[];
  textParams: number[];
  nameSource: 'alias' | 'device_name' | null;
}

const KEY = /^[A-Za-z0-9_.]{1,64}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const SKIPPED = new Set(['member', 'params']);
export const STRING_FIELDS_LIMIT = 48;
export const TEXT_PARAMS_LIMIT = 32;
export const PARAM_TYPE_MAX = 100000;

const text = (value: unknown): value is string => typeof value === 'string' && value !== '';

const plainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const paramType = (value: unknown): number | undefined => {
  const type =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(type) && type >= 0 && type <= PARAM_TYPE_MAX ? type : undefined;
};

/** The sorted keys of non-empty strings, top level and one nested level of plain objects. */
export function stringFields(row: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(row)) {
    if (SKIPPED.has(key)) continue;
    if (text(value)) keys.add(key);
    else if (plainObject(value))
      for (const [child, nested] of Object.entries(value))
        if (text(nested)) keys.add(`${key}.${child}`);
  }
  return [...keys]
    .filter((key) => KEY.test(key))
    .sort()
    .slice(0, STRING_FIELDS_LIMIT);
}

/** The sorted parameter types whose value is non-empty text that is not a plain number. */
export function textParams(params: unknown): number[] {
  if (!Array.isArray(params)) return [];
  const types = new Set<number>();
  for (const param of params) {
    if (!plainObject(param)) continue;
    const type = paramType(param.param_type);
    const value = param.param_value;
    if (type !== undefined && text(value) && !NUMBER.test(value)) types.add(type);
  }
  return [...types].sort((a, b) => a - b).slice(0, TEXT_PARAMS_LIMIT);
}

/** Which field supplies the name, in the order the name itself is chosen. */
export function nameSource(row: WireDevice): AccessoryFieldDiagnostics['nameSource'] {
  if (text(row.device_alias_name)) return 'alias';
  if (text(row.device_name)) return 'device_name';
  return null;
}

export function accessoryFieldDiagnostics(row: WireDevice): AccessoryFieldDiagnostics {
  return {
    stringFields: stringFields(row),
    textParams: textParams(row.params),
    nameSource: nameSource(row),
  };
}
