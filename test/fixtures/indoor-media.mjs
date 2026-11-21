// Independently authored exact tuples and branch expectations. Sources: docs/INDOOR.md.
// T8410C uses the firmware of the ha-eufy-cam#149 type 31 rows, whose model is unconfirmed.
// T8404 uses the camera and owner firmware reported in ha-eufy-cam#283.
const reported = { T8410C: ['3.3.4.4', '3.8.7.4'], T8404: ['1.0.5.4', '3.8.8.0'] };
export const indoorMedia = [
  ['T8400', 30, 'doorbell'],
  ['T8410', 31, 'indoor-h3'],
  ['T8410C', 31, 'indoor-h3'],
  ['T8401', 34, 'indoor'],
  ['T8411', 35, 'indoor'],
  ['T8441', 45, 'indoor'],
  ['T8442', 46, 'indoor'],
  ['T8414', 100, 'indoor'],
  ['T8416', 104, 'indoor-h3'],
  ['T8417', 105, 'doorbell'],
  ['T817L', 10031, 'indoor-h3'],
  // No vendored Indoor live predicate, so the generic HomeBase 3 payload branch.
  ['T8404', 314, 'payload'],
].map(([model, type, liveEnvelope]) => ({
  id: `indoor-${model}-h3`,
  family: 'indoor',
  model,
  type,
  liveEnvelope,
  topology: 'H3',
  admitted: true,
  firmware: reported[model]?.[0] ?? '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: reported[model]?.[1] ?? '3.8.6.0' },
}));
