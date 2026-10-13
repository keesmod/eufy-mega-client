import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { P2PClientProtocol } from '../dist/vendor/p2p/session.js';
import { getLocalBroadcastAddresses } from '../dist/vendor/p2p/utils.js';
import { P2PConnectionType, RequestMessageType } from '../dist/vendor/p2p/types.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { discover } from '../dist/discovery.js';
import { Station } from '../dist/vendor/http/index.js';
import { EufyMegaClient } from '../dist/index.js';
import { hostSubnetContains } from '../dist/network.js';

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
  lookup,
} = {}) {
  const t = new DeviceTransport();
  let connected = false;
  const calls = { connect: 0, close: 0 };
  // Each read of the session's lookup observation, with the DIDs it was given.
  const reads = [];
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
    getLookupObservation: (accountDids) => {
      reads.push({ accountDids: [...accountDids].sort(), closes: calls.close });
      return typeof lookup === 'function' ? lookup(accountDids) : lookup;
    },
  });
  t.stations.set('HB', station);
  t.stationAddresses.set('HB', address);
  t.raw.set('HB', { device_sn: 'HB', device_model: 'T8030', device_type: 18, parent_sn: '' });
  t.bind(station);
  return { t, station, calls, reads };
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
  const onLookup = () => {};
  await EufyMegaClient.prototype.connectStation.call(client, 'HB');
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', signal);
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', { signal, onProgress });
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', { onLookup });
  assert.deepEqual(calls, [
    ['HB', undefined, undefined, undefined],
    ['HB', signal, undefined, undefined],
    ['HB', signal, onProgress, undefined],
    ['HB', undefined, undefined, onLookup],
  ]);
});

const OWN_DID = 'ABCDEFG-012345-HIJKL';
const ACCOUNT_DID = 'ACCOUNT-000002-AAAAA';
const FOREIGN_DID = 'OTHERDV-000001-ZZZZZ';
const INVENTORY_IP = '192.168.1.50';
const from = (address) => ({ address, port: 32108 });
const otherHeader = Buffer.from([0xf1, 0x83, 0, 0]);
// A lookup reply with raw DID parts, so padding, NULs and case arrive as sent.
const lookupPacket = (prefix, number, suffix) => {
  const packet = Buffer.alloc(24);
  packet.set([0xf1, 0x41], 0);
  packet.write(prefix, 4, 8, 'utf8');
  packet.writeUInt32BE(number, 12);
  packet.write(suffix, 16, 8, 'utf8');
  return packet;
};
const emptyLookup = {
  rounds: 0,
  broadcastTargets: 0,
  broadcastEnabled: false,
  sendErrors: 0,
  datagrams: 0,
  otherHeaders: 0,
  ownReplies: 0,
  accountReplies: 0,
  foreignReplies: 0,
  nearReplies: 0,
  inventoryReply: 'none',
};

// A running lookup on a bare session with an inventory address.
function runningLookup(t, { maxLookupMs = 20000 } = {}) {
  const { protocol, sent } = lookupProtocol(t);
  const connects = [];
  protocol.connectionType = P2PConnectionType.ONLY_LOCAL;
  protocol.MAX_LOOKUP_TIMEOUT = maxLookupMs;
  protocol.connected = false;
  protocol.preferredIPAddress = INVENTORY_IP;
  protocol._connect = (address, did) => connects.push([address.host, did]);
  protocol.lookup();
  t.after(() => {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
  });
  return { protocol, sent, connects };
}

test('the lookup observation counts an own reply on the first round without changing the lookup', (t) => {
  const { protocol, sent, connects } = runningLookup(t);
  let found = 0;
  protocol.on('station found', () => found++);
  assert.deepEqual(sent, [INVENTORY_IP]);
  protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
  assert.equal(found, 1);
  assert.deepEqual(connects, [[INVENTORY_IP, OWN_DID]]);
  assert.equal(protocol.lookupTimeout, undefined);
  assert.equal(protocol.localLookupRetryTimeout, undefined);
  // The lookup has ended, so later datagrams are not counted.
  protocol.handleMsg(otherHeader, from(INVENTORY_IP));
  assert.deepEqual(protocol.getLookupObservation(new Set()), {
    ...emptyLookup,
    rounds: 1,
    datagrams: 1,
    ownReplies: 1,
    ownRound: 0,
    inventoryReply: 'own',
  });
  // Reading drops the observation and the DIDs it held.
  assert.equal(protocol.lookupObservation, undefined);
  assert.equal(protocol.getLookupObservation(new Set()), undefined);
});

