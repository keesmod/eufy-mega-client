import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import util from 'node:util';
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
  keySetup,
} = {}) {
  const t = new DeviceTransport();
  let connected = false;
  const calls = { connect: 0, close: 0 };
  // Each read of the session's lookup observation, and each set of account
  // DIDs handed to the session, with the connects that came before it.
  const reads = [];
  const accountDids = [];
  // Each read of the session's key setup observation, with the closes before it.
  const keyReads = [];
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
    setLookupAccountDids: (dids) =>
      accountDids.push({ dids: [...dids].sort(), connects: calls.connect }),
    getLookupObservation: () => {
      reads.push({ closes: calls.close });
      return typeof lookup === 'function' ? lookup() : lookup;
    },
    getKeySetupObservation: () => {
      keyReads.push({ closes: calls.close });
      return typeof keySetup === 'function' ? keySetup() : keySetup;
    },
  });
  t.stations.set('HB', station);
  t.stationAddresses.set('HB', address);
  t.raw.set('HB', { device_sn: 'HB', device_model: 'T8030', device_type: 18, parent_sn: '' });
  t.bind(station);
  return { t, station, calls, reads, accountDids, keyReads };
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

test('a lookup round without any target is not counted as sent', (t) => {
  const { protocol, sent } = lookupProtocol(t);
  t.mock.method(os, 'networkInterfaces', () => {
    throw new Error('refused');
  });
  protocol.connectionType = P2PConnectionType.ONLY_LOCAL;
  protocol.MAX_LOOKUP_TIMEOUT = 20000;
  protocol.connected = false;
  try {
    protocol.lookup(undefined);
    t.mock.timers.tick(3000);
    assert.deepEqual(sent, []);
    assert.equal(protocol.lookupObservation.rounds, 0);
    assert.equal(protocol.lookupObservation.sendErrors, 0);
    // A round that sends counts as before.
    protocol.localLookup('192.168.1.50');
    assert.deepEqual(sent, ['192.168.1.50']);
    const observation = protocol.getLookupObservation();
    assert.equal(observation.rounds, 1);
    assert.equal(observation.broadcastTargets, 0);
    assert.equal(observation.sendErrors, 0);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
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
  const onKeySetup = () => {};
  await EufyMegaClient.prototype.connectStation.call(client, 'HB');
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', signal);
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', { signal, onProgress });
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', { onLookup });
  await EufyMegaClient.prototype.connectStation.call(client, 'HB', { onKeySetup });
  assert.deepEqual(calls, [
    ['HB', undefined, undefined, undefined, undefined],
    ['HB', signal, undefined, undefined, undefined],
    ['HB', signal, onProgress, undefined, undefined],
    ['HB', undefined, undefined, onLookup, undefined],
    ['HB', undefined, undefined, undefined, onKeySetup],
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

const emptyKeySetup = {
  requestSends: 0,
  requestAcknowledged: false,
  resultWaitExpired: false,
  answers: 0,
  dataDatagrams: 0,
  otherMessages: 0,
  heartbeats: 0,
  ended: false,
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
  const observed = {
    ...emptyLookup,
    rounds: 1,
    datagrams: 1,
    ownReplies: 1,
    ownRound: 0,
    inventoryReply: 'own',
  };
  assert.deepEqual(protocol.getLookupObservation(), observed);
  // Reading leaves the counters in place.
  assert.deepEqual(protocol.getLookupObservation(), observed);
});

test('the lookup observation classifies replies by DID and names the round of a later own reply', (t) => {
  const { protocol, sent, connects } = runningLookup(t);
  // The session keeps its own copy of the account DIDs.
  const dids = new Set([ACCOUNT_DID]);
  protocol.setLookupAccountDids(dids);
  dids.clear();
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
  assert.deepEqual(protocol.getLookupObservation(), {
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
    assert.deepEqual(protocol.getLookupObservation(), {
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
  assert.deepEqual(protocol.getLookupObservation(), {
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
  assert.deepEqual(protocol.getLookupObservation(), {
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
  assert.deepEqual(protocol.getLookupObservation(), {
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
  assert.equal(protocol.getLookupObservation().sendErrors, 1);
});

test('lookup observation counts saturate at 999, rounds and ownRound at 99', async (t) => {
  const { protocol } = runningLookup(t, { maxLookupMs: 1_000_000 });
  for (let round = 1; round < 150; round++) t.mock.timers.tick(1000);
  protocol.socket = { send: (_message, _port, _host, callback) => callback(new Error('refused')) };
  const address = { host: INVENTORY_IP, port: 32108 };
  const ACCOUNT_DID_2 = 'ACCOUNT-000003-AAAAA';
  const FOREIGN_DID_2 = 'OTHERDV-000004-ZZZZZ';
  protocol.setLookupAccountDids(new Set([ACCOUNT_DID, ACCOUNT_DID_2]));
  for (let i = 0; i < 1001; i++) {
    protocol.handleMsg(otherHeader, from('192.168.1.9'));
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    // Replies with several DIDs of one class add up to one saturating count.
    if (i < 600) {
      protocol.handleMsg(lookupResponse(FOREIGN_DID_2), from('192.168.1.9'));
      protocol.handleMsg(lookupResponse(ACCOUNT_DID), from('192.168.1.9'));
      protocol.handleMsg(lookupResponse(ACCOUNT_DID_2), from('192.168.1.9'));
    }
    protocol.handleMsg(lookupPacket('abcdefg', 12345, 'hijkl'), from('192.168.1.9'));
    await protocol.sendMessage('Local lookup address', address, RequestMessageType.LOCAL_LOOKUP);
  }
  protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
  assert.deepEqual(protocol.getLookupObservation(), {
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

test('every reply is classified when it arrives and the session keeps counters only', (t) => {
  const { protocol } = runningLookup(t);
  const did = (n) => `OTHERDV-${String(n).padStart(6, '0')}-ZZZZZ`;
  protocol.setLookupAccountDids(new Set([did(3), did(19)]));
  for (let n = 0; n < 20; n++) protocol.handleMsg(lookupResponse(did(n)), from('192.168.1.9'));
  protocol.handleMsg(lookupResponse(did(0)), from('192.168.1.9'));
  const observed = protocol.getLookupObservation();
  assert.equal(observed.datagrams, 21);
  assert.equal(observed.accountReplies, 2);
  assert.equal(observed.foreignReplies, 19);
  // No replying DID or address stays anywhere in the session, Map and Set
  // contents and private fields included. Only the account DIDs it was handed remain.
  const kept = util.inspect(protocol, {
    depth: Infinity,
    showHidden: true,
    maxArrayLength: Infinity,
    maxStringLength: Infinity,
  });
  assert.equal(kept.includes(did(3)), true);
  for (let n = 0; n < 20; n++)
    if (n !== 3 && n !== 19) assert.equal(kept.includes(did(n)), false, did(n));
  assert.equal(kept.includes('192.168.1.9'), false);
});

test('new account DIDs replace the earlier ones, so a device that left the account is foreign', (t) => {
  const { protocol } = runningLookup(t);
  protocol.setLookupAccountDids(new Set([ACCOUNT_DID]));
  // A later attempt hands the session the account as it is now.
  protocol.setLookupAccountDids(new Set());
  protocol.handleMsg(lookupResponse(ACCOUNT_DID), from('192.168.1.9'));
  assert.deepEqual(protocol.getLookupObservation(), {
    ...emptyLookup,
    rounds: 1,
    datagrams: 1,
    foreignReplies: 1,
  });
  const kept = util.inspect(protocol, {
    depth: Infinity,
    showHidden: true,
    maxArrayLength: Infinity,
    maxStringLength: Infinity,
  });
  assert.equal(kept.includes(ACCOUNT_DID), false);
});

test('inventoryReply names the class of the first reply from the inventory address', (t) => {
  const { protocol } = runningLookup(t);
  protocol.setLookupAccountDids(new Set([ACCOUNT_DID]));
  const classOf = (replies) => {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    // Every lookup starts a new observation.
    protocol.lookup();
    for (const [packet, address] of replies) protocol.handleMsg(packet, from(address));
    return protocol.getLookupObservation().inventoryReply;
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
    assert.equal(protocol.getLookupObservation().broadcastEnabled, false);
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
    // A renewed socket binds again.
    protocol.connecting = false;
    protocol.binded = false;
    refuse = false;
    await protocol.connect(INVENTORY_IP);
    assert.deepEqual(sent, [INVENTORY_IP, INVENTORY_IP]);
    assert.equal(protocol.getLookupObservation().broadcastEnabled, true);
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
    assert.equal(protocol.getLookupObservation().broadcastEnabled, true);
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
    assert.equal(protocol.getLookupObservation().broadcastEnabled, false);
  } finally {
    protocol._clearLocalLookupRetryTimeout();
    protocol._clearLookupTimeout();
  }
});

test('the station passes the account DIDs and the lookup observation through to its session', () => {
  const dids = new Set([ACCOUNT_DID]);
  const seen = [];
  const station = Object.create(Station.prototype);
  station.p2pSession = {
    setLookupAccountDids: (accountDids) => seen.push(accountDids),
    getLookupObservation: (...args) => {
      seen.push(args);
      return emptyLookup;
    },
    getKeySetupObservation: (...args) => {
      seen.push(args);
      return emptyKeySetup;
    },
  };
  station.setLookupAccountDids(dids);
  assert.equal(station.getLookupObservation(), emptyLookup);
  assert.equal(station.getKeySetupObservation(), emptyKeySetup);
  assert.deepEqual(seen, [dids, [], []]);
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
  const {
    t: transport,
    reads,
    accountDids,
  } = connectionFixture({ address: true, lookup: sessionLookup });
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
    // The other rows' DIDs reach the session before it starts, never the station's own.
    assert.deepEqual(accountDids, [{ dids: [ACCOUNT_DID, FOREIGN_DID].sort(), connects: 0 }]);
    assert.deepEqual(reads, [{ closes: 0 }]);
    assert.equal(transport.state('HB').connected, true);
    // An already connected station reports neither stages nor an observation.
    await transport.connect('HB', undefined, progress, observe);
    assert.equal(events.length, 5);
    assert.equal(reads.length, 1);
    assert.equal(accountDids.length, 1);
  } finally {
    await transport.close();
  }
});

test('onLookup reports a timed-out attempt once, before the session closes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = { ...emptyLookup, rounds: 20, broadcastTargets: 3, broadcastEnabled: true };
  const {
    t: transport,
    calls,
    reads,
    accountDids,
  } = connectionFixture({ answer: [], lookup: silent });
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
    assert.deepEqual(reads, [{ closes: 0 }]);
    assert.deepEqual(accountDids, [{ dids: [], connects: 0 }]);
    assert.equal(calls.close, 1);
  } finally {
    t.mock.timers.reset();
    await transport.close();
  }
});

test('onLookup reports a cancelled attempt once, empty when no session started', async () => {
  const {
    t: transport,
    calls,
    reads,
    accountDids,
  } = connectionFixture({ answer: [], lookup: sessionLookup });
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
    assert.deepEqual(accountDids, []);
    assert.deepEqual(calls, { connect: 0, close: 1 });
    const late = new AbortController();
    const connecting = transport.connect('HB', late.signal, undefined, observe);
    late.abort();
    await assert.rejects(connecting, { code: 'cancelled' });
    assert.deepEqual(observations, [emptyLookup, sessionLookup]);
    assert.deepEqual(reads, [{ closes: 1 }]);
    assert.deepEqual(accountDids, [{ dids: [], connects: 0 }]);
    assert.deepEqual(calls, { connect: 1, close: 2 });
  } finally {
    await transport.close();
  }
});

test('an attempt cancelled before its lookup reports nothing', async () => {
  const {
    t: transport,
    calls,
    reads,
    accountDids,
  } = connectionFixture({ answer: [], lookup: sessionLookup });
  const observations = [];
  try {
    await assert.rejects(
      transport.connect('HB', AbortSignal.abort(), undefined, (value) => observations.push(value)),
      { code: 'cancelled' },
    );
    assert.deepEqual(observations, []);
    assert.deepEqual(reads, []);
    assert.deepEqual(accountDids, []);
    assert.equal(calls.connect, 0);
  } finally {
    await transport.close();
  }
});

test('a failing lookup consumer never alters the connection', async () => {
  const fails = () => {
    throw new Error('consumer failure');
  };
  let observed = 0;
  const throwing = () => {
    observed++;
    throw new Error('consumer failure');
  };
  // A consumer that throws on a successful attempt connects the same way.
  const { t: plain } = connectionFixture({ lookup: sessionLookup });
  try {
    await plain.connect('HB', undefined, undefined, throwing);
    assert.equal(observed, 1);
    assert.equal(plain.state('HB').connected, true);
  } finally {
    await plain.close();
  }
  const { t: transport, station } = connectionFixture({ lookup: sessionLookup });
  // A session that refuses both observation calls connects the same way.
  station.setLookupAccountDids = fails;
  station.getLookupObservation = fails;
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
  const given = [];
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
      setLookupAccountDids: (dids) => given.push([...dids].sort()),
      getLookupObservation: () => undefined,
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
        // Without the opt-in a standalone T8410C stays unverified. An unknown model is unsupported.
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
      given.length = 0;
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
      assert.deepEqual(given, [['synthetic-T8410C_CAM', 'synthetic-UNKNOWN_CAM']]);
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
  const { t: transport, station } = connectionFixture({
    address: true,
    answer: [],
    lookup: () => protocol.getLookupObservation(),
  });
  station.setLookupAccountDids = (dids) => protocol.setLookupAccountDids(dids);
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
    const connecting = transport.connect(
      'HB',
      undefined,
      undefined,
      (value) => (observation = value),
    );
    protocol.handleMsg(lookupResponse(ACCOUNT_DID), from(INVENTORY_IP));
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    protocol.handleMsg(lookupPacket('abcdefg', 12345, 'hijkl'), from('192.168.1.11'));
    protocol.handleMsg(lookupResponse(OWN_DID), from('192.168.1.51'));
    station.emit('encryption ready', station, 'lan-derived');
    await connecting;
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
  const forbidden = [
    ...[OWN_DID, ACCOUNT_DID, FOREIGN_DID].flatMap((did) => [did, ...did.split('-')]),
    'abcdefg',
    '12345',
    '192.168.',
    '32108',
    'HB',
    'CAM',
  ];
  // Neither the report nor what the session keeps of its lookup holds one of them.
  for (const text of [JSON.stringify(observation), JSON.stringify(protocol.lookupObservation)])
    for (const value of forbidden) assert.equal(text.includes(value), false, value);
});

test('a session close keeps the lookup counters until the session starts a new connection', async (t) => {
  const { protocol } = runningLookup(t);
  protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
  protocol.messageStates = new Map();
  protocol.messageVideoStates = new Map();
  protocol.socket = undefined;
  protocol.binded = false;
  await protocol.close();
  const counted = { ...emptyLookup, rounds: 1, datagrams: 1, foreignReplies: 1 };
  assert.deepEqual(protocol.getLookupObservation(), counted);
  // A connect call while the session is still connecting keeps them.
  protocol.connecting = true;
  await protocol.connect();
  assert.deepEqual(protocol.getLookupObservation(), counted);
  // A new connection whose lookup has not started reports none of the earlier counts.
  protocol.connecting = false;
  protocol.socket = { bind() {} };
  await protocol.connect();
  assert.equal(protocol.getLookupObservation(), undefined);
});

test('a real session close keeps the lookup counters', async (t) => {
  const protocol = new P2PClientProtocol(
    { station_sn: 'HB', p2p_did: OWN_DID, device_type: 18, app_conn: '' },
    {},
    INVENTORY_IP,
  );
  t.after(() => protocol.dispose());
  protocol.setConnectionType(P2PConnectionType.ONLY_LOCAL);
  protocol.localLookupByAddress = async () => {};
  // Binding the real socket starts the lookup.
  await protocol.connect();
  while (protocol.getLookupObservation() === undefined)
    await new Promise((resolve) => setImmediate(resolve));
  protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
  const counted = protocol.getLookupObservation();
  assert.equal(counted.foreignReplies, 1);
  // The close runs _initialize, the socket close event, onClose and _disconnected.
  await protocol.close();
  assert.deepEqual(protocol.getLookupObservation(), counted);
});

test('a close the attempt did not make still lets onLookup report the counts', async (t) => {
  const { protocol } = runningLookup(t);
  protocol.messageStates = new Map();
  protocol.messageVideoStates = new Map();
  protocol.socket = undefined;
  protocol.binded = false;
  const {
    t: transport,
    station,
    calls,
    reads,
  } = connectionFixture({
    answer: [],
    lookup: () => protocol.getLookupObservation(),
  });
  // As Station does, closing closes the session.
  station.close = async () => {
    calls.close++;
    await protocol.close();
  };
  const observations = [];
  const observe = (observation) => observations.push(observation);
  try {
    // A rejected command key: the session reports the failure and closes in
    // the same tick, before the attempt's rejection is handled.
    const rejected = transport.connect('HB', undefined, undefined, observe);
    protocol.handleMsg(lookupResponse(OWN_DID), from(INVENTORY_IP));
    station.emit('connection error', station, new Error('Device command credentials rejected'));
    void protocol.close();
    await assert.rejects(rejected, { code: 'device_disconnected' });
    assert.deepEqual(observations, [
      {
        ...emptyLookup,
        rounds: 1,
        datagrams: 1,
        ownReplies: 1,
        ownRound: 0,
        inventoryReply: 'own',
      },
    ]);
    // Another operation on the station during the lookup is refused and closes the session.
    const controller = new AbortController();
    const cancelled = transport.connect('HB', controller.signal, undefined, observe);
    protocol.lookup();
    protocol.handleMsg(lookupResponse(FOREIGN_DID), from('192.168.1.9'));
    await assert.rejects(transport.setGuardMode('HB', 1), { code: 'connection_busy' });
    assert.equal(calls.close, 2);
    controller.abort();
    await assert.rejects(cancelled, { code: 'cancelled' });
    assert.deepEqual(observations.slice(1), [
      { ...emptyLookup, rounds: 1, datagrams: 1, foreignReplies: 1 },
    ]);
    // Each attempt read its session once, after the close it did not make and
    // before its own.
    assert.deepEqual(reads, [{ closes: 0 }, { closes: 2 }]);
  } finally {
    await transport.close();
  }
});

// Datagrams as a station sends them on an open session.
const camId = Buffer.from([0xf1, 0x42, 0, 0]);
const pong = Buffer.from([0xf1, 0xe1, 0, 0]);
const ping = Buffer.from([0xf1, 0xe0, 0, 0]);
const end = Buffer.from([0xf1, 0xf0, 0, 0]);
const ackData = (seq) => {
  const packet = Buffer.from([0xf1, 0xd1, 0, 6, 0xd1, 0, 0, 1, 0, 0]);
  packet.writeUInt16BE(seq, 8);
  return packet;
};
// One complete message of the given P2P data type and command in one DATA datagram.
const dataMessage = (dataType, seq, commandId, payload) => {
  const header = Buffer.alloc(16);
  header.write('XZYH', 0, 'utf8');
  header.writeUInt16LE(commandId, 4);
  header.writeUInt32LE(payload.length, 6);
  const body = Buffer.concat([header, payload]);
  const packet = Buffer.alloc(8);
  packet.set([0xf1, 0xd0], 0);
  packet.writeUInt16BE(body.length + 4, 2);
  packet.set([0xd1, dataType], 4);
  packet.writeUInt16BE(seq, 6);
  return Buffer.concat([packet, body]);
};
const CONTROL = 2;
const GATEWAYINFO = 1100;
// A key answer: cipher ID, two unknown bytes and an empty encrypted key.
const keyAnswer = (seq) => dataMessage(CONTROL, seq, GATEWAYINFO, Buffer.from([0, 0, 0, 0, 0]));

// A real session that sends into a recorder instead of a UDP socket.
function keySession(t, credentials = async () => ({ mode: 'lan-derived' })) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const protocol = new P2PClientProtocol(
    {
      // The LAN-derived key takes seven serial characters.
      station_sn: 'T0000000000000HB',
      p2p_did: OWN_DID,
      device_type: 18,
      app_conn: '',
      member: { admin_user_id: 'U' },
    },
    { getCommandCredentials: credentials },
    INVENTORY_IP,
  );
  const sent = [];
  const socket = protocol.socket;
  protocol.socket = {
    send: (message, _port, _host, callback) => {
      sent.push(Buffer.from(message));
      callback(null, message.length);
    },
    removeAllListeners: () => {},
  };
  protocol.setConnectionType(P2PConnectionType.ONLY_LOCAL);
  t.after(async () => {
    await protocol.dispose();
    socket.close();
    t.mock.timers.reset();
  });
  // The key request is the DATA datagram with command 1100 after its XZYH magic.
  const keyRequests = () =>
    sent.filter((m) => m[0] === 0xf1 && m[1] === 0xd0 && m.readUInt16LE(12) === GATEWAYINFO).length;
  // A timer that a timer callback schedules fires only when time passes after
  // it, so time advances in resend steps.
  const advance = (ms) => {
    for (let step = 0; step < ms; step += 100) t.mock.timers.tick(100);
  };
  return { protocol, keyRequests, advance };
}

test('the key setup observation counts the key request, its acknowledgement and answer until the key is in place', async (t) => {
  const { protocol, keyRequests, advance } = keySession(t);
  const ready = [];
  protocol.on('encryption ready', (mode) => ready.push(mode));
  assert.equal(protocol.getKeySetupObservation(), undefined);
  protocol.handleMsg(camId, from(INVENTORY_IP));
  assert.deepEqual(protocol.getKeySetupObservation(), { ...emptyKeySetup, requestSends: 1 });
  // A resend of the unacknowledged request, 200 ms after the first send, counts as a send.
  advance(200);
  assert.equal(protocol.getKeySetupObservation().requestSends, 2);
  assert.equal(keyRequests(), 2);
  protocol.handleMsg(ackData(0), from(INVENTORY_IP));
  protocol.handleMsg(pong, from(INVENTORY_IP));
  protocol.handleMsg(ping, from(INVENTORY_IP));
  advance(1000);
  // An acknowledged request is not sent again.
  assert.equal(keyRequests(), 2);
  protocol.handleMsg(keyAnswer(0), from(INVENTORY_IP));
  const answered = {
    ...emptyKeySetup,
    requestSends: 2,
    requestAcknowledged: true,
    answers: 1,
    dataDatagrams: 1,
    heartbeats: 2,
  };
  assert.deepEqual(protocol.getKeySetupObservation(), answered);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ready, ['lan-derived']);
  // With the key in place nothing counts any more.
  protocol.handleMsg(pong, from(INVENTORY_IP));
  protocol.handleMsg(dataMessage(CONTROL, 1, 1101, Buffer.from([1])), from(INVENTORY_IP));
  assert.deepEqual(protocol.getKeySetupObservation(), answered);
  // A read is a copy.
  protocol.getKeySetupObservation().answers = 99;
  assert.equal(protocol.getKeySetupObservation().answers, 1);
});

test('an acknowledged key request without an answer, other messages and an END are told apart', (t) => {
  const { protocol, advance } = keySession(t);
  protocol.handleMsg(camId, from(INVENTORY_IP));
  protocol.handleMsg(ackData(0), from(INVENTORY_IP));
  advance(4900);
  assert.equal(protocol.getKeySetupObservation().resultWaitExpired, false);
  advance(100);
  assert.equal(protocol.getKeySetupObservation().resultWaitExpired, true);
  // A complete CONTROL message with another command is not a key answer.
  protocol.handleMsg(dataMessage(CONTROL, 0, 1101, Buffer.from([1, 2])), from(INVENTORY_IP));
  protocol.handleMsg(end, from(INVENTORY_IP));
  assert.deepEqual(protocol.getKeySetupObservation(), {
    ...emptyKeySetup,
    requestSends: 1,
    requestAcknowledged: true,
    resultWaitExpired: true,
    dataDatagrams: 1,
    otherMessages: 1,
    ended: true,
  });
});

test('a silent station leaves the key request unacknowledged and its resends counted', (t) => {
  const { protocol, keyRequests, advance } = keySession(t);
  protocol.handleMsg(camId, from(INVENTORY_IP));
  advance(20000);
  const observed = protocol.getKeySetupObservation();
  assert.equal(observed.requestSends, keyRequests());
  assert.ok(observed.requestSends > 100);
  assert.deepEqual({ ...observed, requestSends: 0 }, emptyKeySetup);
});

test('a session close keeps the key setup counters until the session starts a new connection', async (t) => {
  const { protocol } = keySession(t);
  protocol.handleMsg(camId, from(INVENTORY_IP));
  protocol.handleMsg(pong, from(INVENTORY_IP));
  await protocol.close();
  const counted = { ...emptyKeySetup, requestSends: 1, heartbeats: 1 };
  assert.deepEqual(protocol.getKeySetupObservation(), counted);
  // After the close nothing counts.
  protocol.handleMsg(pong, from(INVENTORY_IP));
  assert.deepEqual(protocol.getKeySetupObservation(), counted);
  // A new connection reports none of the earlier counts before its handshake.
  protocol.socket.bind = () => {};
  await protocol.connect();
  assert.equal(protocol.getKeySetupObservation(), undefined);
  protocol._clearLookupTimeout();
  protocol._clearLocalLookupRetryTimeout();
});

const keyCounts = { ...emptyKeySetup, requestSends: 3, requestAcknowledged: true, heartbeats: 1 };

test('onKeySetup reports once when the connection resolves, after the lookup observation', async () => {
  const { t: transport, keyReads } = connectionFixture({
    lookup: emptyLookup,
    keySetup: { ...keyCounts, answers: 1 },
  });
  const events = [];
  try {
    await transport.connect(
      'HB',
      undefined,
      ({ stage }) => events.push(stage),
      () => events.push('lookup observation'),
      (observation) => events.push(observation),
    );
    assert.deepEqual(events, [
      'lookup',
      'station_found',
      'session_open',
      'encryption_ready',
      'lookup observation',
      { ...keyCounts, answers: 1 },
    ]);
    assert.deepEqual(keyReads, [{ closes: 0 }]);
    // An already connected station reports nothing.
    await transport.connect('HB', undefined, undefined, undefined, (o) => events.push(o));
    assert.equal(events.length, 6);
  } finally {
    await transport.close();
  }
});

test('onKeySetup reports a timed-out attempt once, before the session closes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const {
    t: transport,
    calls,
    keyReads,
  } = connectionFixture({ answer: ['station found', 'connect'], keySetup: keyCounts });
  const observations = [];
  try {
    const connecting = transport.connect('HB', undefined, undefined, undefined, (observation) =>
      observations.push({ observation, closes: calls.close }),
    );
    t.mock.timers.tick(20000);
    await assert.rejects(connecting, { code: 'device_request_timeout' });
    assert.deepEqual(observations, [{ observation: keyCounts, closes: 0 }]);
    assert.deepEqual(keyReads, [{ closes: 0 }]);
    assert.equal(calls.close, 1);
  } finally {
    t.mock.timers.reset();
    await transport.close();
  }
});

test('an attempt whose session never opened reports no key setup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { t: transport, keyReads } = connectionFixture({
    answer: ['station found'],
    keySetup: keyCounts,
  });
  const observations = [];
  try {
    const connecting = transport.connect('HB', undefined, undefined, undefined, (o) =>
      observations.push(o),
    );
    t.mock.timers.tick(20000);
    await assert.rejects(connecting, { code: 'device_request_timeout' });
    assert.deepEqual(observations, []);
    assert.deepEqual(keyReads, []);
  } finally {
    t.mock.timers.reset();
    await transport.close();
  }
});

test('a failing key setup consumer or session read never alters the connection', async () => {
  const { t: transport } = connectionFixture({ keySetup: keyCounts });
  try {
    await transport.connect('HB', undefined, undefined, undefined, () => {
      throw new Error('consumer');
    });
    assert.equal(transport.state('HB').connected, true);
  } finally {
    await transport.close();
  }
  const { t: failing } = connectionFixture({
    keySetup: () => {
      throw new Error('session');
    },
  });
  const observations = [];
  try {
    await failing.connect('HB', undefined, undefined, undefined, (o) => observations.push(o));
    assert.equal(failing.state('HB').connected, true);
    assert.deepEqual(observations, []);
  } finally {
    await failing.close();
  }
});

test('an answer that sets no key stays counted after the session closes', async (t) => {
  // The credentials are refused, so the session reports a credential error and closes.
  const { protocol } = keySession(t, async () => {
    throw new Error('refused');
  });
  const errors = [];
  protocol.on('credential error', () => errors.push('credential'));
  protocol.handleMsg(camId, from(INVENTORY_IP));
  protocol.handleMsg(ackData(0), from(INVENTORY_IP));
  protocol.handleMsg(keyAnswer(0), from(INVENTORY_IP));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ['credential']);
  assert.equal(protocol.isConnected(), false);
  const answered = {
    ...emptyKeySetup,
    requestSends: 1,
    requestAcknowledged: true,
    answers: 1,
    dataDatagrams: 1,
  };
  assert.deepEqual(protocol.getKeySetupObservation(), answered);
});

test('an answer too short to read counts as an answer and sets no key', async (t) => {
  const { protocol: short } = keySession(t);
  short.handleMsg(camId, from(INVENTORY_IP));
  short.handleMsg(dataMessage(CONTROL, 0, GATEWAYINFO, Buffer.from([1])), from(INVENTORY_IP));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(short.getKeySetupObservation(), {
    ...emptyKeySetup,
    requestSends: 1,
    answers: 1,
    dataDatagrams: 1,
  });
  assert.equal(short.isConnected(), true);
});

test('onKeySetup reports a cancelled attempt once, before the session closes', async () => {
  const {
    t: transport,
    station,
    calls,
    keyReads,
  } = connectionFixture({ answer: ['station found', 'connect'], keySetup: keyCounts });
  const controller = new AbortController();
  const observations = [];
  station.on('connect', () => queueMicrotask(() => controller.abort()));
  try {
    await assert.rejects(
      transport.connect('HB', controller.signal, undefined, undefined, (observation) =>
        observations.push({ observation, closes: calls.close }),
      ),
      { code: 'cancelled' },
    );
    assert.deepEqual(observations, [{ observation: keyCounts, closes: 0 }]);
    assert.deepEqual(keyReads, [{ closes: 0 }]);
    assert.equal(calls.close, 1);
  } finally {
    await transport.close();
  }
});

test('onKeySetup reports an attempt whose session the station ended, before the attempt closes it', async () => {
  const ended = { ...keyCounts, ended: true };
  const {
    t: transport,
    station,
    calls,
    keyReads,
  } = connectionFixture({ answer: ['station found', 'connect'], keySetup: ended });
  const observations = [];
  station.on('connect', () => queueMicrotask(() => station.emit('close', station)));
  try {
    await assert.rejects(
      transport.connect('HB', undefined, undefined, undefined, (observation) =>
        observations.push({ observation, closes: calls.close }),
      ),
      { code: 'device_disconnected' },
    );
    assert.deepEqual(observations, [{ observation: ended, closes: 0 }]);
    assert.deepEqual(keyReads, [{ closes: 0 }]);
  } finally {
    await transport.close();
  }
});

test('without onKeySetup the session observation is never read', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { t: transport, keyReads } = connectionFixture({ keySetup: keyCounts });
  const { t: failing, keyReads: failedReads } = connectionFixture({
    answer: ['station found', 'connect'],
    keySetup: keyCounts,
  });
  try {
    await transport.connect(
      'HB',
      undefined,
      () => {},
      () => {},
    );
    const connecting = failing.connect(
      'HB',
      undefined,
      () => {},
      () => {},
    );
    t.mock.timers.tick(20000);
    await assert.rejects(connecting, { code: 'device_request_timeout' });
    assert.deepEqual(keyReads, []);
    assert.deepEqual(failedReads, []);
  } finally {
    t.mock.timers.reset();
    await transport.close();
    await failing.close();
  }
});
