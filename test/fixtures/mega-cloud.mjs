import assert from 'node:assert/strict';
import { createECDH, createHmac } from 'node:crypto';
import {
  presetDecrypt,
  presetEncrypt,
  megaDecryptBody,
  megaEncryptBody,
} from '../../dist/crypto.js';

export function cloudFixture({ verify = false, lock = false, inventory, malformed = false } = {}) {
  const credentials = { email: 'test@example.invalid', password: 'fixture-secret', country: 'NL' };
  const calls = [],
    diagnostics = [];
  let stored,
    identity,
    verified = false;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const fetch = async (url, init) => {
    const u = new URL(url),
      h = init.headers;
    calls.push({ host: u.hostname, path: u.pathname, headers: h, body: init.body });
    assert.equal(u.protocol, 'https:');
    assert.match(u.hostname, /\.eufy\.com$/);
    assert.equal(init.redirect, 'error');
    if (u.pathname === '/passport/estimate_domain')
      return response({ code: 0, data: { domain: 'mega-eu-pr.eufy.com' } });
    const bootstrap = u.pathname === '/openapi/oauth/key/exchange';
    const signedValue = bootstrap ? JSON.parse(init.body).client_public_key : init.body;
    const signingKey = bootstrap
      ? '2500a7d5617812f9d52515b2c8f20a3d'
      : identity.shared.slice(0, 32);
    const signature = createHmac('sha256', Buffer.from(signingKey))
      .update([h['x-request-ts'], h['x-request-once'], signedValue].join('+'))
      .digest('hex');
    assert.equal(h['x-signature'], signature);
    if (bootstrap) {
      const server = createECDH('prime256v1');
      server.generateKeys();
      const pub = presetDecrypt(signedValue);
      identity = { shared: server.computeSecret(Buffer.from(pub, 'hex')).toString('hex') };
      return response({
        code: 0,
        data: { server_public_key: presetEncrypt(server.getPublicKey('hex')) },
      });
    }
    const key = Buffer.from(identity.shared.slice(0, 32), 'hex');
    const payload = JSON.parse(megaDecryptBody(init.body, key));
    const encrypted = (data) =>
      response({ code: 0, data: megaEncryptBody(JSON.stringify(data), key) });
    if (u.pathname === '/passport/login') {
      if (lock) return response({ code: 100028 });
      if (payload.verify_code === '123456') verified = true;
      return encrypted({
        auth_token: 'secret-auth-token',
        user_id: 'fixture-user',
        token_expires_at: Math.floor(Date.now() / 1000) + 3600,
        fa_info: { step: verify && !verified ? 26052 : 0 },
      });
    }
    if (u.pathname === '/app/sendmsg/verify_code') {
      assert.equal(payload.biz_type, 1004);
      return encrypted({});
    }
    assert.equal(h.authorization, 'secret-auth-token');
    if (u.pathname === '/app/house/get_devs_list')
      return encrypted(
        malformed
          ? {}
          : {
              devices: inventory ?? [
                {
                  category: 'eufy_security',
                  device_sn: 'HBTEST',
                  parent_sn: '',
                  device_model: 'T8030',
                  device_name: 'Base',
                  device_type: 18,
                  main_sw_version: '3.8.6.0',
                },
                {
                  category: 'eufy_security',
                  device_sn: 'CAMTEST',
                  parent_sn: 'HBTEST',
                  device_model: 'T8160',
                  device_name: 'Camera',
                  device_type: 19,
                  main_sw_version: '3.4.3.0',
                },
              ],
            },
      );
    throw new Error('unexpected route');
  };
  const store = {
    load: async () => stored,
    save: async (s) => {
      stored = structuredClone(s);
    },
  };
  const options = {
    credentials,
    sessionStore: store,
    fetch,
    minRequestIntervalMs: 0,
    diagnostics: (e) => diagnostics.push(e),
  };
  return { options, calls, diagnostics, session: () => stored };
}