test('the lookup observation classifies replies by DID and names the round of a later own reply', (t) => {
  const { protocol, sent, connects } = runningLookup(t);
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  const broadcasts = ['172.17.255.255', '192.168.1.255', '10.31.255.255'];
  assert.deepEqual(sent, [INVENTORY_IP, INVENTORY_IP, ...broadcasts, INVENTORY_IP, ...broadcasts]);
  protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
  protocol.handleMsg(lookupResponse(ACCOUNT_DID), from(INVENTORY_IP));
  protocol.handleMsg(lookupResponse(ACCOUNT_DID), from('192.168.1.10'));
  // Near DIDs: space padding, an internal NUL followed by data, and lower case.
  protocol.handleMsg(lookupPacket('ABCDEFG ', 12345, ' HIJKL'), from('192.168.1.11'));
  protocol.handleMsg(lookupPacket('ABCDEFG', 12345, 'HIJKL\0ZZ'), from('192.168.1.12'));
  protocol.handleMsg(lookupPacket('abcdefg', 12345, 'hijkl'), from('192.168.1.13'));
  protocol.handleMsg(otherHeader, from('192.168.1.14'));
  // None of them ends the lookup or is connected, as before.
  assert.deepEqual(connects, []);
  assert.notEqual(protocol.lookupTimeout, undefined);
  assert.notEqual(protocol.localLookupRetryTimeout, undefined);
  protocol.handleMsg(lookupResponse(OWN_DID), from('192.168.1.51'));
  assert.deepEqual(connects, [['192.168.1.51', OWN_DID]]);
  assert.deepEqual(protocol.getLookupObservation(new Set([ACCOUNT_DID])), {
    rounds: 3,
    broadcastTargets: 3,
    broadcastEnabled: false,
    sendErrors: 0,
    datagrams: 8,
    otherHeaders: 1,
    ownReplies: 1,
    ownRound: 2,
    accountReplies: 2,
    foreignReplies: 1,
    nearReplies: 3,
    inventoryReply: 'account',
  });
});

test('a reply is near when only the inventory DID differs in padding, case or whitespace', (t) => {
  const { protocol, connects } = runningLookup(t);
  // The own side is normalised too, and its middle part is compared as an integer.
  for (const own of ['ABCDEFG-12345-HIJKL', 'abcdefg-012345-hijkl', ' ABCDEFG -012345- HIJKL ']) {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    protocol.rawStation = { station_sn: 'HB', p2p_did: own };
    protocol.lookup();
    protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
    // The exact check still rejects the reply, as before.
    assert.deepEqual(connects, []);
    assert.deepEqual(protocol.getLookupObservation(new Set()), {
      ...emptyLookup,
      rounds: 1,
      datagrams: 1,
      nearReplies: 1,
      inventoryReply: 'near',
    });
  }
});

test('a reply that differs from the own DID in one part after normalisation is foreign, not near', (t) => {
  const { protocol, connects } = runningLookup(t);
  protocol.handleMsg(lookupPacket('abcdefx', 12345, 'hijkl'), from(INVENTORY_IP));
  protocol.handleMsg(lookupPacket('abcdefg', 12346, 'hijkl'), from('192.168.1.11'));
  protocol.handleMsg(lookupPacket('abcdefg', 12345, 'hijkx'), from('192.168.1.12'));
  assert.deepEqual(connects, []);
  assert.deepEqual(protocol.getLookupObservation(new Set()), {
    ...emptyLookup,
    rounds: 1,
    datagrams: 3,
    foreignReplies: 3,
    inventoryReply: 'foreign',
  });
});

test('a short lookup reply counts as a datagram and the counting path never throws', (t) => {
  const { protocol } = runningLookup(t);
  const reply = lookupResponse(OWN_DID);
  for (let length = 0; length < 24; length++)
    assert.doesNotThrow(() =>
      protocol.observeLookupDatagram(reply.subarray(0, length), from(INVENTORY_IP)),
    );
  assert.deepEqual(protocol.getLookupObservation(new Set()), {
    ...emptyLookup,
    rounds: 1,
    datagrams: 24,
    // Zero or one byte has no header. Below 16 bytes a reply has no DID number.
    otherHeaders: 2,
    // From 21 bytes the existing parse reads the whole own DID, 16 to 20 bytes
    // give five different truncated DIDs.
    ownReplies: 3,
    ownRound: 0,
    foreignReplies: 5,
    inventoryReply: 'foreign',
  });
});

