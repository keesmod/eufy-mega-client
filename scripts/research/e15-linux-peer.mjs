// One standalone Node 24 Linux research attempt. All input secrets stay private.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ownedTrial } from './e15-owned-trial.mjs';
import { connectMqtt } from './e15-trial-mqtt.mjs';
import { openSocket } from './e15-trial-socket.mjs';
import { TrialKcp } from './e15-peer-kcp.mjs';
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
} from './e15-peer-wire.mjs';

function same(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signalEnvelope(key, header, message, now = Date.now()) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-128-gcm', key, nonce);
  cipher.setAAD(header);
  const clear = Buffer.from(
    JSON.stringify({ protocol: 302, t: Math.floor(now / 1000), data: message }),
  );
  return Buffer.concat([header, nonce, cipher.update(clear), cipher.final(), cipher.getAuthTag()]);
}
export function decodeSignal(key, payload, expected, now = Date.now()) {
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
export function validateInputs(inputs, now = Date.now()) {
  const text = (value, max = 128) =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  const identity = (value) => text(value) && /^[A-Za-z0-9_-]+$/.test(value);
  const token = inputs?.tcpToken;
  if (
    !Number.isSafeInteger(inputs?.expiresAt) ||
    inputs.expiresAt <= now + 60000 ||
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
    !text(inputs.mqtt?.clientId, 256) ||
    !inputs.mqtt.clientId.endsWith('/mb/' + inputs.accountUid) ||
    !/^[0-9a-f]{24}$/i.test(inputs.mqttHeader ?? '') ||
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
    !Array.isArray(token.urls) ||
    token.urls.length !== 1 ||
    !/^tcp4:[A-Za-z0-9.-]+:[0-9]{1,5}$/.test(token.urls[0])
  )
    throw new Error('invalid-private-inputs');
}
export function matchingToken(actual, expected) {
  return (
    actual &&
    ['credential', 'domain', 'sessionId', 'username'].every(
      (field) => actual[field] === expected[field],
    ) &&
    Array.isArray(actual.urls) &&
    actual.urls.length === expected.urls.length &&
    actual.urls.every((url, index) => url === expected.urls[index])
  );
}
export async function linuxPeer(inputs, signal) {
  const events = [],
    key = randomBytes(16),
    localKey = Buffer.from(typeof inputs?.localKey === 'string' ? inputs.localKey : '');
  const event = (name) => {
    if (events.length < 64) events.push({ name, at: Math.round(performance.now()) });
  };
  const result = await ownedTrial(
    async (owner) => {
      if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) !== 24)
        throw new Error('linux-node24-required');
      validateInputs(inputs);
      owner.own({
        close: async () => {
          key.fill(0);
          localKey.fill(0);
          return true;
        },
      });
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
      event('mqtt-connect-start');
      const mqtt = await owner.track(() => connectMqtt(owner, inputs.mqtt));
      await owner.track(() => mqtt.subscribe(inputs.subscribeTopics));
      event('mqtt-authenticated');
      const outer = Buffer.from(inputs.mqttHeader, 'hex');
      if (outer.length !== 12 || outer.subarray(0, 3).toString() !== '2.3')
        throw new Error('invalid-header-profile');
      outer.writeUInt32BE((outer.readUInt32BE(7) + 1) >>> 0, 7);
      mqtt.publish(inputs.publishTopic, signalEnvelope(localKey, outer, offer));
      event('fresh-offer-sent');
      const expected = {
        from: inputs.peer,
        to: inputs.accountUid,
        sessionid: session,
        moto_id: inputs.motoId,
      };
      let accepted;
      for (let count = 0; count < 64 && !accepted; count++) {
        const msg = await owner.track(() => mqtt.receive());
        if (!inputs.subscribeTopics.includes(msg.topic) || msg.retained || msg.duplicate) continue;
        let answer;
        try {
          answer = decodeSignal(localKey, msg.payload, expected);
        } catch {
          event('foreign-or-invalid-signal-rejected');
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
        if (!answerKey || !same(answerKey, key.toString('hex')))
          throw new Error('answer-key-mismatch');
        accepted = answer;
      }
      if (!accepted) throw new Error('answer-missing');
      event('authenticated-answer');
      const endpoint = token.urls?.[0]?.match(/^tcp4:([^:]+):(\d+)$/);
      if (!endpoint) throw new Error('unsupported-carrier-endpoint');
      const io = openSocket(owner, { host: endpoint[1], port: Number(endpoint[2]) });
      await owner.track(() => io.connect());
      event('carrier-connected');
      const records = new RecordReader(),
        queue = [];
      owner.own({
        close: async () => {
          records.clear();
          return true;
        },
      });
      async function receiveRecord() {
        while (!queue.length) queue.push(...records.push(await io.read()));
        return queue.shift();
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
      const response = decodeHandshake(token, await owner.track(receiveRecord), 1);
      const challenge = response.authorization?.match(
        /^signature=([0-9a-f]{64}),random=([^,\r\n]{1,128})$/,
      );
      if (
        response.method !== 'response' ||
        (response.devId !== undefined && response.devId !== inputs.peer) ||
        (response.uId !== undefined && response.uId !== inputs.accountUid) ||
        !challenge ||
        !same(challenge[1], signature(token, inputs.accountUid, nonce))
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
      const complete = decodeHandshake(token, await owner.track(receiveRecord), 3);
      if (
        complete.method !== 'complete' ||
        complete.statuscode !== 200 ||
        (complete.devId !== undefined && complete.devId !== inputs.peer) ||
        (complete.uId !== undefined && complete.uId !== inputs.accountUid)
      )
        throw new Error('carrier-complete-invalid');
      owner.negotiated();
      event('carrier-authenticated');
      const kcp = new TrialKcp();
      owner.own({
        close: async () => {
          kcp.close();
          return true;
        },
      });
      const credential = createHash('md5')
        .update(inputs.password + '||' + inputs.localKey)
        .digest('hex');
      const request = randomBytes(2).readUInt16LE() || 1;
      for (const plain of [authorization(credential), versionRequest(request)]) {
        io.write(
          dataRecord(
            key,
            kcp.send(cbcEncrypt(key, randomBytes(16), plain), Math.floor(performance.now())),
          ),
        );
        plain.fill(0);
      }
      event('authorization-and-version-sent');
      let application = Buffer.alloc(0);
      for (let count = 0; count < 128; count++) {
        const record = await owner.track(receiveRecord);
        if (record.readUInt16BE() === 0xf500) continue;
        const inner = decodeData(key, record);
        const conversation = inner.readUInt32LE();
        if (conversation !== 0) {
          event('nonapplication-channel-' + conversation);
          if (conversation === 0x010000f3) continue;
          throw new Error('unexpected-kcp-channel');
        }
        const incoming = kcp.receive(inner);
        for (const ack of incoming.output) io.write(dataRecord(key, ack));
        for (const message of incoming.messages) {
          application = Buffer.concat([application, cbcDecrypt(key, message)]);
          if (application.length > 4096) throw new Error('application-limit');
          if (application.length >= 24) {
            const version = versionResponse(application, request);
            if (version.major === 0) throw new Error('invalid-peer-version');
            application.fill(0);
            event('correlated-version-response');
            return { authenticatedReadOnly: true };
          }
        }
      }
      throw new Error('peer-response-missing');
    },
    { signal },
  );
  key.fill(0);
  localKey.fill(0);
  return { ...result, events };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  process.once('SIGTERM', () => abort.abort());
  let result;
  try {
    const raw = await readFile(process.argv[2]);
    if (raw.length > 65536) throw new Error('input-limit');
    result = await linuxPeer(JSON.parse(raw.toString('utf8')), abort.signal);
  } catch {
    result = { success: false, reason: 'private-input-unreadable' };
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.success ? 0 : 1;
}
