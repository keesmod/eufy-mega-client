// Research probe for #157: two concurrent live streams on one HomeBase through
// one P2P session per camera. Uses the client option maxLiveStreamsPerStation
// (0.13.0) with a value of 2 and reads the transport's private state for evidence.
// Runs on the LAN of one HomeBase with at least two cameras of one model. Every
// attempt is bounded, every stop must be confirmed by the device, and the output
// carries labels (station, camA, camB) instead of identifiers. Keep the session
// and credentials files private and delete them afterwards.
//
// Usage from a built checkout of the prototype branch:
//   EUFY_SESSION_FILE=/private/path/mega-session.json \
//   EUFY_CREDENTIALS_FILE=/private/path/credentials.json \
//   [CAMERA_MODEL=T8160] [CAMERA_A=0 CAMERA_B=1] [PHASES=concurrent,cancel] \
//   [EVIDENCE_DIR=/private/path/evidence] node scripts/research/concurrent-live-probe.mjs
// Credentials use { email | username, password, country }. A copied session from
// another host needs its cached identities cleared before reuse.
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';

const dist = process.env.PROBE_DIST ?? new URL('../../dist/', import.meta.url).pathname;
const { EufyMegaClient, FileSessionStore } = await import(
  pathToFileURL(`${dist.replace(/\/$/, '')}/index.js`).href
);

const evidenceDir =
  process.env.EVIDENCE_DIR ??
  new URL('../../private/concurrent-live-evidence/', import.meta.url).pathname;
