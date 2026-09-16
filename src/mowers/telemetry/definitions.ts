import type { MowerTelemetryDefinition } from '../../modular-types.js';

/**
 * E15 telemetry definitions shipped with the library. Only `confirmed` entries produce typed
 * values. No E15 data point has permitted, independently reproduced evidence yet, so this
 * registry is empty and every typed field reports `unconfirmed`. See docs/MOWER_TELEMETRY.md.
 */
export const E15_TELEMETRY_DEFINITIONS: readonly MowerTelemetryDefinition[] = Object.freeze([]);
