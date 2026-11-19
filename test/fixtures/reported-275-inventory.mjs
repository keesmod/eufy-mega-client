// ha-eufy-cam#275: the shape and order of a reported HomeBase 3 inventory with
// four Entry Sensors T8900, a Keypad T8960 and two doorbell chimes T8026. Models,
// types, firmware, hardware and parent relations follow the report. Serials,
// names, DIDs, channels and params are synthetic, because the report has none.
export const HB = 'SYNTH_T8030_HB';
export const SENSORS = ['SYNTH_T8900_1', 'SYNTH_T8900_2', 'SYNTH_T8900_3', 'SYNTH_T8900_4'];
export const KEYPAD = 'SYNTH_T8960_1';
export const CHIMES = ['SYNTH_T8026_1', 'SYNTH_T8026_2'];
// Synthetic channels. The cameras use 0 to 2, the accessories 16 to 20.
export const CHANNELS = {
  [SENSORS[0]]: 16,
  [SENSORS[1]]: 17,
  [SENSORS[2]]: 18,
  [SENSORS[3]]: 19,
  [KEYPAD]: 20,
};

const row = (fields) => ({
  category: 'eufy_security',
  device_name: `Synthetic ${fields.device_model}`,
  main_hw_version: '',
  main_sw_version: '',
  params: [],
  ...fields,
});
const camera = (device_sn, device_model, device_type, device_channel, main_sw_version) =>
  row({ device_sn, parent_sn: HB, device_model, device_type, device_channel, main_sw_version });
const sensor = (device_sn) =>
  row({
    device_sn,
    parent_sn: HB,
    device_model: 'T8900',
    device_type: 2,
    device_channel: CHANNELS[device_sn],
    main_hw_version: '0.0.1',
  });
const chime = (device_sn) =>
  row({
    device_sn,
    parent_sn: device_sn,
    device_model: 'T8026',
    device_type: 600,
    device_channel: 0,
    main_sw_version: '1.0.2.7',
    main_hw_version: '1.0.0.0',
  });

/** Thirteen rows in the reported order. Rows 10 and 11 are another category. */
export function reportedInventory() {
  return [
    camera('SYNTH_T8170_1', 'T8170', 48, 0, '3.3.5.4'),
    camera('SYNTH_T8170_2', 'T8170', 48, 1, '3.3.5.4'),
    camera('SYNTH_T8214_1', 'T8214', 94, 2, '3.2.7.2'),
    row({
      device_sn: HB,
      parent_sn: HB,
      device_model: 'T8030',
      device_type: 18,
      device_channel: 0,
      main_sw_version: '3.8.8.0',
      p2p_did: 'SYNTHETIC-000275-ABCDE',
      p2p_license: 'SYNTHETIC',
      member: { admin_user_id: 'synthetic-admin', nick_name: 'synthetic' },
      params: [{ param_type: 1176, param_value: '192.168.1.40' }],
    }),
    sensor(SENSORS[0]),
    sensor(SENSORS[1]),
    sensor(SENSORS[2]),
    row({
      device_sn: KEYPAD,
      parent_sn: HB,
      device_model: 'T8960',
      device_type: 11,
      device_channel: CHANNELS[KEYPAD],
      main_sw_version: '0.0.1.7',
      main_hw_version: '0.0.1',
    }),
    chime(CHIMES[0]),
    chime(CHIMES[1]),
    { category: 'other_category', device_sn: 'SYNTH_OTHER_1' },
    { category: 'other_category', device_sn: 'SYNTH_OTHER_2' },
    sensor(SENSORS[3]),
  ];
}
