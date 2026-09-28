import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { P2PClientProtocol } from '../dist/vendor/p2p/session.js';
import { getLocalBroadcastAddresses } from '../dist/vendor/p2p/utils.js';
import { P2PConnectionType } from '../dist/vendor/p2p/types.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { discover } from '../dist/discovery.js';
import { Station } from '../dist/vendor/http/index.js';
import { EufyMegaClient } from '../dist/index.js';

const v4 = (address, netmask, internal = false) => ({
  address,
  netmask,
  family: 'IPv4',
  internal,
  mac: '00:00:00:00:00:00',
  cidr: null,
});
const interfaces = {
  lo: [v4('127.0.0.1', '255.0.0.0', true)],
  docker0: [v4('172.17.0.1', '255.255.0.0')],
  eth0: [
    v4('192.168.1.20', '255.255.255.0'),
    { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false },
  ],
  tailscale0: [v4('100.64.0.5', '255.255.255.255')],
  p2p: [v4('10.0.0.1', '255.255.255.254')],
  broken: [v4('192.168.300.1', '255.255.255.0'), v4('10.1.2.3', 'invalid')],
  wide: [v4('10.20.30.40', '255.240.0.0')],
};

test('directed broadcasts cover every external IPv4 interface and skip point-to-point links', () => {
  assert.deepEqual(getLocalBroadcastAddresses(interfaces), [
    '172.17.255.255',
    '192.168.1.255',
    '10.31.255.255',
  ]);
  assert.deepEqual(getLocalBroadcastAddresses(interfaces, 2), ['172.17.255.255', '192.168.1.255']);
  assert.deepEqual(getLocalBroadcastAddresses({}), []);
});

function lookupProtocol(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(os, 'networkInterfaces', () => interfaces);
  const protocol = Object.create(P2PClientProtocol.prototype);
  const sent = [];
  protocol.rawStation = { station_sn: 'HB', p2p_did: 'ABCDEFG-012345-HIJKL' };
  protocol.LOCAL_LOOKUP_RETRY_TIMEOUT = 1000;
  protocol.localLookupByAddress = async (address) => {
    assert.equal(address.port, 32108);
    sent.push(address.host);
  };
  return { protocol, sent };
}

test('the known station address is asked first and broadcasts follow when it stays silent', (t) => {
  const { protocol, sent } = lookupProtocol(t);
  try {
    protocol.localLookup('192.168.1.50');
    assert.deepEqual(sent, ['192.168.1.50']);
    t.mock.timers.tick(1000);
    assert.deepEqual(sent.slice(1), [
      '192.168.1.50',
      '172.17.255.255',
      '192.168.1.255',
      '10.31.255.255',
    ]);
    t.mock.timers.tick(1000);
    assert.equal(sent.length, 9);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
  }
});

test('without a known address the first lookup already goes to every interface', (t) => {
  const { protocol, sent } = lookupProtocol(t);
  try {
    protocol.localLookup(undefined);
    assert.deepEqual(sent, ['172.17.255.255', '192.168.1.255', '10.31.255.255']);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
  }
});

test('lookup keeps the preferred inventory address ahead of a learned one', (t) => {
  const { protocol, sent } = lookupProtocol(t);
  protocol.connectionType = P2PConnectionType.ONLY_LOCAL;
  protocol.MAX_LOOKUP_TIMEOUT = 20000;
  protocol.preferredIPAddress = '192.168.1.60';
  protocol.localIPAddress = '192.168.1.70';
  try {
    protocol.lookup();
    assert.deepEqual(sent, ['192.168.1.60']);
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    protocol.preferredIPAddress = undefined;
    protocol.lookup();
    assert.deepEqual(sent.slice(1), ['192.168.1.70']);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
  }
});

const lookupResponse = (did) => {
  const [prefix, number, suffix] = did.split('-');
  const packet = Buffer.alloc(24);
  packet.set([0xf1, 0x41], 0);
  packet.write(prefix, 4, 'utf8');
  packet.writeUInt32BE(Number(number), 12);
  packet.write(suffix, 16, 'utf8');
  return packet;
};

test('only the station answering with its own DID ends the lookup and is connected', (t) => {
  const { protocol } = lookupProtocol(t);
  const connects = [];
  let found = 0;
  protocol.connected = false;
  protocol._connect = (address, did) => connects.push([address.host, did]);
  protocol.on('station found', () => found++);
  protocol.lookupTimeout = setTimeout(() => {}, 20000);
  protocol.localLookup('192.168.1.50');
  try {
    // Another Eufy device on the LAN answers the broadcast first.
    protocol.handleMsg(lookupResponse('OTHERDV-000001-ZZZZZ'), { address: '192.168.1.9', port: 1 });
    assert.notEqual(protocol.lookupTimeout, undefined);
    assert.notEqual(protocol.localLookupRetryTimeout, undefined);
    assert.equal(found, 0);
    assert.deepEqual(connects, []);
    protocol.handleMsg(lookupResponse('ABCDEFG-012345-HIJKL'), {
      address: '192.168.1.50',
      port: 2,
    });
    assert.equal(protocol.lookupTimeout, undefined);
    assert.equal(protocol.localLookupRetryTimeout, undefined);
    assert.equal(found, 1);
    assert.deepEqual(connects, [['192.168.1.50', 'ABCDEFG-012345-HIJKL']]);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
  }
});

