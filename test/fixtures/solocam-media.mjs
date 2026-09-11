// Independently authored exact tuples. Attributed command evidence: docs/SOLOCAM.md.
export const solocamMedia = [
  ['T8130', 32, 'solo'],
  ['T8131', 33, 'solo'],
  ['T8170', 48, 'doorbell'],
  ['T8122', 60, 'solo'],
  ['T8123', 61, 'solo'],
  ['T8124', 62, 'solo'],
  ['T8134', 63, 'solo'],
  ['T8B00', 64, 'solo'],
  ['T8171', 88, 'doorbell'],
  ['T8173', 98, 'doorbell'],
].map(([model, type, liveEnvelope]) => ({
  id: `solo-${model}-h3`,
  family: 'solo',
  model,
  type,
  liveEnvelope,
  topology: 'H3',
  admitted: true,
  firmware: '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
}));
