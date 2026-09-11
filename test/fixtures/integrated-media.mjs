// Synthetic inputs, not captured hardware. Sources and limits: docs/INTEGRATED_CAMERAS.md.
export const integratedMedia = [
  ['T8530', 55, 'int'],
  ['T8790', 90, 'smartdrop'],
  ['T85V0', 203, 'payload'],
].map(([model, type, liveEnvelope]) => ({
  id: `integrated-${model}-h3`,
  family: 'integrated',
  model,
  type,
  liveEnvelope,
  topology: 'H3',
  admitted: true,
  firmware: '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
}));
