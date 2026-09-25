// Opt-in settings over the device's declared boolean and value points. Every setting, its
// permitted sources and the owned-device evidence: docs/MOWER_SETTINGS.md. Rain and child
// protection are read only here and can never be written through this library.
import { EufyError } from '../../types.js';
import type {
  MowerDpSchemaEntry,
  MowerDpSnapshot,
  MowerDpValue,
  MowerSettingField,
  MowerSettingName,
  MowerSettings,
  MowerSettingsDecodeOptions,
  MowerSettingsOptions,
  MowerSettingValue,
} from '../../modular-types.js';
import { DEFAULT_READ_BACK_MS, MAP_SAVE_DP, readBackBound } from './commands.js';

export interface SettingClass {
  /** Data point the device declares for this setting. */
  readonly dp: string;
  /** The device's own declared code, checked against the session schema before a write. */
  readonly code: string;
  readonly type: 'bool' | 'value';
  /** False for rain and child protection and for the bird-view capture: never written. */
  readonly writable: boolean;
  /** Value settings only: the official app's own input bound and the declared unit. */
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
}

/** The only settings the library reads, and the only four it can write. */
export const SETTINGS: Readonly<Record<MowerSettingName, SettingClass>> = Object.freeze({
  mowHeight: Object.freeze({
    dp: '110',
    code: 'mow_height',
    type: 'value',
    writable: true,
    min: 25,
    max: 75,
    unit: 'mm',
  }),
  volume: Object.freeze({
    dp: '26',
    code: 'volume_set',
    type: 'value',
    writable: true,
    min: 0,
    max: 100,
    unit: '%',
  }),
  smartNoGoZones: Object.freeze({
    dp: '132',
    code: 'enable_smart_forbid_zone',
    type: 'bool',
    writable: true,
  }),
  sparseLawnOptimization: Object.freeze({
    dp: '141',
    code: 'sparse_lawn_optimization',
    type: 'bool',
    writable: true,
  }),
  rainAutoReturn: Object.freeze({
    dp: '101',
    code: 'rain_auto_return',
    type: 'bool',
    writable: false,
  }),
  childLock: Object.freeze({ dp: '47', code: 'child_lock', type: 'bool', writable: false }),
  birdViewCapture: Object.freeze({
    dp: '133',
    code: 'enable_bird_view_capture',
    type: 'bool',
    writable: false,
  }),
});

const NAMES = Object.keys(SETTINGS) as MowerSettingName[];

interface Bounds {
  min: number;
  max: number;
  step: number;
}

/**
 * The declaration that makes a setting writable: the same code and type, readable and writable,
 * and for a value an unscaled integer with a positive step. Anything else is not written.
 */
function declared(
  setting: SettingClass,
  schema: readonly MowerDpSchemaEntry[] | undefined,
): MowerDpSchemaEntry | undefined {
  const entry = schema?.find((item) => item.id === setting.dp);
  if (
    !entry ||
    entry.type !== setting.type ||
    entry.mode !== 'rw' ||
    (entry.code !== undefined && entry.code !== setting.code)
  )
    return undefined;
  if (
    entry.type === 'value' &&
    ((entry.scale !== undefined && entry.scale !== 0) ||
      (entry.step !== undefined && entry.step < 1))
  )
    return undefined;
  return entry;
}

/** The app's bound narrowed by the declaration, when there is one. */
function bounds(setting: SettingClass, entry: MowerDpSchemaEntry | undefined): Bounds {
  const min = Math.max(setting.min ?? 0, entry?.min ?? -Infinity);
  const max = Math.min(setting.max ?? 0, entry?.max ?? Infinity);
  return { min, max, step: entry?.step ?? 1 };
}

/** A reported or requested value of the setting's own type within its bound and step. */
function acceptable(
  setting: SettingClass,
  value: unknown,
  entry: MowerDpSchemaEntry | undefined,
): value is MowerSettingValue {
  if (setting.type === 'bool') return typeof value === 'boolean';
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  const { min, max, step } = bounds(setting, entry);
  return value >= min && value <= max && (value - (entry?.min ?? min)) % step === 0;
}

