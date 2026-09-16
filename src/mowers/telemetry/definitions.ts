import type { MowerTelemetryDefinition } from '../../modular-types.js';

const source = 'docs/research/E15_TELEMETRY_OBSERVATION_2026-09-16.md';
const activity = 'docs/research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md';

/**
 * Independently observed E15/T2880 definitions, firmware 6.9.28. Schema declarations and
 * repeated local queries confirm battery, Wifi and signal percentage. The DP 107 candidates
 * come from one owner-operated start, pause and return cycle. They stay `observed` and are
 * withheld until three app-correlated reproductions exist. See both receipts.
 */
export const E15_TELEMETRY_DEFINITIONS: readonly MowerTelemetryDefinition[] = Object.freeze([
  Object.freeze({
    field: 'battery',
    dp: '8',
    level: 'confirmed',
    source,
    decode: Object.freeze({ kind: 'percent' }),
  }),
  Object.freeze({
    field: 'network',
    dp: '134',
    level: 'confirmed',
    source,
    decode: Object.freeze({ kind: 'enum', values: Object.freeze({ Wifi: 'wifi' }) }),
  }),
  Object.freeze({
    field: 'network',
    dp: '109',
    level: 'confirmed',
    source,
    decode: Object.freeze({ kind: 'signal_percent' }),
  }),
  Object.freeze({
    field: 'status',
    dp: '107',
    level: 'observed',
    source: activity,
    decode: Object.freeze({
      kind: 'wire',
      match: Object.freeze({ 1: 2, 3: 1 }),
      activity: 'mowing',
    }),
  }),
  Object.freeze({
    field: 'status',
    dp: '107',
    level: 'observed',
    source: activity,
    decode: Object.freeze({
      kind: 'wire',
      match: Object.freeze({ 1: 2, 3: 2 }),
      activity: 'paused',
    }),
  }),
  Object.freeze({
    field: 'status',
    dp: '107',
    level: 'observed',
    source: activity,
    decode: Object.freeze({
      kind: 'wire',
      match: Object.freeze({ 1: 1, 3: 1 }),
      activity: 'returning',
    }),
  }),
]);