await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = `${evidenceDir}/run-${runId}.jsonl`;
const t0 = Date.now();
const emit = async (stage, value = {}) => {
  const line = JSON.stringify({ t: Date.now() - t0, stage, ...value });
  process.stdout.write(line + '\n');
  await appendFile(logFile, line + '\n', { mode: 0o600 });
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const SOLO_MS = num(process.env.SOLO_MS, 8000);
const OBSERVE_MS = num(process.env.OBSERVE_MS, 20000);
const AFTER_MS = num(process.env.AFTER_MS, 5000);
const CANCEL_AFTER_MS = num(process.env.CANCEL_AFTER_MS, 250);
const PHASES = (process.env.PHASES ?? 'concurrent,cancel').split(',');
if (SOLO_MS + OBSERVE_MS + AFTER_MS > 45000)
  throw new Error('attempt budget exceeds 60 seconds with stops');

const sessionFile = process.env.EUFY_SESSION_FILE;
if (!sessionFile) throw new Error('EUFY_SESSION_FILE is required');
let credentials;
if (process.env.EUFY_CREDENTIALS_FILE) {
  const raw = JSON.parse(await readFile(process.env.EUFY_CREDENTIALS_FILE, 'utf8'));
  // The bridge stores { username, password, country }. The client wants email.
  credentials = {
    email: raw.email ?? raw.username,
    password: raw.password,
    country: raw.country ?? 'NL',
  };
} else {
  // A stored session must exist. Placeholder credentials are never sent unless the
  // token is missing or expired, and then the login fails visibly instead.
  credentials = { email: 'unused@example.invalid', password: 'unused', country: 'NL' };
}

const client = new EufyMegaClient({
  credentials,
  sessionStore: new FileSessionStore(sessionFile),
  maxLiveStreamsPerStation: 2,
});
const labels = new Map();
const label = (id) => labels.get(id) ?? 'other';
const stops = [];
client.on('live-stop', (event) => {
  stops.push({
    t: Date.now() - t0,
    camera: label(event.deviceId),
    confirmed: event.confirmed,
    reason: event.reason,
  });
  void emit('live-stop', {
    camera: label(event.deviceId),
    confirmed: event.confirmed,
    reason: event.reason,
  });
});
client.on(
  'station',
  (state) =>
    void emit('station-event', { connected: state.connected, encryption: state.commandEncryption }),
);
client.on('fault', (error) => void emit('fault', { code: error?.code ?? String(error) }));

function observe(handle, name) {
  const counts = {
    name,
    video: { chunks: 0, bytes: 0, first: null, last: null },
    audio: { chunks: 0, bytes: 0, first: null, last: null },
    perSecond: [],
  };
  const start = Date.now();
  const track = (kind) => (chunk) => {
    const c = counts[kind];
    c.chunks++;
    c.bytes += chunk.length;
    const now = Date.now() - t0;
    c.first ??= now;
    c.last = now;
    if (kind === 'video') {
      const bucket = Math.floor((Date.now() - start) / 1000);
      counts.perSecond[bucket] = (counts.perSecond[bucket] ?? 0) + 1;
    }
  };
  handle.video.on('data', track('video'));
  handle.audio.on('data', track('audio'));
  handle.video.on('error', () => void emit('stream-error', { name, kind: 'video' }));
  handle.audio.on('error', () => void emit('stream-error', { name, kind: 'audio' }));
  const snapshot = () => ({
    name,
    metadata: handle.metadata,
    video: { ...counts.video },
    audio: { ...counts.audio },
    perSecond: [...counts.perSecond].map((v) => v ?? 0),
  });
  return { counts, snapshot };
}
const cpu = () => {
  const usage = process.cpuUsage();
  return { user: usage.user, system: usage.system, wall: Date.now() };
};
const cpuDelta = (a, b) => {
  const wall = Math.max(1, b.wall - a.wall);
  return {
    wallMs: wall,
    cpuPercent: Math.round(((b.user - a.user + b.system - a.system) / 1000 / wall) * 1000) / 10,
    loadavg: loadavg().map((v) => Math.round(v * 100) / 100),
  };
};
const stopConfirmed = async (handle, name) => {
  const result = await Promise.race([
    handle.stop(),
    delay(15000, { confirmed: false, reason: 'probe_wait_exhausted' }),
  ]);
  await emit('stop-result', { name, ...result });
  return result;
};
async function emergency(cameras) {
  for (const camera of cameras) {
    try {
      const result = await client.ensureLiveStopped(camera.id, AbortSignal.timeout(12000));
      await emit('emergency-stop', { camera: label(camera.id), ...result });
    } catch (error) {
      await emit('emergency-stop', {
        camera: label(camera.id),
        error: error?.code ?? String(error),
      });
    }
  }
}

function instrument(stationObj, name) {
  const session = stationObj.p2pSession;
  if (!session || session.__probeInstrumented) return;
  session.__probeInstrumented = true;
  const send = session.sendCommandWithInt.bind(session);
  session.sendCommandWithInt = (command, custom) => {
    if (command?.commandType === 1004) {
      const origin = (new Error().stack ?? '')
        .split('\n')
        .slice(2, 7)
        .map((l) => l.trim().replace(/^at /, '').split(' ')[0])
        .filter(Boolean);
      void emit('stop-sent', { session: name, channel: command.channel, origin });
    }
    return send(command, custom);
  };
  stationObj.on('command result', (_s, r) => {
    if (r.command_type === 1004)
      void emit('stop-ack', { session: name, channel: r.channel, code: r.return_code });
  });
  stationObj.on(
    'livestream stop',
    (_s, ch) => void emit('session-livestream-stop', { session: name, channel: ch }),
  );
  stationObj.on(
    'livestream error',
    (_s, ch) => void emit('session-livestream-error', { session: name, channel: ch }),
  );
  stationObj.on('close', () => void emit('session-close', { session: name }));
}
let camA, camB, station, transport;
let exitCode = 0;
try {
  await emit('runtime', {
    node: process.version,
    phases: PHASES,
    soloMs: SOLO_MS,
    observeMs: OBSERVE_MS,
    afterMs: AFTER_MS,
  });
  const auth = await client.connect(undefined, AbortSignal.timeout(30000));
  await emit('auth', { state: auth.state });
  if (auth.state !== 'connected') throw new Error(`auth_${auth.state}`);
  const devices = await client.listDevices(AbortSignal.timeout(30000));
  const stations = devices.filter((d) => d.kind === 'station');
  if (stations.length !== 1) throw new Error(`expected one station, found ${stations.length}`);
  station = stations[0];
  labels.set(station.id, 'station');
  const model = process.env.CAMERA_MODEL ?? 'T8160';
  const cameras = devices
    .filter((d) => d.kind === 'camera' && d.stationId === station.id && d.model === model)
    .sort((a, b) => a.id.localeCompare(b.id));
  const ia = num(process.env.CAMERA_A, 0),
    ib = num(process.env.CAMERA_B, 1);
  camA = cameras[ia];
  camB = cameras[ib];
  if (!camA || !camB || camA.id === camB.id) throw new Error('camera selection invalid');
  labels.set(camA.id, 'camA');
  labels.set(camB.id, 'camB');
  await emit('inventory', {
    station: { model: station.model, firmware: station.firmware, hardware: station.hardware },
    cameras: cameras.map((c) => ({
      label: label(c.id),
      model: c.model,
      firmware: c.firmware,
      hardware: c.hardware,
      battery: c.battery ?? null,
    })),
  });
  const before = await client.connectStation(station.id, AbortSignal.timeout(25000));
  await emit('station-connected', {
    connected: before.connected,
    encryption: before.commandEncryption,
  });
  transport = client.transport;
  if (!transport) throw new Error('transport unavailable');
  await emit('option', { maxLiveStreamsPerStation: transport.liveLimit });
  instrument(transport.stations.get(station.id), 'primary');
  const baseCreate = transport.createExtraStation.bind(transport);
  transport.createExtraStation = async (id) => {
    const extra = await baseCreate(id);
    instrument(extra, 'extra');
    return extra;
  };

  if (PHASES.includes('concurrent')) {
    await emit('phase', { name: 'concurrent', start: true });
    const a = await client.startLive(camA.id);
    const oa = observe(a, 'camA');
    await emit('live-start', { name: 'camA', session: 'primary', metadata: a.metadata });
    const cpuSolo0 = cpu();
    await delay(SOLO_MS);
    const cpuSolo1 = cpu();
    await emit('solo-window', { camA: oa.snapshot(), cpu: cpuDelta(cpuSolo0, cpuSolo1) });
    const soloVideo = oa.counts.video.chunks;
    let b;
    let bStartError;
    const bStartAt = Date.now();
    try {
      b = await client.startLive(camB.id);
    } catch (error) {
      bStartError = error?.code ?? String(error);
    }
    await emit('second-start', {
      name: 'camB',
      elapsedMs: Date.now() - bStartAt,
      error: bStartError ?? null,
      extraSessions: transport.extraLives?.size ?? null,
      primaryStillCamA: transport.lives?.get(station.id)?.handle === a,
      metadata: b?.metadata ?? null,
    });
    if (b) {
      const ob = observe(b, 'camB');
      const cpu0 = cpu();
      const aBefore = oa.snapshot();
      await delay(OBSERVE_MS);
      const cpu1 = cpu();
      await emit('concurrent-window', {
        camA: oa.snapshot(),
        camAVideoChunksDuringWindow: oa.counts.video.chunks - aBefore.video.chunks,
        camB: ob.snapshot(),
        cpu: cpuDelta(cpu0, cpu1),
        primaryStillCamA: transport.lives?.get(station.id)?.handle === a,
        extraSessions: transport.extraLives?.size ?? null,
      });
      const stopB = await stopConfirmed(b, 'camB');
      const aAfterStopB = oa.counts.video.chunks;
      await delay(AFTER_MS);
      await emit('after-second-stop', {
        camB: stopB,
        camAVideoChunksAfter: oa.counts.video.chunks - aAfterStopB,
        camA: oa.snapshot(),
        extraSessions: transport.extraLives?.size ?? null,
      });
    } else {
      await delay(AFTER_MS);
      await emit('after-failed-second-start', {
        camAVideoChunksSinceSolo: oa.counts.video.chunks - soloVideo,
        camA: oa.snapshot(),
      });
    }
    const stopA = await stopConfirmed(a, 'camA');
    const after = await client.refreshStationState(station.id, AbortSignal.timeout(20000));
    await emit('phase', {
      name: 'concurrent',
      end: true,
      camAStop: stopA,
      stationConnected: after.connected,
      encryption: after.commandEncryption,
    });
    try {
      const snap = await client.snapshot(camA.id, AbortSignal.timeout(15000));
      await emit('control-check', { snapshotBytes: snap.data.length, mime: snap.mime });
    } catch (error) {
      await emit('control-check', { error: error?.code ?? String(error) });
    }
  }

  if (PHASES.includes('cancel')) {
    await emit('phase', { name: 'cancel', start: true });
    const a = await client.startLive(camA.id);
    const oa = observe(a, 'camA');
    await emit('live-start', { name: 'camA', session: 'primary', metadata: a.metadata });
    await delay(3000);
    const stopsBefore = stops.length;
    const abort = new AbortController();
    const issuedAt = Date.now();
    let startIssuedAt = null;
    const createBeforeCancel = transport.createExtraStation;
    transport.createExtraStation = async (id) => {
      const extra = await createBeforeCancel(id);
      const start = extra.startLivestream.bind(extra);
      extra.startLivestream = (camera, codec) => {
        start(camera, codec);
        startIssuedAt = Date.now();
        void emit('extra-start-issued', { afterMs: startIssuedAt - issuedAt });
        setTimeout(() => abort.abort(), CANCEL_AFTER_MS);
      };
      return extra;
    };
    const pending = client.startLive(camB.id, abort.signal);
    let outcome;
    const safety = setTimeout(() => abort.abort(), 15000);
    try {
      const b = await pending;
      clearTimeout(safety);
      outcome = { mediaArrivedFirst: true, metadata: b.metadata };
      await emit('cancel-outcome', { ...outcome, elapsedMs: Date.now() - issuedAt });
      await stopConfirmed(b, 'camB');
    } catch (error) {
      clearTimeout(safety);
      outcome = {
        mediaArrivedFirst: false,
        error: error?.code ?? String(error),
        elapsedMs: Date.now() - issuedAt,
        startIssued: startIssuedAt !== null,
        cancelledAfterStartMs: startIssuedAt === null ? null : Date.now() - startIssuedAt,
      };
      await emit('cancel-outcome', outcome);
      // The cleanup owner reports through live-stop after the device STOP acknowledgement.
      const deadline = Date.now() + 15000;
      while (stops.length === stopsBefore && Date.now() < deadline) await delay(100);
      await emit('cancel-cleanup', {
        reported: stops.slice(stopsBefore),
        extraStarting: transport.extraStarting?.size ?? null,
        extraSessions: transport.extraLives?.size ?? null,
      });
    }
    transport.createExtraStation = createBeforeCancel;
    const aChunks = oa.counts.video.chunks;
    await delay(3000);
    await emit('after-cancel', {
      camAVideoChunksAfter: oa.counts.video.chunks - aChunks,
      camA: oa.snapshot(),
    });
    const stopA = await stopConfirmed(a, 'camA');
    const after = await client.refreshStationState(station.id, AbortSignal.timeout(20000));
    await emit('phase', {
      name: 'cancel',
      end: true,
      camAStop: stopA,
      stationConnected: after.connected,
    });
  }
} catch (error) {
  exitCode = 1;
  await emit('error', { code: error?.code ?? null, message: String(error?.message ?? error) });
  if (camA && camB) await emergency([camB, camA]);
} finally {
  await emit('summary', {
    stops,
    extraSessions: transport?.extraLives?.size ?? null,
    primaryLives: transport?.lives?.size ?? null,
  });
  await Promise.race([client.close(), delay(30000)]);
  await emit('closed', { exitCode });
  process.exit(exitCode);
}
