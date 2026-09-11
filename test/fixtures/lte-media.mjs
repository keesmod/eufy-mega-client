// Synthetic Wi-Fi/H3 tuple only. Cellular transport is not evidenced: docs/LTE.md.
export const lteMedia = [
  {
    id: 'lte-T86P2-wifi-h3',
    family: 'lte',
    model: 'T86P2',
    type: 111,
    liveEnvelope: 'doorbell',
    topology: 'H3',
    admitted: true,
    firmware: '1.2.3',
    owner: { model: 'T8030', type: 18, firmware: '3.8.6.0' },
  },
];
