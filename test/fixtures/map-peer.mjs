// Synthetic peer authored from the public #78/#49 observations. No household bytes.
import { createDecipheriv, randomBytes } from 'node:crypto';
import { mapNetwork, signalEnvelope } from '../../dist/mowers/maps/session.js';
import {
  handshake,
  decodeHandshake,
  signature,
  decodeData,
  cbcDecrypt,
  cbcEncrypt,
  dataRecord,
} from '../../dist/mowers/maps/wire.js';
export const names = ['map.bin.stream', 'cleanPath.bin.stream', 'navPath.bin.stream'];
export function provisioning() {
  return {
    expiresAt: Date.now() + 120000,
    accountUid: 'synthetic_account',
    peer: 'synthetic_peer',
    localKey: '0123456789abcdef',
    password: 'synthetic_password',
    motoId: '',
    preconnect: false,
    iceTokens: [],
    tcpToken: {
      credential: 'synthetic-relay-credential',
      username: 'user',
      domain: 'relay.invalid',
      urls: ['tcp4:relay.invalid:443'],
    },
    mqtt: {
      host: 'm1.tuyaeu.com',
      port: 8883,
      clientId: 'test/mb/synthetic_account',
      username: 'user',
      password: 'synthetic_secret',
    },
    mqttHeader: Buffer.concat([Buffer.from('2.3'), Buffer.alloc(9)]).toString('hex'),
    subscribeTopics: ['smart/mb/in/synthetic_account'],
    publishTopic: 'smart/mb/out/synthetic_peer',
  };
}
export function filePacket(name, index, data, { task = 1, end = 1, total = data.length } = {}) {
  const b = Buffer.alloc(80 + data.length);
  b.writeUInt32LE(1);
  b.writeUInt32LE(1000, 4);
  b.writeUInt16LE(task, 10);
  b.writeInt32LE(index, 12);
  b.writeUInt32LE(3, 16);
  b.write(name, 20);
  b.writeUInt32LE(data.length, 68);
  b.writeUInt32LE(total, 72);
  b.writeUInt32LE(end, 76);
  data.copy(b, 80);
  return b;
}
function reply(request, main, sub, payload) {
  const b = Buffer.alloc(20 + payload.length);
  b.writeUInt32LE(0x12345678);
  b.writeUInt32LE(request, 4);
  b.writeUInt32LE(1, 8);
  b.writeUInt16LE(main, 12);
  b.writeUInt16LE(sub, 14);
  b.writeUInt32LE(payload.length, 16);
  payload.copy(b, 20);
  return b;
}
export function fakePeer(t, config = {}) {
  const inputs = provisioning();
  const peer = { commands: [], sessions: [], closed: 0, live: 0, inputs };
  const timers = new Set();
  peer.later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
  });
  let offer, key, token, answer;
  t.mock.method(mapNetwork, 'mqtt', async (owner) => {
    peer.live++;
    owner.own({
      close: async () => {
        peer.live--;
        peer.closed++;
        return config.cleanupConfirmed !== false;
      },
    });
    return {
      subscribe: async () => {},
      publish: (_topic, payload) => {
        const decipher = createDecipheriv(
          'aes-128-gcm',
          Buffer.from(inputs.localKey),
          payload.subarray(12, 24),
        );
        decipher.setAAD(payload.subarray(0, 12));
        decipher.setAuthTag(payload.subarray(-16));
        offer = JSON.parse(
          Buffer.concat([decipher.update(payload.subarray(24, -16)), decipher.final()]).toString(),
        ).data;
        token = offer.msg.tcp_token;
        key = Buffer.from(offer.msg.sdp.match(/a=aes-key:([0-9a-f]+)/)[1], 'hex');
        peer.sessions.push(offer.header.sessionid);
        answer = {
          header: { ...offer.header, from: inputs.peer, to: inputs.accountUid, type: 'answer' },
          msg: offer.msg,
        };
        config.answer?.(answer);
      },
      receive: async () => ({
        topic: inputs.subscribeTopics[0],
        payload: signalEnvelope(
          Buffer.from(inputs.localKey),
          Buffer.from(inputs.mqttHeader, 'hex'),
          answer,
        ),
        retained: false,
        duplicate: false,
      }),
    };
  });
  t.mock.method(mapNetwork, 'socket', (owner) => {
    peer.live++;
    const queue = [];
    let waiter,
      failure,
      phase = 0,
      una = 0,
      task,
      index = 0;
    const sequence = { 0: 0, 5: 0 };
    function push(bytes) {
      if (failure) return;
      queue.push(Buffer.from(bytes));
      waiter?.resolve();
      waiter = undefined;
    }
    function fail() {
      failure = new Error('socket-closed');
      waiter?.reject(failure);
      waiter = undefined;
    }
    const aborted = () => fail();
    owner.signal.addEventListener('abort', aborted, { once: true });
    owner.own({
      close: async () => {
        fail();
        queue.length = 0;
        owner.signal.removeEventListener('abort', aborted);
        peer.closed++;
        peer.live--;
        return true;
      },
    });
    function application(channel, clear) {
      // CBC encryption applies to each <=1300-byte chunk, before independent channel sequencing.
      for (let offset = 0; offset < clear.length; offset += 1300) {
        const encrypted = cbcEncrypt(key, randomBytes(16), clear.subarray(offset, offset + 1300));
        const b = Buffer.alloc(24 + encrypted.length);
        b.writeUInt32LE(channel);
        b[4] = 81;
        b.writeUInt16LE(128, 6);
        b.writeUInt32LE(sequence[channel]++, 12);
        b.writeUInt32LE(channel === 0 ? una : 0, 16);
        b.writeUInt32LE(encrypted.length, 20);
        encrypted.copy(b, 24);
        push(dataRecord(key, b));
      }
    }
    peer.raw = (b) => application(5, b);
    peer.file = (name, data, options = {}) =>
      application(5, filePacket(name, index++, Buffer.from(data), { task, ...options }));
    peer.drop = fail;
    peer.complete = () => names.forEach((name, i) => peer.file(name, 'synthetic-' + i));
    const operation = (request, op) => {
      const p = Buffer.alloc(8);
      p.writeUInt32LE(op, 4);
      application(0, reply(request, 100, 13, p));
    };
    return {
      connect: async () => {},
      read: async () => {
        while (!queue.length) {
          if (failure) throw failure;
          await new Promise((resolve, reject) => {
            waiter = { resolve, reject };
          });
        }
        if (failure) throw failure;
        return queue.shift();
      },
      write: (bytes) => {
        if (failure) throw failure;
        if (phase === 0) {
          const request = decodeHandshake(token, bytes, 0);
          phase++;
          push(
            handshake(
              token,
              1,
              {
                method: 'response',
                authorization:
                  'signature=' +
                  signature(token, inputs.accountUid, request.authorization.slice(7)) +
                  ',random=synthetic_challenge',
              },
              randomBytes(16),
            ),
          );
          return;
        }
        if (phase === 1) {
          decodeHandshake(token, bytes, 2);
          phase++;
          push(handshake(token, 3, { method: 'complete', statuscode: 200 }, randomBytes(16)));
          return;
        }
        const inner = decodeData(key, bytes);
        if (inner[4] !== 81) return;
        una = inner.readUInt32LE(12) + 1;
        const clear = cbcDecrypt(key, inner.subarray(24));
        if (clear.length === 104 && clear.subarray(8, 13).toString() === 'admin') {
          peer.commands.push('auth');
          return;
        }
        const request = clear.readUInt32LE(4),
          main = clear.readUInt16LE(12),
          sub = clear.readUInt16LE(14);
        if (main === 10) {
          peer.commands.push('version');
          const p = Buffer.alloc(4);
          p.writeUInt32LE(0x10000);
          if (!config.noVersion) application(0, reply(request, 10, 0, p));
        } else if (main === 100 && sub === 12) {
          peer.commands.push('album');
          const p = Buffer.alloc(760);
          p.writeUInt32LE(3, 4);
          p.writeUInt32LE(3, 516);
          names.forEach((name, i) => {
            p[524 + i * 80] = 1;
            p.write(name, 528 + i * 80);
          });
          application(0, reply(request, 100, 12, p));
        } else if (main === 100 && sub === 13 && clear.readUInt32LE(24) === 0) {
          peer.commands.push('download');
          task = request >>> 16;
          peer.task = task;
          if (!config.delayedAcceptance) operation(request, 1);
          (config.download ?? (() => peer.complete()))(peer);
          if (config.delayedAcceptance) operation(request, 1);
        } else if (main === 100 && sub === 13 && clear.readUInt32LE(24) === 4) {
          peer.commands.push('cancel');
          config.cancel?.(peer);
          if (!config.noCancel) operation(config.wrongCancel ? request + 1 : request, 3);
        } else throw new Error('unexpected-synthetic-command');
      },
    };
  });
  return peer;
}
