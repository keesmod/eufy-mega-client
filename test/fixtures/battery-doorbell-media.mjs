// Independent exact tuples and command evidence: docs/BATTERY_DOORBELLS.md.
// T8224/96 is the reported C30 pair from ha-eufy-cam#40. T8210/7 and T8210C/7 rest
// on the public evidence for ha-eufy-cam#198.
export const batteryDoorbellMedia = [
  ['T8213', 91],
  ['T8214', 94],
  ['T8224', 95],
  ['T8223', 96],
  ['T8224', 96, 'battery-T8224-96-h3'],
  ['T8210', 7],
  ['T8210C', 7],
].map(([model, type, id = `battery-${model}-h3`]) => ({
  id,
  family: 'battery',
  model,
  type,
  topology: 'H3',
  admitted: true,
  firmware: '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
}));