test('a truncated reply is handled as before and counted with the class the lookup gives it', (t) => {
  const { protocol, connects } = runningLookup(t);
  const reply = lookupResponse(OWN_DID);
  assert.doesNotThrow(() => protocol.handleMsg(reply.subarray(0, 20), from(INVENTORY_IP)));
  assert.deepEqual(connects, []);
  assert.notEqual(protocol.lookupTimeout, undefined);
  protocol.handleMsg(reply.subarray(0, 21), from(INVENTORY_IP));
  assert.deepEqual(connects, [[INVENTORY_IP, OWN_DID]]);
  assert.deepEqual(protocol.getLookupObservation(new Set()), {
    ...emptyLookup,
    rounds: 1,
    datagrams: 2,
    ownReplies: 1,
    ownRound: 0,
    foreignReplies: 1,
    inventoryReply: 'foreign',
  });
});

test('failed lookup sends are counted, other failed sends are not', async (t) => {
  const { protocol } = runningLookup(t);
  const address = { host: INVENTORY_IP, port: 32108 };
  let fail = true;
  const sends = [];
  protocol.socket = {
    send: (message, _port, _host, callback) => {
      sends.push(message.subarray(0, 2).toString('hex'));
      if (fail) callback(new Error('send refused'));
      else callback(null, message.length);
    },
  };
  // The upstream lookup send, still fire-and-forget: it resolves after the failure.
  await P2PClientProtocol.prototype.localLookupByAddress.call(protocol, address);
  await protocol.sendMessage('Send ping', address, RequestMessageType.PING);
  fail = false;
  await P2PClientProtocol.prototype.localLookupByAddress.call(protocol, address);
  assert.deepEqual(sends, ['f130', 'f1e0', 'f130']);
  // A lookup send that fails after the lookup has ended is not counted.
  fail = true;
  const late = P2PClientProtocol.prototype.localLookupByAddress.call(protocol, address);
  protocol._clearLookupTimeout();
  protocol._clearLocalLookupRetryTimeout();
  await late;
  assert.equal(protocol.getLookupObservation(new Set()).sendErrors, 1);
});

test('lookup observation counts saturate at 999, rounds and ownRound at 99', async (t) => {
  const { protocol } = runningLookup(t, { maxLookupMs: 1_000_000 });
  for (let round = 1; round < 150; round++) t.mock.timers.tick(1000);
  protocol.socket = { send: (_message, _port, _host, callback) => callback(new Error('refused')) };
  const address = { host: INVENTORY_IP, port: 32108 };
  const ACCOUNT_DID_2 = 'ACCOUNT-000003-AAAAA';
  const FOREIGN_DID_2 = 'OTHERDV-000004-ZZZZZ';
  for (let i = 0; i < 1001; i++) {
    protocol.handleMsg(otherHeader, from('192.168.1.9'));
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    // The sums over several DIDs saturate too, not only each DID's count.
    if (i < 600) {
      protocol.handleMsg(lookupResponse(FOREIGN_DID_2), from('192.168.1.9'));
      protocol.handleMsg(lookupResponse(ACCOUNT_DID), from('192.168.1.9'));
      protocol.handleMsg(lookupResponse(ACCOUNT_DID_2), from('192.168.1.9'));
    }
    protocol.handleMsg(lookupPacket('abcdefg', 12345, 'hijkl'), from('192.168.1.9'));
    await protocol.sendMessage('Local lookup address', address, RequestMessageType.LOCAL_LOOKUP);
  }
  protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
  assert.deepEqual(protocol.getLookupObservation(new Set([ACCOUNT_DID, ACCOUNT_DID_2])), {
    rounds: 99,
    broadcastTargets: 3,
    broadcastEnabled: false,
    sendErrors: 999,
    datagrams: 999,
    otherHeaders: 999,
    ownReplies: 1,
    ownRound: 99,
    accountReplies: 999,
    foreignReplies: 999,
    nearReplies: 999,
    inventoryReply: 'own',
  });
});

test('the session keeps at most 16 other DIDs and leaves later ones unclassified', (t) => {
  const { protocol } = runningLookup(t);
  const did = (n) => `OTHERDV-${String(n).padStart(6, '0')}-ZZZZZ`;
  for (let n = 0; n < 20; n++) protocol.handleMsg(lookupResponse(did(n)), from('192.168.1.9'));
  // A DID already kept still counts after the bound.
  protocol.handleMsg(lookupResponse(did(0)), from('192.168.1.9'));
  assert.equal(protocol.lookupObservation.others.size, 16);
  const observed = protocol.getLookupObservation(new Set([did(3), did(19)]));
  assert.equal(observed.datagrams, 21);
  assert.equal(observed.accountReplies, 1);
  assert.equal(observed.foreignReplies, 16);
  assert.equal(protocol.lookupObservation, undefined);
});