function connectionFixture({
  address = false,
  answer = ['station found', 'connect', 'encryption ready'],
} = {}) {
  const t = new DeviceTransport();
  let connected = false;
  const calls = { connect: 0, close: 0 };
  const station = Object.assign(new EventEmitter(), {
    getSerial: () => 'HB',
    hasProperty: () => false,
    isConnected: () => connected,
    getCameraInfo: () => {},
    connect: async () => {
      calls.connect++;
      for (const event of answer) {
        if (event === 'connect') connected = true;
        if (event === 'encryption ready') station.emit(event, station, 'lan-derived');
        else station.emit(event, station);
      }
    },
    close: async () => {
      calls.close++;
      connected = false;
    },
    dispose: async () => {},
  });
  t.stations.set('HB', station);
  t.stationAddresses.set('HB', address);
  t.raw.set('HB', { device_sn: 'HB', device_model: 'T8030', device_type: 18, parent_sn: '' });
  t.bind(station);
  return { t, station, calls };
}

test('a station connection reports each stage once, in order, without identifiers', async () => {
  const { t, station } = connectionFixture({ address: true });
  const stages = [];
  try {
    await t.connect('HB', undefined, (progress) => stages.push(progress));
    assert.deepEqual(
      stages.map(({ elapsedMs, ...rest }) => rest),
      [
        { stage: 'lookup', inventoryAddress: true },
        { stage: 'station_found' },
        { stage: 'session_open' },
        { stage: 'encryption_ready' },
      ],
    );
    for (const { elapsedMs } of stages) assert.ok(Number.isInteger(elapsedMs) && elapsedMs >= 0);
    assert.equal(t.state('HB').connected, true);
    assert.equal(station.listenerCount('station found'), 0);
    // An already connected station resolves without stages.
    await t.connect('HB', undefined, (progress) => stages.push(progress));
    assert.equal(stages.length, 4);
  } finally {
    await t.close();
  }
});

test('a silent station ends at the lookup stage and says the inventory had no address', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { t: transport, station } = connectionFixture({ answer: [] });
  const stages = [];
  try {
    const connecting = transport.connect('HB', undefined, (progress) => stages.push(progress));
    t.mock.timers.tick(20000);
    await assert.rejects(connecting, { code: 'device_request_timeout' });
    assert.deepEqual(
      stages.map(({ stage, inventoryAddress }) => ({ stage, inventoryAddress })),
      [{ stage: 'lookup', inventoryAddress: false }],
    );
    assert.equal(station.listenerCount('station found'), 0);
    assert.equal(station.listenerCount('connect'), 0);
  } finally {
    t.mock.timers.reset();
    await transport.close();
  }
});

test('a station found without a handshake ends at station_found', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { t: transport } = connectionFixture({ answer: ['station found'] });
  const stages = [];
  try {
    const connecting = transport.connect('HB', undefined, (progress) =>
      stages.push(progress.stage),
    );
    t.mock.timers.tick(20000);
    await assert.rejects(connecting, { code: 'device_request_timeout' });
    assert.deepEqual(stages, ['lookup', 'station_found']);
  } finally {
    t.mock.timers.reset();
    await transport.close();
  }
});

test('a consumer cancelling at the lookup stage starts no session behind the close', async () => {
  const { t, station, calls } = connectionFixture();
  const controller = new AbortController();
  try {
    await assert.rejects(
      t.connect('HB', controller.signal, (progress) => {
        if (progress.stage === 'lookup') controller.abort();
      }),
      { code: 'cancelled' },
    );
    assert.deepEqual(calls, { connect: 0, close: 1 });
    assert.equal(station.listenerCount('station found'), 0);
  } finally {
    await t.close();
  }
});

test('a signal the runtime refuses leaves no stage listeners behind', async () => {
  const { t, station } = connectionFixture();
  try {
    for (let i = 0; i < 3; i++) await assert.rejects(t.connect('HB', { aborted: false }, () => {}));
    assert.equal(station.listenerCount('station found'), 0);
    assert.equal(station.listenerCount('connect'), 0);
    assert.equal(t.connecting.size, 0);
  } finally {
    await t.close();
  }
});

test('a close during the socket bind starts no lookup for the ended attempt', async () => {
  const protocol = Object.create(P2PClientProtocol.prototype);
  let bound;
  let lookups = 0;
  protocol.rawStation = { station_sn: 'HB', p2p_did: 'ABCDEFG-012345-HIJKL' };
  protocol.connectionType = P2PConnectionType.ONLY_LOCAL;
  protocol.connected = false;
  protocol.connecting = false;
  protocol.binded = false;
  protocol.listeningPort = 0;
  protocol.socket = {
    bind: (_port, callback) => (bound = callback),
    setRecvBufferSize() {},
    setBroadcast() {},
    getRecvBufferSize: () => 0,
  };
  protocol.lookup = () => lookups++;
  await protocol.connect();
  // close() resets the attempt before the bind completes.
  protocol.connecting = false;
  protocol.terminating = true;
  bound();
  assert.equal(lookups, 0);
  assert.equal(protocol.binded, true);
  await protocol.connect();
  assert.equal(lookups, 1);
});

