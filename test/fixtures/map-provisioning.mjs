// Invented cloud records. No account, device or captured RTC data.
export function mapLogin() {
  return {
    sid: 'PRIVATE-SID',
    uid: 'PRIVATE-TUYA-UID',
    partnerIdentity: 'synthetic_partner',
    ecode: 'synthetic_ecode',
    domain: {
      mobileApiUrl: 'https://a1.tuyaeu.com',
      mobileMqttsUrl: 'm1.tuyaeu.com',
      mqttsPort: 8883,
    },
  };
}
export function mapRtc() {
  return {
    id: 'PRIVATE-DEVICE',
    password: 'PRIVATE-RTC-PASSWORD',
    p2pId: '',
    p2pConfig: {
      expire: Math.floor(Date.now() / 1000) + 3600,
      preconnect: false,
      ices: [],
      tcpRelay: {
        username: 'synthetic_relay_user',
        credential: 'synthetic_relay_credential',
        domain: 'relay.invalid',
        urls: ['tcp4:relay.invalid:443'],
      },
      session: {
        uid: 'PRIVATE-TUYA-UID',
        devId: 'PRIVATE-DEVICE',
        aesKey: 'PRIVATE-CACHED-KEY',
        sessionId: 'PRIVATE-CACHED-SESSION',
      },
    },
  };
}