test('inventoryReply names the class of the first reply from the inventory address', (t) => {
  const { protocol } = runningLookup(t);
  const classOf = (replies) => {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    // Every lookup starts a new observation.
    protocol.lookup();
    for (const [packet, address] of replies) protocol.handleMsg(packet, from(address));
    return protocol.getLookupObservation(new Set([ACCOUNT_DID])).inventoryReply;
  };
  assert.equal(classOf([]), 'none');
  assert.equal(classOf([[lookupResponse(OWN_DID), '192.168.1.51']]), 'none');
  assert.equal(classOf([[otherHeader, INVENTORY_IP]]), 'none');
  assert.equal(
    classOf([
      [lookupResponse(ACCOUNT_DID), '192.168.1.9'],
      [lookupResponse(OWN_DID), INVENTORY_IP],
    ]),
    'own',
  );
  assert.equal(
    classOf([
      [lookupResponse(ACCOUNT_DID), INVENTORY_IP],
      [lookupResponse(OWN_DID), INVENTORY_IP],
    ]),
    'account',
  );
  assert.equal(
    classOf([
      [lookupResponse(FOREIGN_DID), INVENTORY_IP],
      [lookupResponse(ACCOUNT_DID), INVENTORY_IP],
    ]),
    'foreign',
  );
  assert.equal(classOf([[lookupPacket('abcdefg', 12345, 'hijkl'), INVENTORY_IP]]), 'near');
  // Without a preferred address no reply comes from the inventory address.
  protocol.preferredIPAddress = undefined;
  assert.equal(classOf([[lookupResponse(OWN_DID), INVENTORY_IP]]), 'none');
});

test('broadcastEnabled reports whether the bound socket accepted broadcasts, and the lookup starts either way', async (t) => {
  const { protocol, sent } = lookupProtocol(t);
  protocol.connectionType = P2PConnectionType.ONLY_LOCAL;
  protocol.MAX_LOOKUP_TIMEOUT = 20000;
  protocol.connected = false;
  protocol.connecting = false;
  protocol.binded = false;
  protocol.listeningPort = 0;
  let refuse = true;
  protocol.socket = {
    bind: (_port, callback) => callback(),
    setRecvBufferSize() {},
    setBroadcast() {
      if (refuse) throw new Error('refused');
    },
    getRecvBufferSize: () => 0,
  };
  try {
    await protocol.connect(INVENTORY_IP);
    assert.deepEqual(sent, [INVENTORY_IP]);
    assert.equal(protocol.getLookupObservation(new Set()).broadcastEnabled, false);
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    // A renewed socket binds again.
    protocol.connecting = false;
    protocol.binded = false;
    refuse = false;
    await protocol.connect(INVENTORY_IP);
    assert.deepEqual(sent, [INVENTORY_IP, INVENTORY_IP]);
    assert.equal(protocol.getLookupObservation(new Set()).broadcastEnabled, true);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
  }
});

test('a renewed socket reports its own broadcast result', async (t) => {
  const { protocol, sent } = lookupProtocol(t);
  protocol.connectionType = P2PConnectionType.ONLY_LOCAL;
  protocol.MAX_LOOKUP_TIMEOUT = 20000;
  protocol.connected = false;
  protocol.connecting = false;
  protocol.binded = false;
  protocol.listeningPort = 0;
  protocol._disconnected = () => {};
  let refuse = false;
  const stub = {
    bind: (_port, callback) => callback(),
    setRecvBufferSize() {},
    setBroadcast() {
      if (refuse) throw new Error('refused');
    },
    getRecvBufferSize: () => 0,
    removeAllListeners() {},
  };
  protocol.socket = stub;
  try {
    await protocol.connect(INVENTORY_IP);
    assert.equal(protocol.getLookupObservation(new Set()).broadcastEnabled, true);
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    // The socket closes and the session replaces it with a new one.
    protocol.onClose();
    const renewed = protocol.socket;
    renewed.removeAllListeners();
    renewed.close();
    assert.equal(protocol.binded, false);
    protocol.socket = stub;
    protocol.connecting = false;
    refuse = true;
    await protocol.connect(INVENTORY_IP);
    assert.deepEqual(sent, [INVENTORY_IP, INVENTORY_IP]);
    assert.equal(protocol.getLookupObservation(new Set()).broadcastEnabled, false);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
  }
});

