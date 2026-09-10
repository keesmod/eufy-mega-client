// Portable session promoted from independently authored #78/#49 research.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  albumRequest,
  downloadRequest,
  cancelRequest,
  albumFiles,
  CommandReader,
  MapFileReader,
} from './framing.js';
import { MapLifetime } from './lifetime.js';
import { connectMqtt } from './mqtt.js';
import { openSocket } from './socket.js';
import { MapKcp } from './kcp.js';
import {
  RecordReader,
  handshake,
  decodeHandshake,
  signature,
  authorization,
  versionRequest,
  versionResponse,
  cbcEncrypt,
  cbcDecrypt,
  dataRecord,
  decodeData,
} from './wire.js';
import type { MapSessionProvisioning, RelayToken, MapStreamName } from './types.js';
interface SignalMessage {
  header: Record<string, string | number>;
  msg?: { tcp_token?: RelayToken; sdp?: string };
}
/** Internal-only network seam. Production always uses owned TCP and verified TLS MQTT. */
export const mapNetwork = { mqtt: connectMqtt, socket: openSocket };
function same(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signalEnvelope(key: Buffer, header: Buffer, message: unknown, now = Date.now()) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-128-gcm', key, nonce);
  cipher.setAAD(header);
  const clear = Buffer.from(
    JSON.stringify({ protocol: 302, t: Math.floor(now / 1000), data: message }),
  );
  return Buffer.concat([header, nonce, cipher.update(clear), cipher.final(), cipher.getAuthTag()]);
}
export function decodeSignal(
  key: Buffer,
  payload: Buffer,
  expected: Record<string, string>,
  now = Date.now(),
): SignalMessage {
  if (payload.length < 40 || payload.length > 32768 || payload.subarray(0, 3).toString() !== '2.3')
    throw new Error('invalid-signal-envelope');
  const cipher = createDecipheriv('aes-128-gcm', key, payload.subarray(12, 24));
  cipher.setAAD(payload.subarray(0, 12));
  cipher.setAuthTag(payload.subarray(-16));
  const body = JSON.parse(
    Buffer.concat([cipher.update(payload.subarray(24, -16)), cipher.final()]).toString('utf8'),
  );
  if (body.protocol !== 302 || !Number.isFinite(body.t) || Math.abs(now / 1000 - body.t) > 60)
    throw new Error('stale-signal');
  const h = body.data?.header;
  if (!h || !['from', 'to', 'sessionid', 'moto_id'].every((k) => h[k] === expected[k]))
    throw new Error('foreign-signal');
  return body.data;
}
export function validateInputs(inputs: MapSessionProvisioning, now = Date.now()) {
  const text = (value: unknown, max = 128) =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  const identity = (value: unknown) =>
    typeof value === 'string' && text(value) && /^[A-Za-z0-9_-]+$/.test(value);
  const token = inputs?.tcpToken;
  if (
    !Number.isSafeInteger(inputs?.expiresAt) ||
    inputs.expiresAt <= now + 65000 ||
    !identity(inputs.accountUid) ||
    !identity(inputs.peer) ||
    !text(inputs.localKey) ||
    Buffer.byteLength(inputs.localKey) !== 16 ||
    !text(inputs.password) ||
    typeof inputs.motoId !== 'string' ||
    inputs.motoId.length > 128 ||
    typeof inputs.preconnect !== 'boolean' ||
    !Array.isArray(inputs.iceTokens) ||
    inputs.iceTokens.length > 16 ||
    !text(inputs.mqtt?.username, 4096) ||
    !text(inputs.mqtt?.password, 4096) ||
    !/^m[0-9]+\.tuya(?:eu|us|cn|in)\.com$/.test(inputs.mqtt?.host ?? '') ||
    inputs.mqtt?.port !== 8883 ||
    !text(inputs.mqtt?.clientId, 256) ||
    !inputs.mqtt.clientId.endsWith('/mb/' + inputs.accountUid) ||
    !/^322e33[0-9a-f]{18}$/i.test(inputs.mqttHeader ?? '') ||
    !Array.isArray(inputs.subscribeTopics) ||
    inputs.subscribeTopics.length < 1 ||
    inputs.subscribeTopics.length > 4 ||
    !inputs.subscribeTopics.every(
      (topic) =>
        text(topic, 255) &&
        !/[+#\0]/.test(topic) &&
        (topic.endsWith('/' + inputs.peer) || topic.endsWith('/' + inputs.accountUid)),
    ) ||
    inputs.publishTopic !== 'smart/mb/out/' + inputs.peer ||
    !text(token?.credential, 64) ||
    Buffer.byteLength(token.credential) < 16 ||
    !text(token.username) ||
    !text(token.domain, 255) ||
    !Array.isArray(token.urls) ||
    token.urls.length !== 1 ||
    !/^tcp4:[A-Za-z0-9.-]+:[0-9]{1,5}$/.test(token.urls[0]!)
  )
    throw new Error('invalid-private-inputs');
  const port = Number(token.urls[0]!.split(':')[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('invalid-private-inputs');
}
export function matchingToken(actual: RelayToken | undefined, expected: RelayToken) {
  return (
    actual &&
    (['credential', 'domain', 'sessionId', 'username'] as const).every(
      (field) => actual[field] === expected[field],
    ) &&
    Array.isArray(actual.urls) &&
    actual.urls.length === expected.urls.length &&
    actual.urls.every((url, index) => url === expected.urls[index])
  );
}

export async function runMapSession(
  inputs: MapSessionProvisioning,
  owner: MapLifetime,
  publish: (files: Array<{ name: MapStreamName; data: Buffer }>) => void,
  network = mapNetwork,
): Promise<boolean> {
  const key = randomBytes(16),
    localKey = Buffer.from(inputs.localKey);
  owner.own({
    close: async () => {
      key.fill(0);
      localKey.fill(0);
      return true;
    },
  });
  const negotiation = owner.timer(() => owner.stop('negotiation_timeout'), 15000);
  const session = randomBytes(20).toString('hex'),
    carrierSession = randomBytes(20).toString('hex');
  const token = { ...inputs.tcpToken, sessionId: carrierSession };
  const sdp = [
    'v=0',
    `o=- ${Math.floor(Date.now() / 1000)} 1 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE imm0',
    `a=msid-semantic: WMS ${randomBytes(20).toString('hex')}`,
    'm=application 9 imm 6001',
    'c=IN IP4 0.0.0.0',
    'a=rtcp:9 IN IP4 0.0.0.0',
    `a=ice-ufrag:${randomBytes(2).toString('hex')}`,
    `a=ice-pwd:${randomBytes(12).toString('hex')}`,
    'a=ice-options:trickle',
    `a=aes-key:${key.toString('hex')}`,
    'a=mid:imm0',
    'a=rtpmap:6001 AES/KCP 330',
    `a=ssrc:0 cname:${inputs.accountUid}`,
    '',
  ].join('\r\n');
  const header = {
    from: inputs.accountUid,
    to: inputs.peer,
    sessionid: session,
    moto_id: inputs.motoId,
    type: 'offer',
    trace_id: randomBytes(16).toString('hex'),
    is_pre: 0,
    p2p_skill: 1603,
    security_level: 3,
    path: 'mqtt',
  };
  const offer = {
    header,
    msg: { sdp, preconnect: inputs.preconnect, token: inputs.iceTokens, tcp_token: token },
  };

  const mqtt = await owner.negotiating(network.mqtt(owner, inputs.mqtt));
  await owner.negotiating(mqtt.subscribe(inputs.subscribeTopics));

  const outer = Buffer.from(inputs.mqttHeader, 'hex');
  if (outer.length !== 12 || outer.subarray(0, 3).toString() !== '2.3')
    throw new Error('invalid-header-profile');
  outer.writeUInt32BE((outer.readUInt32BE(7) + 1) >>> 0, 7);
  mqtt.publish(inputs.publishTopic, signalEnvelope(localKey, outer, offer));

  const expected = {
    from: inputs.peer,
    to: inputs.accountUid,
    sessionid: session,
    moto_id: inputs.motoId,
  };
  let accepted: SignalMessage | undefined;
  for (let count = 0; count < 64 && !accepted; count++) {
    const msg = await owner.negotiating(mqtt.receive());
    if (!inputs.subscribeTopics.includes(msg.topic) || msg.retained || msg.duplicate) continue;
    let answer: SignalMessage;
    try {
      answer = decodeSignal(localKey, msg.payload, expected);
    } catch {
      continue;
    }
    if (answer.header.type !== 'answer') continue;
    if (
      answer.header.security_level !== 3 ||
      !answer.msg ||
      !matchingToken(answer.msg.tcp_token, token)
    )
      throw new Error('answer-token-mismatch');
    const answerKey = answer.msg.sdp?.match(/(?:^|\r?\n)a=aes-key:([^\r\n]+)/)?.[1];
    if (!answerKey || !same(answerKey, key.toString('hex'))) throw new Error('answer-key-mismatch');
    accepted = answer;
  }
  if (!accepted) throw new Error('answer-missing');

  const endpoint = token.urls?.[0]?.match(/^tcp4:([^:]+):(\d+)$/);
  if (!endpoint) throw new Error('unsupported-carrier-endpoint');
  const io = network.socket(owner, { host: endpoint[1]!, port: Number(endpoint[2]) });
  await owner.negotiating(io.connect());

  const records = new RecordReader(),
    queue: Buffer[] = [];
  owner.own({
    close: async () => {
      records.clear();
      for (const record of queue) record.fill(0);
      queue.length = 0;
      return true;
    },
  });
  async function receiveRecord() {
    while (!queue.length) queue.push(...records.push(await io.read()));
    return queue.shift()!;
  }
  const nonce = randomBytes(16).toString('hex'),
    ident = { clientType: 1, devId: inputs.peer, uId: inputs.accountUid };
  io.write(
    handshake(
      token,
      0,
      { ...ident, method: 'request', authorization: 'random=' + nonce },
      randomBytes(16),
    ),
  );
  const response = decodeHandshake(token, await owner.negotiating(receiveRecord()), 1);
  const challenge =
    typeof response.authorization === 'string'
      ? response.authorization.match(/^signature=([0-9a-f]{64}),random=([^,\r\n]{1,128})$/)
      : undefined;
  if (
    response.method !== 'response' ||
    (response.devId !== undefined && response.devId !== inputs.peer) ||
    (response.uId !== undefined && response.uId !== inputs.accountUid) ||
    !challenge ||
    !same(challenge[1]!, signature(token, inputs.accountUid, nonce))
  )
    throw new Error('carrier-challenge-invalid');
  io.write(
    handshake(
      token,
      2,
      {
        ...ident,
        method: 'ack',
        statuscode: 200,
        authorization:
          'signature=' + signature(token, inputs.accountUid, challenge[1] + ':' + challenge[2]),
      },
      randomBytes(16),
    ),
  );
  const complete = decodeHandshake(token, await owner.negotiating(receiveRecord()), 3);
  if (
    complete.method !== 'complete' ||
    complete.statuscode !== 200 ||
    (complete.devId !== undefined && complete.devId !== inputs.peer) ||
    (complete.uId !== undefined && complete.uId !== inputs.accountUid)
  )
    throw new Error('carrier-complete-invalid');

  const kcp = new MapKcp({ sendLimit: 5, messageLimit: 16384 });
  const filesKcp = new MapKcp({ channel: 5, sendLimit: 0, messageLimit: 16384 });
  const commands = new CommandReader();
  const task = randomBytes(2).readUInt16LE() || 1;
  const albumId = task * 65536 + 1,
    downloadId = task * 65536 + 2,
    cancelId = task * 65536 + 3;
  const fileReader = new MapFileReader(task);
  let application: Buffer = Buffer.alloc(0);
  owner.own({
    close: async () => {
      kcp.close();
      filesKcp.close();
      commands.close();
      fileReader.close();
      application.fill(0);
      return true;
    },
  });
  const send = (plain: Buffer) => {
    try {
      io.write(
        dataRecord(
          key,
          kcp.send(cbcEncrypt(key, randomBytes(16), plain), Math.floor(performance.now())),
        ),
      );
    } finally {
      plain.fill(0);
    }
  };
  const credential = createHash('md5')
    .update(inputs.password + '||' + inputs.localKey)
    .digest('hex');
  const versionId = randomBytes(2).readUInt16LE() || 1;
  send(authorization(credential));
  send(versionRequest(versionId));
  let stage: 'version' | 'album' | 'download' | 'cancel' = 'version';
  let acceptedDownload = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let staged: Array<{ name: MapStreamName; data: Buffer }> = [];
  owner.own({
    close: async () => {
      for (const f of staged) f.data.fill(0);
      staged = [];
      return true;
    },
  });
  let pending: Promise<Buffer> | undefined;
  const stopRead = owner.stopped.then(() => undefined);
  for (let count = 0; count < 32768; count++) {
    if (owner.reason && stage !== 'cancel') {
      if (stage !== 'download') throw new Error('session-stopped');
      stage = 'cancel';
      send(cancelRequest(cancelId));
      cancelTimer = owner.timer(() => owner.hard.abort(), 5000);
    }
    pending ??= receiveRecord();
    // Keep the existing read when demand ends. Never install a competing reader.
    const record = stage === 'cancel' ? await pending : await Promise.race([pending, stopRead]);
    if (!record) continue;
    pending = undefined;
    if (record.readUInt16BE() === 0xf500) continue;
    const inner = decodeData(key, record);
    const conversation = inner.readUInt32LE();
    if (conversation === 0x010000f3) continue;
    const receiver = conversation === 0 ? kcp : conversation === 5 ? filesKcp : undefined;
    if (!receiver) throw new Error('unexpected-kcp-channel');
    const incoming = receiver.receive(inner);
    for (const ack of incoming.output) io.write(dataRecord(key, ack));
    for (const message of incoming.messages) {
      const clear = cbcDecrypt(key, message);
      try {
        if (conversation === 5) {
          if (stage !== 'download' && stage !== 'cancel') throw new Error('early-file-data');
          const completed = fileReader.push(clear);
          // A cancellation freezes publication. Late packets can only confirm closure.
          if (stage === 'download' && !owner.reason) {
            if (acceptedDownload) publish(completed);
            else {
              for (const file of completed) {
                const old = staged.find((f) => f.name === file.name);
                if (old) {
                  old.data.fill(0);
                  staged = staged.filter((f) => f !== old);
                }
                staged.push(file);
              }
            }
          } else for (const file of completed) file.data.fill(0);
          if (fileReader.terminal && stage === 'download') owner.stop('stream_ended');
          continue;
        }
        if (stage === 'version') {
          if (application.length + clear.length > 4096) throw new Error('application-limit');
          application = Buffer.concat([application, clear]);
          if (application.length < 24) continue;
          if (!versionResponse(application, versionId).major)
            throw new Error('invalid-peer-version');
          application.fill(0);
          owner.clear(negotiation);
          if (owner.reason) throw new Error('session-stopped');
          stage = 'album';
          send(albumRequest(albumId));
          continue;
        }
        for (const reply of commands.push(clear)) {
          if (reply.main !== 100) throw new Error('unexpected-command');
          if (stage === 'album' && reply.request === albumId && reply.sub === 12) {
            const files = albumFiles(reply.payload);
            if (owner.reason) throw new Error('session-stopped');
            stage = 'download';
            send(downloadRequest(downloadId, files));
          } else if (
            (stage === 'download' || stage === 'cancel') &&
            !acceptedDownload &&
            reply.request === downloadId &&
            reply.sub === 13 &&
            reply.payload.length === 8 &&
            reply.payload.readUInt32LE(4) === 1
          ) {
            acceptedDownload = true;
            if (!owner.reason) publish(staged);
            else for (const file of staged) file.data.fill(0);
            staged = [];
          } else if (
            stage === 'cancel' &&
            reply.request === cancelId &&
            reply.sub === 13 &&
            reply.payload.length === 8 &&
            [1, 3].includes(reply.payload.readUInt32LE(4))
          ) {
            if (cancelTimer) owner.clear(cancelTimer);
            return true;
          } else throw new Error('uncorrelated-map-command');
        }
      } finally {
        clear.fill(0);
      }
    }
  }
  throw new Error('peer-message-limit');
}
