import { openSocket } from './e15-trial-socket.mjs';
const string = (value) => {
  const b = Buffer.from(value),
    out = Buffer.alloc(2 + b.length);
  if (b.length > 8192) throw new Error('mqtt-string-limit');
  out.writeUInt16BE(b.length);
  b.copy(out, 2);
  return out;
};
const packet = (type, body) => {
  let n = body.length;
  const length = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n) b |= 128;
    length.push(b);
  } while (n);
  return Buffer.concat([Buffer.from([type, ...length]), body]);
};
export async function connectMqtt(owner, credentials) {
  if (!/^m[0-9]+\.tuya(?:eu|us|cn|in)\.com$/.test(credentials.host) || credentials.port !== 8883)
    throw new Error('mqtt-endpoint-invalid');
  const io = openSocket(owner, { host: credentials.host, port: 8883 }, true);
  await io.connect();
  let buffer = Buffer.alloc(0),
    next = 1;
  async function read() {
    while (true) {
      if (buffer.length >= 2) {
        let n = 0,
          m = 1,
          index = 1,
          complete = false;
        for (; index < buffer.length && index <= 4; index++) {
          const b = buffer[index];
          n += (b & 127) * m;
          m *= 128;
          if (!(b & 128)) {
            index++;
            complete = true;
            break;
          }
        }
        if (n > 32768 || (!complete && index > 4)) throw new Error('mqtt-packet-limit');
        if (complete && buffer.length >= index + n) {
          const result = { type: buffer[0], body: buffer.subarray(index, index + n) };
          buffer = buffer.subarray(index + n);
          return result;
        }
      }
      const b = await io.read();
      if (buffer.length + b.length > 65536) throw new Error('mqtt-buffer-limit');
      buffer = Buffer.concat([buffer, b]);
    }
  }
  const header = Buffer.from([0, 4, 77, 81, 84, 84, 4, 0xc2, 0, 60]);
  io.write(
    packet(
      0x10,
      Buffer.concat([
        header,
        string(credentials.clientId),
        string(credentials.username),
        string(credentials.password),
      ]),
    ),
  );
  const conn = await read();
  if (conn.type !== 0x20 || conn.body.length !== 2 || conn.body[1] !== 0 || conn.body[0] !== 0)
    throw new Error('mqtt-authentication-failed');
  return {
    async subscribe(topics) {
      const id = next++;
      const body = Buffer.alloc(2);
      body.writeUInt16BE(id);
      io.write(
        packet(
          0x82,
          Buffer.concat([body, ...topics.map((t) => Buffer.concat([string(t), Buffer.from([1])]))]),
        ),
      );
      const response = await read();
      if (
        response.type !== 0x90 ||
        response.body.readUInt16BE() !== id ||
        response.body.length !== topics.length + 2 ||
        response.body.subarray(2).some((v) => v > 1)
      )
        throw new Error('mqtt-subscribe-failed');
    },
    publish(topic, payload) {
      const id = Buffer.alloc(2);
      id.writeUInt16BE(next++);
      io.write(packet(0x32, Buffer.concat([string(topic), id, payload])));
    },
    async receive() {
      for (let i = 0; i < 128; i++) {
        const message = await read();
        if (message.type === 0x40 || message.type === 0xd0) continue;
        if (message.type >>> 4 !== 3 || message.body.length < 2)
          throw new Error('mqtt-message-invalid');
        const qos = (message.type >>> 1) & 3,
          length = message.body.readUInt16BE();
        let offset = 2 + length;
        if (qos > 1 || offset > message.body.length) throw new Error('mqtt-publish-invalid');
        const topic = message.body.subarray(2, offset).toString('utf8');
        if (qos === 1) {
          if (offset + 2 > message.body.length) throw new Error('mqtt-publish-invalid');
          io.write(packet(0x40, message.body.subarray(offset, offset + 2)));
          offset += 2;
        }
        return {
          topic,
          payload: message.body.subarray(offset),
          retained: !!(message.type & 1),
          duplicate: !!(message.type & 8),
        };
      }
      throw new Error('mqtt-message-limit');
    },
  };
}