test('the station passes the lookup observation through from its session', () => {
  const dids = new Set([ACCOUNT_DID]);
  const seen = [];
  const station = Object.create(Station.prototype);
  station.p2pSession = {
    getLookupObservation: (accountDids) => {
      seen.push(accountDids);
      return emptyLookup;
    },
  };
  assert.equal(station.getLookupObservation(dids), emptyLookup);
  assert.deepEqual(seen, [dids]);
});

test('the host subnet check uses every external IPv4 interface and is undefined on errors', (t) => {
  t.mock.method(os, 'networkInterfaces', () => interfaces);
  assert.equal(hostSubnetContains(INVENTORY_IP), true);
  assert.equal(hostSubnetContains('172.17.3.4'), true);
  assert.equal(hostSubnetContains('10.25.0.1'), true);
  assert.equal(hostSubnetContains('192.168.2.1'), false);
  // The loopback interface is internal.
  assert.equal(hostSubnetContains('127.0.0.1'), false);
  assert.equal(hostSubnetContains('192.168.1.999'), undefined);
  t.mock.method(os, 'networkInterfaces', () => {
    throw new Error('refused');
  });
  assert.equal(hostSubnetContains(INVENTORY_IP), undefined);
});

const sessionLookup = {
  ...emptyLookup,
  rounds: 3,
  broadcastTargets: 3,
  broadcastEnabled: true,
  datagrams: 2,
  ownReplies: 1,
  ownRound: 2,
  accountReplies: 1,
  inventoryReply: 'account',
};

test('onLookup reports once when the connection resolves, after its stages', async (t) => {
  t.mock.method(os, 'networkInterfaces', () => interfaces);
  const { t: transport, reads } = connectionFixture({ address: true, lookup: sessionLookup });
  transport.sessionAddresses.set('HB', INVENTORY_IP);
  transport.raw.get('HB').p2p_did = OWN_DID;
  transport.raw.set('CAM', {
    device_sn: 'CAM',
    device_model: 'T8160',
    device_type: 19,
    parent_sn: 'HB',
    p2p_did: ACCOUNT_DID,
  });
  transport.raw.set('HB2', {
    device_sn: 'HB2',
    device_model: 'T8030',
    device_type: 18,
    parent_sn: '',
    p2p_did: FOREIGN_DID,
    params: [{ param_type: 1176, param_value: '192.168.1.60' }],
  });
  // As load() keeps them, the account rows classify the replies.
  transport.accountRows = [...transport.raw.values()];
  const events = [];
  const progress = ({ stage, inventoryAddress }) => events.push({ stage, inventoryAddress });
  const observe = (observation) => events.push(observation);
  try {
    await transport.connect('HB', undefined, progress, observe);
    assert.deepEqual(events, [
      { stage: 'lookup', inventoryAddress: true },
      { stage: 'station_found', inventoryAddress: undefined },
      { stage: 'session_open', inventoryAddress: undefined },
      { stage: 'encryption_ready', inventoryAddress: undefined },
      { ...sessionLookup, inventoryAddressOnSubnet: true, inventoryAddressShared: false },
    ]);
    // The other rows' DIDs classify the replies, never the station's own.
    assert.deepEqual(reads, [{ accountDids: [ACCOUNT_DID, FOREIGN_DID].sort(), closes: 0 }]);
    assert.equal(transport.state('HB').connected, true);
    // An already connected station reports neither stages nor an observation.
    await transport.connect('HB', undefined, progress, observe);
    assert.equal(events.length, 5);
    assert.equal(reads.length, 1);
  } finally {
    await transport.close();
  }
});

test('onLookup reports a timed-out attempt once, before the session closes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = { ...emptyLookup, rounds: 20, broadcastTargets: 3, broadcastEnabled: true };
  const { t: transport, calls, reads } = connectionFixture({ answer: [], lookup: silent });
  const observations = [];
  try {
    const connecting = transport.connect('HB', undefined, undefined, (observation) =>
      observations.push({ observation, closes: calls.close }),
    );
    // A second attempt meanwhile is refused and reports nothing.
    await assert.rejects(
      transport.connect('HB', undefined, undefined, (observation) =>
        observations.push({ observation, closes: calls.close }),
      ),
      { code: 'connection_busy' },
    );
    t.mock.timers.tick(20000);
    await assert.rejects(connecting, { code: 'device_request_timeout' });
    // Without an inventory address both address flags are absent.
    assert.deepEqual(observations, [{ observation: silent, closes: 0 }]);
    assert.deepEqual(reads, [{ accountDids: [], closes: 0 }]);
    assert.equal(calls.close, 1);
  } finally {
    t.mock.timers.reset();
    await transport.close();
  }
});

