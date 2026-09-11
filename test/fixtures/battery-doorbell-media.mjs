// Independent exact tuples and command evidence: docs/BATTERY_DOORBELLS.md.
export const batteryDoorbellMedia = [
  ['T8213', 91],
  ['T8214', 94],
  ['T8224', 95],
  ['T8223', 96],
].map(([model, type]) => ({
  id: `battery-${model}-h3`,
  family: 'battery',
  model,
  type,
  topology: 'H3',
  admitted: true,
  firmware: '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
}));
