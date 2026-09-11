// Independently authored exact tuples and branch expectations. Sources: docs/INDOOR.md.
export const indoorMedia = [
  ['T8400', 30, 'doorbell'],
  ['T8410', 31, 'indoor-h3'],
  ['T8401', 34, 'indoor'],
  ['T8411', 35, 'indoor'],
  ['T8441', 45, 'indoor'],
  ['T8442', 46, 'indoor'],
  ['T8414', 100, 'indoor'],
  ['T8416', 104, 'indoor-h3'],
  ['T8417', 105, 'doorbell'],
].map(([model, type, liveEnvelope]) => ({
  id: `indoor-${model}-h3`,
  family: 'indoor',
  model,
  type,
  liveEnvelope,
  topology: 'H3',
  admitted: true,
  firmware: '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
}));