test('onLookup reports a cancelled attempt once, empty when no session started', async () => {
  const { t: transport, calls, reads } = connectionFixture({ answer: [], lookup: sessionLookup });
  const observations = [];
  const observe = (observation) => observations.push(observation);
  try {
    const early = new AbortController();
    await assert.rejects(
      transport.connect(
        'HB',
        early.signal,
        ({ stage }) => stage === 'lookup' && early.abort(),
        observe,
      ),
      { code: 'cancelled' },
    );
    assert.deepEqual(observations, [emptyLookup]);
    assert.deepEqual(reads, []);
    assert.deepEqual(calls, { connect: 0, close: 1 });
    const late = new AbortController();
    const connecting = transport.connect('HB', late.signal, undefined, observe);
    late.abort();
    await assert.rejects(connecting, { code: 'cancelled' });
    assert.deepEqual(observations, [emptyLookup, sessionLookup]);
    assert.deepEqual(reads, [{ accountDids: [], closes: 1 }]);
    assert.deepEqual(calls, { connect: 1, close: 2 });
  } finally {
    await transport.close();
  }
});

test('an attempt cancelled before its lookup reports nothing', async () => {
  const { t: transport, calls, reads } = connectionFixture({ answer: [], lookup: sessionLookup });
  const observations = [];
  try {
    await assert.rejects(
      transport.connect('HB', AbortSignal.abort(), undefined, (value) => observations.push(value)),
      { code: 'cancelled' },
    );
    assert.deepEqual(observations, []);
    assert.deepEqual(reads, []);
    assert.equal(calls.connect, 0);
  } finally {
    await transport.close();
  }
});

test('a failing lookup consumer never alters the connection', async () => {
  const fails = () => {
    throw new Error('consumer failure');
  };
  const { t: transport } = connectionFixture({ lookup: sessionLookup });
  try {
    await transport.connect('HB', undefined, undefined, fails);
    assert.equal(transport.state('HB').connected, true);
  } finally {
    await transport.close();
  }
  const { t: cancelled, calls } = connectionFixture({ answer: [], lookup: sessionLookup });
  const controller = new AbortController();
  try {
    const connecting = cancelled.connect('HB', controller.signal, undefined, fails);
    controller.abort();
    await assert.rejects(connecting, { code: 'cancelled' });
    assert.equal(calls.close, 1);
    assert.equal(cancelled.connecting.size, 0);
  } finally {
    await cancelled.close();
  }
});

test('the inventory address flags use the address the session was created with', async (t) => {
  const networks = t.mock.method(os, 'networkInterfaces', () => interfaces);
  t.mock.method(Station, 'getInstance', async (_provider, wire) =>
    Object.assign(new EventEmitter(), {
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
      getLookupObservation: () => undefined,
    }),
  );
  const row = (sn, address) => ({
    category: 'eufy_security',
    device_sn: sn,
    parent_sn: '',
    device_model: 'T8030',
    device_type: 18,
    main_sw_version: '3.8.7.4',
    p2p_did: `synthetic-${sn}`,
    member: { admin_user_id: 'synthetic' },
    params: address ? [{ param_type: 1176, param_value: address }] : [],
  });
  const observe = async (transport) => {
    const controller = new AbortController();
    let observation;
    await assert.rejects(
      transport.connect(
        'T8030_OWNER',
        controller.signal,
        () => controller.abort(),
        (value) => (observation = value),
      ),
      { code: 'cancelled' },
    );
    return observation;
  };
  const transport = new DeviceTransport();
  try {
    let inventory = discover([row('T8030_OWNER', INVENTORY_IP), row('T8030_SECOND', INVENTORY_IP)]);
    await transport.load(inventory.raw, inventory);
    assert.deepEqual(await observe(transport), {
      ...emptyLookup,
      inventoryAddressOnSubnet: true,
      inventoryAddressShared: true,
    });
    // Only the owner's own row carries the address, which is not shared.
    inventory = discover([row('T8030_OWNER', INVENTORY_IP), row('T8030_SECOND', '192.168.2.9')]);
    await transport.load(inventory.raw, inventory);
    assert.deepEqual(await observe(transport), {
      ...emptyLookup,
      inventoryAddressOnSubnet: true,
      inventoryAddressShared: false,
    });
    // The address leaves the owner's row and the other station moves. The
    // session keeps the address it was created with.
    inventory = discover([row('T8030_OWNER'), row('T8030_SECOND', '192.168.2.9')]);
    await transport.load(inventory.raw, inventory);
    assert.deepEqual(await observe(transport), {
      ...emptyLookup,
      inventoryAddressOnSubnet: true,
      inventoryAddressShared: false,
    });
    networks.mock.mockImplementation(() => {
      throw new Error('refused');
    });
    assert.deepEqual(await observe(transport), { ...emptyLookup, inventoryAddressShared: false });
  } finally {
    await transport.close();
  }
  const fresh = new DeviceTransport();
  try {
    const inventory = discover([row('T8030_OWNER'), row('T8030_SECOND', INVENTORY_IP)]);
    await fresh.load(inventory.raw, inventory);
    assert.deepEqual(await observe(fresh), emptyLookup);
  } finally {
    await fresh.close();
  }
  networks.mock.mockImplementation(() => interfaces);
  const outside = new DeviceTransport();
  try {
    const inventory = discover([row('T8030_OWNER', '192.168.2.9'), row('T8030_SECOND')]);
    await outside.load(inventory.raw, inventory);
    assert.deepEqual(await observe(outside), {
      ...emptyLookup,
      inventoryAddressOnSubnet: false,
      inventoryAddressShared: false,
    });
  } finally {
    await outside.close();
  }
});