test('a platform that refuses the interface list gives no broadcast targets', (t) => {
  t.mock.method(os, 'networkInterfaces', () => {
    throw new Error('refused');
  });
  assert.deepEqual(getLocalBroadcastAddresses(), []);
});

test('without any address and without an interface list no lookup is sent and nothing throws', (t) => {
  const { protocol, sent } = lookupProtocol(t);
  t.mock.method(os, 'networkInterfaces', () => {
    throw new Error('refused');
  });
  try {
    protocol.localLookup(undefined);
    // The retry stays armed, so an interface list refused only briefly is asked again.
    assert.notEqual(protocol.localLookupRetryTimeout, undefined);
    t.mock.timers.tick(1000);
    assert.deepEqual(sent, []);
    assert.notEqual(protocol.localLookupRetryTimeout, undefined);
    protocol.localLookup('192.168.1.50');
    assert.deepEqual(sent, ['192.168.1.50']);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
  }
});

test('without broadcast targets the earlier first-interface guess still applies, never a bare 255', (t) => {
  const { protocol, sent } = lookupProtocol(t);
  const point = { tailscale0: [v4('100.64.0.5', '255.255.255.255')] };
  try {
    t.mock.method(os, 'networkInterfaces', () => point);
    protocol.localLookup(undefined);
    assert.deepEqual(sent, ['100.64.0.255']);
    protocol._clearLocalLookupRetryTimeout();
    t.mock.method(os, 'networkInterfaces', () => ({}));
    protocol.localLookup(undefined);
    t.mock.timers.tick(1000);
    assert.deepEqual(sent, ['100.64.0.255']);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
  }
});

test('inventoryAddress follows the address a station session was created with', async (t) => {
  const addresses = [];
  t.mock.method(Station, 'getInstance', async (_provider, wire, address) => {
    addresses.push(address);
    const station = Object.assign(new EventEmitter(), {
      getSerial: () => wire.station_sn,
      setConnectionType() {},
      initialize() {},
      update() {},
      dispose: async () => {},
      hasProperty: () => false,
      hasCommand: () => false,
      isConnected: () => false,
      getCameraInfo() {},
      connect: async () => {},
      close: async () => {},
    });
    return station;
  });
  const row = (params) => ({
    category: 'eufy_security',
    device_sn: 'T8030_OWNER',
    parent_sn: '',
    device_model: 'T8030',
    device_type: 18,
    main_sw_version: '3.8.7.4',
    p2p_did: 'synthetic',
    member: { admin_user_id: 'synthetic' },
    params,
  });
  const lookup = async (transport) => {
    const controller = new AbortController();
    let seen;
    await assert.rejects(
      transport.connect('T8030_OWNER', controller.signal, (progress) => {
        seen = progress.inventoryAddress;
        controller.abort();
      }),
      { code: 'cancelled' },
    );
    return seen;
  };
  const transport = new DeviceTransport();
  try {
    let inventory = discover([row([{ param_type: 1176, param_value: '192.168.1.20' }])]);
    await transport.load(inventory.raw, inventory);
    assert.equal(await lookup(transport), true);
    // The address leaves the inventory, the existing session keeps the one it was created with.
    inventory = discover([row([])]);
    await transport.load(inventory.raw, inventory);
    assert.equal(await lookup(transport), true);
    assert.deepEqual(addresses, ['192.168.1.20']);
  } finally {
    await transport.close();
  }
  const fresh = new DeviceTransport();
  try {
    const inventory = discover([row([])]);
    await fresh.load(inventory.raw, inventory);
    assert.equal(await lookup(fresh), false);
  } finally {
    await fresh.close();
  }
});

test('a failing progress consumer never alters the connection', async () => {
  const { t } = connectionFixture();
  try {
    await t.connect('HB', undefined, () => {
      throw new Error('consumer failure');
    });
    assert.equal(t.state('HB').connected, true);
  } finally {
    await t.close();
  }
});

test('connectStation accepts a signal or options with a progress callback', async () => {
  const calls = [];
  const transport = {
    connect: async (...args) => calls.push(args),
    state: (id) => ({ id, connected: true }),
  };
  const client = { deviceTransport: async () => transport };
  const signal = new AbortController().signal;
  const onProgress = () => {};
  await EufyMegaClient.prototype.connectStation.call(client, 'HB');
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', signal);
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', { signal, onProgress });
  assert.deepEqual(calls, [
    ['HB', undefined, undefined],
    ['HB', signal, undefined],
    ['HB', signal, onProgress],
  ]);
});
