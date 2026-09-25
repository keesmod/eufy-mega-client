import type { MowerTelemetryDefinition } from '../../modular-types.js';

const source = 'docs/research/E15_TELEMETRY_OBSERVATION_2026-09-16.md';
const activity = 'docs/research/E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md';
const missionStatus = 'docs/research/E15_MISSION_STATUS_SCHEMA_2026-09-25.md';

/**
 * Independently observed E15/T2880 definitions, firmware 6.9.28. Schema declarations and
 * repeated local queries confirm battery, Wifi and signal percentage. The DP 107 candidates
 * were derived from one owner-operated cycle and reproduced in three further app-correlated
 * start, pause and return cycles, so they ship as `confirmed`. Defogging shares the `mowing`
 * payload. See both receipts. The mission status definition reads the same data point by its
 * fields, as the official app's own decoder does, so the app's other mowing missions, such as
 * the Box, zone and scheduled tasks, and the idle message, hibernation included, report too.
 * The map-saving phase and the transitional first frame stay withheld. See its receipt.
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
    level: 'confirmed',
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
    level: 'confirmed',
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
    level: 'confirmed',
    source: activity,
    decode: Object.freeze({
      kind: 'wire',
      match: Object.freeze({ 1: 1, 3: 1 }),
      activity: 'returning',
    }),
  }),
  Object.freeze({
    field: 'status',
    dp: '107',
    level: 'confirmed',
    source: missionStatus,
    decode: Object.freeze({
      kind: 'mission_status',
      // The whole lawn, mapping while mowing, temporary, remote-controlled, scheduled whole
      // lawn, scheduled mapping while mowing, selected zone, scheduled zone, drawn box (the
      // app's Box), edge trim and scheduled edge trim.
      mowing: Object.freeze([2, 4, 5, 7, 8, 9, 10, 16, 17, 18, 22]),
      // The recharge mission.
      returning: Object.freeze([1]),
    }),
  }),
]);