test('account rows that discovery or load did not admit still classify replies and addresses', async (t) => {
  t.mock.method(os, 'networkInterfaces', () => interfaces);
  const reads = [];
  t.mock.method(Station, 'getInstance', async (_provider, wire) =>
    Object.assign(new EventEmitter(), {
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
      getLookupObservation: (accountDids) => {
        reads.push([...accountDids].sort());
        return undefined;
      },
    }),
  );
  const row = (sn, model, type, address) => ({
    category: 'eufy_security',
    device_sn: sn,
    parent_sn: '',
    device_model: model,
    device_type: type,
    main_sw_version: '3.8.7.4',
    p2p_did: `synthetic-${sn}`,
    member: { admin_user_id: 'synthetic' },
    params: [{ param_type: 1176, param_value: address }],
  });
  const transport = new DeviceTransport();
  try {
    for (const [standalone, unsupported, shared] of [
      [INVENTORY_IP, '192.168.2.9', true],
      ['192.168.2.9', INVENTORY_IP, true],
      ['192.168.2.9', '192.168.2.10', false],
    ]) {
      const inventory = discover([
        row('T8030_OWNER', 'T8030', 18, INVENTORY_IP),
        // A standalone T8410C stays unverified, and an unknown model is unsupported.
        row('T8410C_CAM', 'T8410C', 31, standalone),
        row('UNKNOWN_CAM', 'T9999', 9999, unsupported),
      ]);
      assert.deepEqual(
        inventory.result.issues.map(({ deviceId, code }) => [deviceId, code]),
        [
          ['T8410C_CAM', 'standalone_transport_unverified'],
          ['UNKNOWN_CAM', 'unsupported_device'],
        ],
      );
      await transport.load(inventory.raw, inventory);
      assert.deepEqual([...transport.raw.keys()], ['T8030_OWNER']);
      reads.length = 0;
      // Cancelled after its session started, so the attempt reads the observation.
      const controller = new AbortController();
      let observation;
      const connecting = transport.connect(
        'T8030_OWNER',
        controller.signal,
        undefined,
        (value) => (observation = value),
      );
      controller.abort();
      await assert.rejects(connecting, { code: 'cancelled' });
      assert.deepEqual(reads, [['synthetic-T8410C_CAM', 'synthetic-UNKNOWN_CAM']]);
      assert.deepEqual(observation, {
        ...emptyLookup,
        inventoryAddressOnSubnet: true,
        inventoryAddressShared: shared,
      });
    }
  } finally {
    await transport.close();
  }
});

