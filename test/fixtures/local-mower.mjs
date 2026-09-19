// Synthetic E15 LAN peer for tests. Written independently from the device-side description in
// docs/MOWER_TRANSPORT_PROVENANCE.md. Synthetic key, identity and values only. No household bytes.
import net from 'node:net';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export const localKey = 'synthetic-key-16';
export const deviceId = 'SYNTHETIC-DEVICE-ID';
export const dps = { 1: true, 3: 'STANDBY', 6: 87, 101: { nested: [1, 2, 'x'] }, 102: null };

/** Device-side serializer: head, 14-byte authenticated header, nonce, GCM body, tag, tail. */
export function deviceFrame(key, sequence, type, plaintext, nonce = randomBytes(12)) {
  const head = Buffer.from([0, 0, 0x66, 0x99]);
  const ad = Buffer.alloc(14);
  ad.writeUInt32BE(sequence, 2);
  ad.writeUInt32BE(type, 6);
  ad.writeUInt32BE(12 + plaintext.length + 16, 10);
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  cipher.setAAD(ad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tail = Buffer.from([0, 0, 0x99, 0x66]);
  return Buffer.concat([head, ad, nonce, body, cipher.getAuthTag(), tail]);
}
/** Device-side reply plaintext: four-byte return code followed by data. */
export function reply(code, data) {
  const out = Buffer.alloc(4 + data.length);
  out.writeUInt32LE(code, 0);
  data.copy(out, 4);
  return out;
}
function deviceParse(key, bytes) {
  const length = bytes.readUInt32BE(14);
  const ad = bytes.subarray(4, 18);
  const nonce = bytes.subarray(18, 30);
  const tag = bytes.subarray(18 + length - 16, 18 + length);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAAD(ad);
  decipher.setAuthTag(tag);
  const data = Buffer.concat([
    decipher.update(bytes.subarray(30, 18 + length - 16)),
    decipher.final(),
  ]);
  return { sequence: bytes.readUInt32BE(6), type: bytes.readUInt32BE(10), data };
}
const mac = (key, data) => createHmac('sha256', key).update(data).digest();

export async function fakeMower(t, config = {}) {
  const key = Buffer.from(config.localKey ?? localKey);
  const identity = config.deviceId ?? deviceId;
  const peer = {
    host: '127.0.0.1',
    port: 0,
    localKey: config.localKey ?? localKey,
    deviceId: identity,
    connections: 0,
    live: 0,
    negotiated: 0,
    received: [],
    /** Decoded control commands: version header text, parsed document and data points. */
    writes: [],
    faults: [],
    sockets: new Set(),
    reporters: new Set(),
  };
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };
  const write = (socket, bytes) => {
    if (socket.destroyed) return;
    if (config.splitWrites) for (const byte of bytes) socket.write(Buffer.from([byte]));
    else socket.write(bytes);
  };
  const server = net.createServer((socket) => {
    peer.connections++;
    peer.live++;
    peer.sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => {
      peer.live--;
      peer.sockets.delete(socket);
    });
    let secret;
    let randA;
    let randB;
    let lastSequence = 0;
    let outgoing = 1000;
    let buffer = Buffer.alloc(0);
    const report = (dps, options = {}) => {
      if (!secret) throw new Error('peer not negotiated');
      const json =
        options.body ??
        JSON.stringify({ protocol: 4, t: 1, data: { dps, devId: options.deviceId ?? identity } });
      const payload = Buffer.concat([Buffer.from('3.5'), Buffer.alloc(12), Buffer.from(json)]);
      const bytes = deviceFrame(
        secret,
        options.sequence ?? 0,
        options.command ?? 8,
        reply(options.code ?? 0, payload),
      );
      if (options.tamper) bytes[bytes.length - 5] ^= 1;
      write(socket, bytes);
    };
    peer.reporters.add(report);
    socket.on('close', () => peer.reporters.delete(report));
    const fault = (reason) => {
      peer.faults.push(reason);
      socket.destroy();
    };
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 18) {
        if (buffer.readUInt32BE(0) !== 0x00006699) return fault('head');
        const total = 18 + buffer.readUInt32BE(14) + 4;
        if (buffer.length < total) return;
        const raw = buffer.subarray(0, total);
        buffer = buffer.subarray(total);
        if (raw.readUInt32BE(total - 4) !== 0x00009966) return fault('tail');
        const type = raw.readUInt32BE(10);
        const negotiation = type === 3 || type === 4 || type === 5;
        if (negotiation && secret) return fault('renegotiation');
        if (!negotiation && !secret) return fault('no-session-key');
        let frame;
        try {
          frame = deviceParse(negotiation ? key : secret, raw);
        } catch {
          if (config.ignoreUndecryptable) continue;
          return fault('decrypt');
        }
        peer.received.push({ type: frame.type, sequence: frame.sequence });
        if (frame.sequence <= lastSequence) return fault('sequence');
        lastSequence = frame.sequence;
        if (frame.type === 3) {
          if (config.stallNegotiation) return;
          if (config.dropOnStart) return socket.destroy();
          randA = Buffer.from(frame.data.subarray(0, 16));
          randB = randomBytes(16);
          const proof = config.wrongHmac ? randomBytes(32) : mac(key, randA);
          const answer = deviceFrame(
            key,
            frame.sequence,
            4,
            reply(0, Buffer.concat([randB, proof])),
          );
          if (config.tamperNegotiation) answer[answer.length - 5] ^= 1;
          write(socket, answer);
        } else if (frame.type === 5) {
          if (!randB || !mac(key, randB).equals(frame.data.subarray(0, 32))) return fault('hmac');
          const mixed = Buffer.alloc(16);
          for (let i = 0; i < 16; i++) mixed[i] = randA[i] ^ randB[i];
          const cipher = createCipheriv('aes-128-gcm', key, randA.subarray(0, 12));
          secret = Buffer.concat([cipher.update(mixed), cipher.final()]);
          peer.negotiated++;
        } else if (frame.type === 0x10) {
          if (config.hang) return;
          const answer = () => {
            if (config.pushFirst) {
              const report = Buffer.concat([
                Buffer.from('3.5'),
                Buffer.alloc(12),
                Buffer.from(JSON.stringify({ protocol: 4, t: 1, data: { dps: { 6: 1 } } })),
              ]);
              write(socket, deviceFrame(secret, outgoing++, 8, reply(0, report)));
              write(socket, deviceFrame(secret, 0, 9, reply(0, Buffer.alloc(0))));
            }
            if (config.garbage) write(socket, Buffer.from('not a frame at all'));
            if (config.oversized) {
              const huge = Buffer.alloc(18);
              huge.writeUInt32BE(0x00006699, 0);
              huge.writeUInt32BE(70000, 14);
              return write(socket, huge);
            }
            const body =
              config.respond?.(frame) ??
              JSON.stringify({ dps, devId: config.wrongDeviceId ? 'OTHER-DEVICE' : identity });
            const data = config.versionHeader
              ? Buffer.concat([Buffer.from('3.5'), Buffer.alloc(12), Buffer.from(body)])
              : Buffer.from(body);
            const plaintext = config.rejectQuery
              ? reply(1, Buffer.from('json obj data unvalid'))
              : reply(0, data);
            const sequence = config.globalSequence ? outgoing++ : frame.sequence;
            const out = deviceFrame(secret, sequence, 0x10, plaintext);
            if (config.tamperResponse) out[out.length - 5] ^= 1;
            if (config.closeInsteadOfAnswer) return socket.destroy();
            write(socket, out);
          };
          if (config.delayMs) later(answer, config.delayMs);
          else answer();
        } else if (frame.type === 9) {
          write(socket, deviceFrame(secret, 0, 9, reply(0, Buffer.alloc(0))));
        } else if (frame.type === 0x0d) {
          // Device-side control handling: strip the 15-byte version header, require a
          // JSON document with data.dps, answer with the device's own counter and return
          // code 1, carrying a description only when the document is unusable.
          const header = frame.data.subarray(0, 15);
          let document;
          let describe;
          try {
            document = JSON.parse(frame.data.subarray(15).toString('utf8'));
            if (!document?.data?.dps || typeof document.data.dps !== 'object') throw new Error();
          } catch {
            describe = 'data format error';
          }
          const entry = {
            sequence: frame.sequence,
            version: header.subarray(0, 3).toString('latin1'),
            headerZeros: header.subarray(3).every((byte) => byte === 0),
            document,
            dps: document?.data?.dps,
          };
          peer.writes.push(entry);
          if (config.rejectControl) describe = 'data format error';
          if (!config.silentControl) {
            const text = Buffer.from(describe ?? '', 'utf8');
            const out = deviceFrame(
              secret,
              outgoing++,
              0x0d,
              reply(config.controlCode ?? (describe ? 1 : 0), text),
            );
            if (config.delayControlMs) later(() => write(socket, out), config.delayControlMs);
            else write(socket, out);
          }
          if (!describe) config.onWrite?.(entry.dps, report, entry);
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  peer.port = server.address().port;
  peer.report = (dps, options) => {
    for (const report of peer.reporters) report(dps, options);
  };
  peer.drop = () => {
    for (const socket of peer.sockets) socket.destroy();
  };
  peer.close = () =>
    new Promise((resolve) => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      peer.drop();
      server.close(() => resolve());
    });
  t.after(() => peer.close());
  return peer;
}
