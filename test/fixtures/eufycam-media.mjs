// Independent exact model/type evidence, pinned command source in docs/EUFYCAM.md.
// Reported camera and owner firmware: ha-eufy-cam#66 (T8113-V), ha-eufy-cam#149 (T8160-C)
// and ha-eufy-cam#236 (T8142-Z).
const reported = {
  'T8113-V': ['3.0.7.8', '3.8.7.4'],
  'T8160-C': ['1.5.8.6', '3.8.7.4'],
  'T8142-Z': ['3.3.8', '3.8.7.4'],
};
export const eufycamMedia = [
  ['T8111', 1],
  ['T8112', 4],
  ['T8113', 8],
  ['T8113-V', 8],
  ['T8114', 9],
  ['T8140', 14],
  ['T8142', 15],
  ['T8142-Z', 15],
  ['T8160', 19],
  ['T8160-C', 19],
  ['T8161', 23],
  ['T8600', 24],
  ['T8162', 26],
  ['T8144', 49],
  ['T8172', 89],
  // Remaining-catalogue delivery under #39, documented separately from the original twelve.
  ['T8110', 10035, 'solo'],
].map(([model, type, liveEnvelope]) => ({
  id: `cam-${model}-h3`,
  family: 'cam',
  ...(liveEnvelope ? { liveEnvelope } : {}),
  model,
  type,
  topology: 'H3',
  admitted: true,
  firmware: reported[model]?.[0] ?? '1.2.3',
  owner: { model: 'T8030', type: 18, firmware: reported[model]?.[1] ?? '3.8.6.0' },
}));