test('a lookup observation carries no DID or address from the session or the inventory', async (t) => {
  const { protocol } = runningLookup(t);
  protocol.handleMsg(lookupResponse(ACCOUNT_DID), from(INVENTORY_IP));
  protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
  protocol.handleMsg(lookupPacket('abcdefg', 12345, 'hijkl'), from('192.168.1.11'));
  protocol.handleMsg(lookupResponse(OWN_DID), from('192.168.1.51'));
  const { t: transport } = connectionFixture({
    address: true,
    lookup: (accountDids) => protocol.getLookupObservation(accountDids),
  });
  transport.sessionAddresses.set('HB', INVENTORY_IP);
  transport.raw.get('HB').p2p_did = OWN_DID;
  transport.raw.set('CAM', {
    device_sn: 'CAM',
    device_model: 'T8160',
    device_type: 19,
    parent_sn: 'HB',
    p2p_did: ACCOUNT_DID,
    ip_addr: INVENTORY_IP,
  });
  transport.accountRows = [...transport.raw.values()];
  let observation;
  try {
    await transport.connect('HB', undefined, undefined, (value) => (observation = value));
  } finally {
    await transport.close();
  }
  assert.deepEqual(observation, {
    ...emptyLookup,
    rounds: 1,
    datagrams: 4,
    ownReplies: 1,
    ownRound: 0,
    accountReplies: 1,
    foreignReplies: 1,
    nearReplies: 1,
    inventoryReply: 'account',
    inventoryAddressOnSubnet: true,
    inventoryAddressShared: true,
  });
  const text = JSON.stringify(observation);
  for (const value of [
    ...[OWN_DID, ACCOUNT_DID, FOREIGN_DID].flatMap((did) => [did, ...did.split('-')]),
    'abcdefg',
    '12345',
    '192.168.',
    '32108',
    'HB',
    'CAM',
  ])
    assert.equal(text.includes(value), false, value);
  assert.equal(protocol.lookupObservation, undefined);
});

test('an attempt without onLookup still drops the DIDs its lookup kept', async (t) => {
  const { protocol } = runningLookup(t);
  protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
  protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
  const { t: transport, reads } = connectionFixture({
    lookup: (accountDids) => protocol.getLookupObservation(accountDids),
  });
  try {
    await transport.connect('HB');
    assert.equal(transport.state('HB').connected, true);
  } finally {
    await transport.close();
  }
  assert.equal(reads.length, 1);
  assert.equal(protocol.lookupObservation, undefined);
});

test('a lookup the library starts itself drops its DIDs when its session is ready or fails', async (t) => {
  const { protocol } = runningLookup(t);
  const {
    t: transport,
    station,
    reads,
  } = connectionFixture({
    lookup: (accountDids) => protocol.getLookupObservation(accountDids),
  });
  try {
    // An earlier attempt of the client reads its own lookup and leaves no reader behind.
    await transport.connect('HB');
    assert.equal(reads.length, 1);
    reads.length = 0;
    protocol.lookup();
    // A reconnect after a drop: a neighbour answers, then the station itself.
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
    assert.equal(protocol.lookupObservation.others.size, 1);
    station.emit('connect', station);
    station.emit('encryption ready', station, 'lan-derived');
    assert.equal(protocol.lookupObservation, undefined);
    // A reconnect whose lookup times out, as Station.onTimeout reports it.
    protocol.lookup();
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    assert.equal(protocol.lookupObservation.others.size, 1);
    station.emit('connection error', station, new Error('timeout'));
    assert.equal(protocol.lookupObservation, undefined);
    // Neither drop passes inventory DIDs.
    assert.deepEqual(reads, [
      { accountDids: [], closes: 0 },
      { accountDids: [], closes: 0 },
    ]);
  } finally {
    await transport.close();
  }
});

test('a lookup the library starts itself drops its DIDs when its session closes before it is ready', async (t) => {
  const { protocol } = runningLookup(t);
  const {
    t: transport,
    station,
    reads,
  } = connectionFixture({
    lookup: (accountDids) => protocol.getLookupObservation(accountDids),
  });
  try {
    // A reconnect whose session opens and drops before the command key is in place.
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
    assert.equal(protocol.lookupObservation.others.size, 1);
    station.emit('connect', station);
    station.emit('close', station);
    assert.equal(protocol.lookupObservation, undefined);
    assert.deepEqual(reads, [{ accountDids: [], closes: 0 }]);
  } finally {
    await transport.close();
  }
});

test('an extra live session drops the DIDs of its lookup when it connects or fails', (t) => {
  const { protocol } = runningLookup(t);
  const transport = new DeviceTransport();
  for (const event of ['connect', 'connection error']) {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    protocol.lookup();
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    const station = Object.assign(new EventEmitter(), {
      getLookupObservation: (accountDids) => protocol.getLookupObservation(accountDids),
    });
    transport.bindExtra(station, 'HB:0');
    assert.equal(protocol.lookupObservation.others.size, 1, event);
    station.emit(event, station);
    assert.equal(protocol.lookupObservation, undefined, event);
  }
});

test('closing the session drops a lookup observation nobody read', async (t) => {
  const { protocol } = runningLookup(t);
  protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
  assert.equal(protocol.lookupObservation.others.size, 1);
  protocol.messageStates = new Map();
  protocol.messageVideoStates = new Map();
  protocol.socket = undefined;
  protocol.binded = false;
  await protocol.close();
  assert.equal(protocol.lookupObservation, undefined);
});
