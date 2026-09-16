// Pure decoder from one raw snapshot to typed telemetry. No I/O, no inference from age.
import type {
  MowerActivity,
  MowerDpSchemaEntry,
  MowerDpSnapshot,
  MowerDpValue,
  MowerNetworkKind,
  MowerTelemetry,
  MowerTelemetryDefinition,
  MowerTelemetryField,
  MowerTelemetryLevel,
  MowerTelemetryOptions,
  MowerTelemetryValue,
} from '../../modular-types.js';
import { E15_TELEMETRY_DEFINITIONS } from './definitions.js';

const LEVELS: Record<MowerTelemetryLevel, number> = { hypothesis: 0, observed: 1, confirmed: 2 };
const ACTIVITIES = new Set<MowerActivity>([
  'mowing',
  'paused',
  'returning',
  'charging',
  'docked',
  'idle',
  'error',
  'unknown',
]);
const NETWORKS = new Set<MowerNetworkKind>(['wifi', 'cellular', 'ethernet', 'none']);

function copy<T extends MowerDpValue>(value: T): T {
  return structuredClone(value);
}

/** Type one reported value by the device's own declaration. */
function resolve(id: string, value: MowerDpValue, entry?: MowerDpSchemaEntry): MowerTelemetryValue {
  if (!entry) return { id, value: copy(value), declared: false };
  const result: MowerTelemetryValue = { id, value: copy(value), declared: true, type: entry.type };
  if (entry.code) result.code = entry.code;
  switch (entry.type) {
    case 'bool':
      result.valid = typeof value === 'boolean';
      break;
    case 'value': {
      result.valid =
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (entry.min === undefined || value >= entry.min) &&
        (entry.max === undefined || value <= entry.max);
      if (entry.unit !== undefined) result.unit = entry.unit;
      if (result.valid && entry.scale) result.scaled = (value as number) / 10 ** entry.scale;
      break;
    }
    case 'enum':
      result.valid = typeof value === 'string' && (entry.range?.includes(value) ?? false);
      break;
    case 'string':
      result.valid =
        typeof value === 'string' && (entry.maxlen === undefined || value.length <= entry.maxlen);
      break;
    case 'bitmap':
      result.valid =
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        (entry.maxlen === undefined || value < 2 ** Math.min(entry.maxlen, 31));
      break;
    case 'raw':
      result.valid = typeof value === 'string';
      break;
  }
  return result;
}

function unconfirmed(definitions: MowerTelemetryDefinition[]): MowerTelemetryField<never> {
  const best = definitions
    .map((definition) => definition.level)
    .sort((a, b) => LEVELS[b] - LEVELS[a])[0];
  return best ? { state: 'unconfirmed', level: best } : { state: 'unconfirmed' };
}