function field(
  setting: SettingClass,
  dps: Record<string, MowerDpValue>,
  schema: readonly MowerDpSchemaEntry[] | undefined,
): MowerSettingField {
  if (!Object.hasOwn(dps, setting.dp)) return { state: 'missing', dp: setting.dp };
  const entry = declared(setting, schema);
  const value = dps[setting.dp];
  if (!acceptable(setting, value, entry)) return { state: 'invalid', dp: setting.dp };
  const result: MowerSettingField = {
    state: 'reported',
    dp: setting.dp,
    type: setting.type,
    value,
    writable: setting.writable && entry !== undefined,
  };
  if (setting.type === 'value') {
    Object.assign(result, bounds(setting, entry));
    if (setting.unit) result.unit = setting.unit;
  }
  return result;
}

/**
 * Pure decoder from one local snapshot to the typed settings. It reads only the declared points
 * of the settings table, infers nothing from an absent or invalid point and never writes.
 */
export function decodeMowerSettings(
  snapshot: MowerDpSnapshot,
  options: MowerSettingsDecodeOptions = {},
): MowerSettings {
  if (
    !snapshot ||
    snapshot.source !== 'local-tuya-3.5' ||
    typeof snapshot.observedAt !== 'string' ||
    !snapshot.dps ||
    typeof snapshot.dps !== 'object'
  )
    throw new TypeError('invalid snapshot');
  const settings = {} as Record<MowerSettingName, MowerSettingField>;
  for (const name of NAMES) settings[name] = field(SETTINGS[name], snapshot.dps, options.schema);
  return { source: snapshot.source, observedAt: snapshot.observedAt, settings };
}

/** Accept the opt-in only when it is explicit. */
export function validateSettingsOptions(options: unknown): MowerSettingsOptions | undefined {
  if (options === undefined) return undefined;
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new EufyError('mower_invalid_options');
  const { enabled, readBackMs } = options as Record<string, unknown>;
  if (enabled !== true) throw new EufyError('mower_invalid_options');
  if (readBackMs !== undefined && !readBackBound(readBackMs))
    throw new EufyError('mower_invalid_options');
  return { enabled: true, ...(readBackMs === undefined ? {} : { readBackMs }) };
}

export interface ValidSettingRequest {
  name: MowerSettingName;
  setting: SettingClass;
  value: MowerSettingValue;
  readBackMs: number;
}

/** Decided before any I/O. A read-only setting is refused whatever the value. */
export function validateSettingRequest(
  request: unknown,
  options: MowerSettingsOptions,
): ValidSettingRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request))
    throw new EufyError('mower_setting_invalid');
  const { name, value, readBackMs } = request as Record<string, unknown>;
  if (typeof name !== 'string' || !Object.hasOwn(SETTINGS, name))
    throw new EufyError('mower_setting_invalid');
  const setting = SETTINGS[name as MowerSettingName];
  if (!setting.writable) throw new EufyError('mower_setting_read_only');
  if (readBackMs !== undefined && !readBackBound(readBackMs))
    throw new EufyError('mower_setting_invalid');
  if (!acceptable(setting, value, undefined)) throw new EufyError('mower_setting_invalid');
  return {
    name: name as MowerSettingName,
    setting,
    value,
    readBackMs: readBackMs ?? options.readBackMs ?? DEFAULT_READ_BACK_MS,
  };
}

/** The device itself must declare the point writable with this code and type and allow the value. */
export function requireDeclaredSetting(
  setting: SettingClass,
  value: MowerSettingValue,
  schema: readonly MowerDpSchemaEntry[] | undefined,
): void {
  const entry = declared(setting, schema);
  if (!entry || !acceptable(setting, value, entry)) throw new EufyError('mower_setting_undeclared');
}

/**
 * Typed refusals decided on the fresh query taken right before the write. Without a valid current
 * value there is nothing to restore, a running map save refuses like a command, and a setting
 * already at the requested value cannot produce a fresh change. Returns the current value.
 */
export function requireSettingWritable(
  before: MowerDpSnapshot,
  setting: SettingClass,
  value: MowerSettingValue,
): MowerSettingValue {
  const progress = before.dps[MAP_SAVE_DP];
  const current = before.dps[setting.dp];
  if (
    !acceptable(setting, current, undefined) ||
    typeof progress !== 'number' ||
    !Number.isInteger(progress) ||
    progress < 0 ||
    progress > 100
  )
    throw new EufyError('mower_setting_evidence_missing');
  if (progress > 0 && progress < 100) throw new EufyError('mower_setting_map_saving');
  if (current === value) throw new EufyError('mower_setting_already_set');
  return current;
}
