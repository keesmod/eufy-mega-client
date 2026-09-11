// Independently authored exact tuples. Attributed command evidence: docs/FLOODLIGHT.md.
export const floodlightMedia = [
  ['T8425', 47, 'doorbell'],
  ['T8426', 87, 'floodlight'],
].map(([model, type, liveEnvelope]) => ({
  id: `floodlight-${model}-h3`,
  family: 'floodlight',
  model,
  type,
  liveEnvelope,
  topology: 'H3',
  admitted: true,
  firmware: '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
}));
