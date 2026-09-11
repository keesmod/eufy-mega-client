// Independent exact model/type evidence, pinned command source in docs/EUFYCAM.md.
export const eufycamMedia = [
  ['T8111', 1],
  ['T8112', 4],
  ['T8113', 8],
  ['T8114', 9],
  ['T8140', 14],
  ['T8142', 15],
  ['T8160', 19],
  ['T8161', 23],
  ['T8600', 24],
  ['T8162', 26],
  ['T8144', 49],
  ['T8172', 89],
].map(([model, type]) => ({
  id: `cam-${model}-h3`,
  family: 'cam',
  model,
  type,
  topology: 'H3',
  admitted: true,
  firmware: '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
}));
