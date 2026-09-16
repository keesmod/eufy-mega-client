// Independently observed product declarations, recreated in the documented cloud shape.
// Provenance: docs/research/E15_TELEMETRY_OBSERVATION_2026-09-16.md.
// Values are synthetic. No captures, identifiers or mower-fork tables are included.
export const e15Schema = [
  {
    id: 8,
    code: 'battery_percentage',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' },
  },
  {
    id: 109,
    code: 'wifi_signal_strength',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' },
  },
  {
    id: 134,
    code: 'net_media_type',
    mode: 'ro',
    type: 'obj',
    property: { type: 'enum', range: ['None', 'Wifi', 'Cellular'] },
  },
  // Declared raw without an internal layout. Provenance: E15_ROBOT_STATUS_CONTRACT_2026-09-16.md.
  { id: 107, code: 'robot_status', mode: 'ro', type: 'raw' },
];

export const e15Dps = { 8: 73, 109: 54, 134: 'Wifi' };
