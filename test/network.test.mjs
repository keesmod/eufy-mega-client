import test from 'node:test';
import assert from 'node:assert/strict';
import { lanAddress } from '../dist/network.js';
test('Docker LAN connection uses fresh Mega network metadata, never firmware strings or public endpoints', () => {
  assert.equal(
    lanAddress({
      params: [{ param_type: 1176, param_value: '192.168.1.20' }],
      ip_addr: '203.0.113.5',
    }),
    '192.168.1.20',
  );
  assert.equal(lanAddress({ params: [], ip_addr: '10.1.2.3' }), '10.1.2.3');
  for (const ip_addr of [
    '127.0.0.1',
    '169.254.1.1',
    '203.0.113.5',
    '192.168.1.20:8080',
    '192.168.1.999',
  ])
    assert.equal(lanAddress({ ip_addr, main_sw_version: '3.8.6.0', params: [] }), undefined);
});
