// Independently authored synthetic inventory. Sources and limits: docs/FAMILY_FIXTURES.md.
// No row is a hardware-support claim. Unknown firmware is not a tested firmware version.
const row = (id, family, model, type, topology, command, admitted = false, firmware = '1.0.0') => ({
  id,
  family,
  model,
  type,
  topology,
  command,
  admitted,
  firmware,
  firmwareEvidence: 'synthetic branch input, hardware firmware unknown',
  owner:
    topology === 'H3'
      ? { model: 'T8030', type: 18, firmware: '3.8.6.0' }
      : topology === 'W'
        ? { model, type, firmware }
        : topology === 'N'
          ? { model: 'T8N00', type: 300, firmware: 'unknown' }
          : { model: 'UNKNOWN_OWNER', type: -1, firmware: 'unknown' },
});
export const families = [
  row('cam-h3', 'cam', 'T8160', 19, 'H3', 'payload', true),
  row('cam-s220-h3', 'cam', 'T8142', 15, 'H3', 'payload', true),
  row('solo-h3', 'solo', 'T8134', 63, 'H3', 'doorbell', true),
  row('battery-h3', 'battery', 'T8213', 91, 'H3', 'payload', true),
  { ...row('indoor-wifi', 'indoor', 'T8400', 30, 'W', 'doorbell'), descriptor: true },
  row('wired-wifi', 'wired', 'T8200', 5, 'W', 'doorbell'),
  row('flood-wifi', 'flood', 'T8423', 38, 'W', 'doorbell'),
  row('wall-wifi', 'wall', 'T84A1', 151, 'W', 'doorbell'),
  row('garage-wifi', 'garage', 'T8452', 132, 'W', 'doorbell'),
  row('integrated-h3', 'integrated', 'T8790', 90, 'H3', 'payload'),
  row('cellular', 'lte', 'T8150', 110, 'L', null),
  row('poe-nvr', 'nvr', 'T8E00', 301, 'N', null),
  row('unknown', 'unresolved', 'UNKNOWN_MODEL', 101, 'Unknown', null),
];
// Model/type stays constant. Only the recorded owner firmware branch changes.
export const firmwareProfiles = ['2.0.9.6', '2.0.9.7'].map((firmware, index) => ({
  ...row(`cam-h2-${firmware}`, 'cam', 'T8142', 15, 'H1/E/2', index ? 'payload' : 'int'),
  owner: { model: 'T8010', type: 0, firmware },
}));
export function inventory(
  profile,
  { parent = profile.topology === 'H3' ? 'T8030_SYNTHETIC' : '', owner = profile.owner } = {},
) {
  const camera = {
    category: 'eufy_security',
    device_sn: `${profile.model}_SYNTHETIC`,
    parent_sn: parent,
    device_model: profile.model,
    device_type: profile.type,
    device_name: 'Synthetic camera',
    device_channel: 2,
    main_sw_version: profile.firmware,
    params: [],
  };
  const base = {
    category: 'eufy_security',
    device_sn: parent,
    parent_sn: '',
    device_model: owner.model,
    device_type: owner.type,
    device_name: 'Synthetic owner',
    main_sw_version: owner.firmware,
  };
  return { camera, rows: parent ? [base, camera] : [camera] };
}
