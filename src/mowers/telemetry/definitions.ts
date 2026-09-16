import type { MowerTelemetryDefinition } from '../../modular-types.js';

const source = 'docs/research/E15_TELEMETRY_OBSERVATION_2026-09-16.md';

/**
 * Independently observed E15/T2880 definitions, firmware 6.9.28. Schema declarations and
 * repeated local queries confirm battery, Wifi and signal percentage. No activity or mowing
 * progress value was received. Unobserved network kinds remain unmapped. See the receipt.
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
]);