function percent(value: MowerDpValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function conforms(value: MowerDpValue, entry?: MowerDpSchemaEntry): boolean {
  return !entry || (resolve('0', value, entry).valid ?? true);
}

type Decoded<T> = { state: 'reported'; value: T } | { state: 'missing' } | { state: 'invalid' };

function decodeOne(
  definition: MowerTelemetryDefinition,
  dps: Record<string, MowerDpValue>,
  schema: Map<string, MowerDpSchemaEntry>,
): Decoded<MowerActivity | number | MowerNetworkKind> {
  const value = dps[definition.dp];
  if (value === undefined) return { state: 'missing' };
  const entry = schema.get(definition.dp);
  if (!conforms(value, entry)) return { state: 'invalid' };
  const decode = definition.decode;
  switch (decode.kind) {
    case 'percent':
    case 'signal_percent': {
      const number = percent(value);
      return number === undefined ? { state: 'invalid' } : { state: 'reported', value: number };
    }
    case 'boolean':
      if (typeof value !== 'boolean') return { state: 'invalid' };
      return { state: 'reported', value: value ? decode.on : decode.off };
    case 'enum': {
      if (typeof value !== 'string' || !Object.hasOwn(decode.values, value))
        return { state: 'invalid' };
      const mapped = decode.values[value]!;
      if (definition.field === 'status' && !ACTIVITIES.has(mapped as MowerActivity))
        return { state: 'invalid' };
      if (definition.field === 'network' && !NETWORKS.has(mapped as MowerNetworkKind))
        return { state: 'invalid' };
      return { state: 'reported', value: mapped };
    }
    case 'signal_dbm':
      return typeof value === 'number' && Number.isInteger(value) && value >= -120 && value <= 0
        ? { state: 'reported', value }
        : { state: 'invalid' };
  }
}

function field<T>(
  name: MowerTelemetryDefinition['field'],
  definitions: MowerTelemetryDefinition[],
  dps: Record<string, MowerDpValue>,
  schema: Map<string, MowerDpSchemaEntry>,
  snapshot: MowerDpSnapshot,
  build: (values: Decoded<never>[], definitions: MowerTelemetryDefinition[]) => T | undefined,
): MowerTelemetryField<T> {
  const own = definitions.filter((definition) => definition.field === name);
  const confirmed = own.filter((definition) => definition.level === 'confirmed');
  if (!confirmed.length) return unconfirmed(own);
  const decoded = confirmed.map((definition) => decodeOne(definition, dps, schema));
  const dp = confirmed.map((definition) => definition.dp);
  if (decoded.some((item) => item.state === 'invalid')) return { state: 'invalid', dp };
  if (decoded.every((item) => item.state === 'missing')) return { state: 'missing', dp };
  const value = build(decoded as Decoded<never>[], confirmed);
  if (value === undefined) return { state: 'invalid', dp };
  return {
    state: 'reported',
    value,
    dp,
    source: snapshot.source,
    observedAt: snapshot.observedAt,
  };
}

/**
 * Decode one snapshot. `schema` types every reported data point by the device's declaration.
 * `definitions` name the typed fields, default the library's E15 registry. Only confirmed
 * definitions produce values. Missing, wrong-typed and unknown values never become typed.
 */
export function decodeMowerTelemetry(
  snapshot: MowerDpSnapshot,
  options: MowerTelemetryOptions = {},
): MowerTelemetry {
  if (
    !snapshot ||
    snapshot.source !== 'local-tuya-3.5' ||
    typeof snapshot.observedAt !== 'string' ||
    !snapshot.dps ||
    typeof snapshot.dps !== 'object'
  )
    throw new TypeError('invalid snapshot');
  const definitions = [...(options.definitions ?? E15_TELEMETRY_DEFINITIONS)];
  const schema = new Map((options.schema ?? []).map((entry) => [entry.id, entry]));
  const dps = copy(snapshot.dps);
  const fields: Record<string, MowerTelemetryValue> = {};
  for (const [id, value] of Object.entries(dps)) fields[id] = resolve(id, value, schema.get(id));
  const first = (values: Decoded<never>[]) =>
    values.find((item) => item.state === 'reported') as
      { state: 'reported'; value: MowerActivity | number | MowerNetworkKind } | undefined;
  return {
    source: snapshot.source,
    observedAt: snapshot.observedAt,
    status: field('status', definitions, dps, schema, snapshot, (values) => {
      const found = first(values);
      return found ? (found.value as MowerActivity) : undefined;
    }),
    battery: field('battery', definitions, dps, schema, snapshot, (values) => {
      const found = first(values);
      return found ? { percent: found.value as number } : undefined;
    }),
    progress: field('progress', definitions, dps, schema, snapshot, (values) => {
      const found = first(values);
      return found ? { percent: found.value as number } : undefined;
    }),
    network: field('network', definitions, dps, schema, snapshot, (values, confirmed) => {
      const result: { kind?: MowerNetworkKind; signalDbm?: number; signalPercent?: number } = {};
      values.forEach((item, index) => {
        if (item.state !== 'reported') return;
        const decode = confirmed[index]!.decode;
        if (decode.kind === 'enum') result.kind ??= item.value as MowerNetworkKind;
        else if (decode.kind === 'signal_dbm') result.signalDbm ??= item.value as number;
        else if (decode.kind === 'signal_percent') result.signalPercent ??= item.value as number;
      });
      return Object.keys(result).length ? result : undefined;
    }),
    fields,
    dps,
  };
}
