// Bench check for #165: one live stream with a per-start bound on a station with
// concurrency enabled, so the stream runs on its own session and the primary
// session stays free. During the stream the probe reads the cached state,
// refreshes the station state over P2P, queries a fresh cover snapshot and sends
// a guard mode command that repeats the mode it read, so the effective mode never
// changes. The library's own timer must end the stream at the bound with a
// device-confirmed STOP. Every attempt is bounded, and the output carries labels
// (station, cam) instead of identifiers. Keep the session and credentials files
// private and delete them afterwards.
//
// Usage from a built checkout:
//   EUFY_SESSION_FILE=/private/path/mega-session.json \
//   EUFY_CREDENTIALS_FILE=/private/path/credentials.json \
//   EVIDENCE_DIR=/private/path/evidence BOUND_MS=180000 \
//   node scripts/research/live-bound-probe.mjs
// The camera is the one of CAMERA_MODEL (default T8160) with the highest battery
// value, or CAMERA_INDEX in id order. CONTROL_AT_MS (default 30000) is when the
// control reads and the mode command run.
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';

const dist = process.env.PROBE_DIST ?? new URL('../../dist/', import.meta.url).pathname;
const { EufyMegaClient, FileSessionStore } = await import(
  pathToFileURL(`${dist.replace(/\/$/, '')}/index.js`).href
);

const evidenceDir =
  process.env.EVIDENCE_DIR ??
  new URL('../../private/live-bound-evidence/', import.meta.url).pathname;
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
const BOUND_MS = num(process.env.BOUND_MS, 180000);
const CONTROL_AT_MS = num(process.env.CONTROL_AT_MS, 30000);
const REPORT_MS = num(process.env.REPORT_MS, 30000);
if (BOUND_MS > 600000) throw new Error('the bench check is bounded to 10 minutes');
if (CONTROL_AT_MS >= BOUND_MS) throw new Error('control must run before the bound');

const sessionFile = process.env.EUFY_SESSION_FILE;
if (!sessionFile) throw new Error('EUFY_SESSION_FILE is required');
let credentials;
if (process.env.EUFY_CREDENTIALS_FILE) {
  const raw = JSON.parse(await readFile(process.env.EUFY_CREDENTIALS_FILE, 'utf8'));
  credentials = {
    email: raw.email ?? raw.username,
    password: raw.password,
    country: raw.country ?? 'NL',
  };
} else {
  credentials = { email: 'unused@example.invalid', password: 'unused', country: 'NL' };
}

const client = new EufyMegaClient({
  credentials,
  sessionStore: new FileSessionStore(sessionFile),
  maxLiveStreamsPerStation: 2,
  liveUpperBoundMs: Math.max(120000, BOUND_MS),
});
const labels = new Map();
const label = (id) => labels.get(id) ?? 'other';
const stops = [];
let stationEvents = 0;
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
client.on('station', (state) => {
  stationEvents++;
  void emit('station-event', {
    connected: state.connected,
    encryption: state.commandEncryption,
    guardMode: state.guardMode,
    currentMode: state.currentMode,
  });
});
client.on(
  'snapshot',
  (s) => void emit('snapshot-event', { camera: label(s.deviceId), bytes: s.data.length }),
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
    seconds: counts.perSecond.length,
  });
  const window = (fromSecond) => {
    const buckets = counts.perSecond.slice(fromSecond).map((v) => v ?? 0);
    const complete = buckets.length > 1 ? buckets.slice(0, -1) : buckets;
    const total = complete.reduce((a, b) => a + b, 0);
    return {
      seconds: complete.length,
      videoChunks: total,
      perSecondMean: complete.length ? Math.round((total / complete.length) * 10) / 10 : null,
      perSecondMin: complete.length ? Math.min(...complete) : null,
      perSecondMax: complete.length ? Math.max(...complete) : null,
      zeroSeconds: complete.filter((v) => v === 0).length,
      lowSeconds: complete.filter((v) => v > 0 && v < 10).length,
    };
  };
  return { counts, snapshot, window };
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
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  };
};
async function emergency(camera) {
  try {
    const result = await client.ensureLiveStopped(camera.id, AbortSignal.timeout(12000));
    await emit('emergency-stop', { camera: label(camera.id), ...result });
  } catch (error) {
    await emit('emergency-stop', { camera: label(camera.id), error: error?.code ?? String(error) });
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
    if (r.command_type === 1224)
      void emit('arming-ack', { session: name, channel: r.channel, code: r.return_code });
  });
  stationObj.on(
    'livestream stop',
    (_s, ch) => void emit('session-livestream-stop', { session: name, channel: ch }),
  );
  stationObj.on(
    'livestream error',
    (_s, ch, error) =>
      void emit('session-livestream-error', {
        session: name,
        channel: ch,
        error: String(error?.message ?? error),
      }),
  );
  stationObj.on('close', () => void emit('session-close', { session: name }));
  stationObj.on('connect', () => void emit('session-connect', { session: name }));
}
const batteryOf = async (cam, transport) => {
  const devices = await client.listDevices(AbortSignal.timeout(30000));
  const row = devices.find((d) => d.id === cam.id);
  const raw = transport.cameras.get(cam.id)?.getRawProperty?.(1101);
  return { inventory: row?.battery ?? null, p2pProperty: raw?.value ?? raw ?? null };
};
const freshSnapshot = async (cam, transport) => {
  const at = Date.now();
  transport.snapshots.delete(cam.id);
  try {
    const snap = await client.snapshot(cam.id, AbortSignal.timeout(15000));
    return {
      bytes: snap.data.length,
      mime: snap.mime,
      receivedAt: snap.receivedAt,
      elapsedMs: Date.now() - at,
    };
  } catch (error) {
    return { error: error?.code ?? String(error), elapsedMs: Date.now() - at };
  }
};
const readState = async (station) => {
  const at = Date.now();
  try {
    const state = await client.refreshStationState(station.id, AbortSignal.timeout(20000));
    return {
      connected: state.connected,
      encryption: state.commandEncryption,
      guardMode: state.guardMode,
      currentMode: state.currentMode,
      elapsedMs: Date.now() - at,
    };
  } catch (error) {
    return { error: error?.code ?? String(error), elapsedMs: Date.now() - at };
  }
};

let cam, station, transport;
let exitCode = 0;
const hardStop = setTimeout(() => {
  void emit('hard-stop', { reason: 'probe overran its budget' }).then(async () => {
    if (cam) await emergency(cam);
    process.exit(2);
  });
}, BOUND_MS + 120000);
hardStop.unref();
try {
  await emit('runtime', { node: process.version, boundMs: BOUND_MS, controlAtMs: CONTROL_AT_MS });
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
  if (process.env.CAMERA_INDEX !== undefined) cam = cameras[num(process.env.CAMERA_INDEX, 0)];
  else cam = [...cameras].sort((a, b) => (b.battery ?? -1) - (a.battery ?? -1))[0];
  if (!cam) throw new Error('camera selection invalid');
  labels.set(cam.id, 'cam');
  await emit('inventory', {
    station: { model: station.model, firmware: station.firmware, hardware: station.hardware },
    candidates: cameras.map((c) => ({
      model: c.model,
      firmware: c.firmware,
      battery: c.battery ?? null,
    })),
    chosen: {
      model: cam.model,
      firmware: cam.firmware,
      hardware: cam.hardware,
      battery: cam.battery ?? null,
    },
  });
  const before = await client.connectStation(station.id, AbortSignal.timeout(25000));
  await emit('station-connected', {
    connected: before.connected,
    encryption: before.commandEncryption,
  });
  transport = client.transport;
  if (!transport) throw new Error('transport unavailable');
  await emit('option', {
    maxLiveStreamsPerStation: transport.liveLimit,
    liveUpperBoundMs: transport.liveUpperBound,
  });
  instrument(transport.stations.get(station.id), 'primary');
  const baseCreate = transport.createExtraStation.bind(transport);
  transport.createExtraStation = async (id) => {
    const extra = await baseCreate(id);
    instrument(extra, 'extra');
    return extra;
  };
  const stateBefore = await readState(station);
  await emit('state-before', stateBefore);
  await emit('snapshot-before', await freshSnapshot(cam, transport));
  await emit('battery-before', await batteryOf(cam, transport));
  const mode = stateBefore.guardMode;
  if (typeof mode !== 'number') throw new Error('guard mode unknown before the stream');

  // Out-of-range bound: the library refuses before touching the station.
  try {
    await client.startLive(cam.id, { maxDurationMs: transport.liveUpperBound + 1 });
    await emit('bound-validation', { rejected: false });
  } catch (error) {
    await emit('bound-validation', { rejected: true, code: error?.code ?? String(error) });
  }

  const startAt = Date.now();
  const a = await client.startLive(cam.id, { maxDurationMs: BOUND_MS });
  const oa = observe(a, 'cam');
  const routing = () => ({
    primaryLives: transport.lives.size,
    extraLives: transport.extraLives.size,
    onExtra: [...transport.extraLives.values()].some((l) => l.handle === a),
  });
  await emit('live-start', {
    name: 'cam',
    ...routing(),
    startElapsedMs: Date.now() - startAt,
    metadata: a.metadata,
  });
  if (!routing().onExtra) throw new Error('the stream did not take an extra session');
  let ended = null;
  void a.ended.then((result) => {
    ended = { t: Date.now() - t0, sinceStartMs: Date.now() - startAt, ...result };
    void emit('ended', ended);
  });

  let controlDone = false;
  let lastSecond = 0;
  let cpuMark = cpu();
  let lastEvents = stationEvents;
  let nextReport = REPORT_MS;
  while (!ended) {
    await delay(250);
    const since = Date.now() - startAt;
    if (!controlDone && since >= CONTROL_AT_MS) {
      controlDone = true;
      const chunksAt = () => oa.counts.video.chunks;
      const cached = await client.getStationState(station.id);
      await emit('control-cached-state', {
        connected: cached.connected,
        guardMode: cached.guardMode,
        currentMode: cached.currentMode,
      });
      let c0 = chunksAt();
      await emit('control-refresh-state', {
        ...(await readState(station)),
        videoChunksMeanwhile: chunksAt() - c0,
      });
      c0 = chunksAt();
      await emit('control-snapshot', {
        ...(await freshSnapshot(cam, transport)),
        videoChunksMeanwhile: chunksAt() - c0,
      });
      c0 = chunksAt();
      const at = Date.now();
      let command;
      try {
        const result = await client.setGuardMode(station.id, mode, AbortSignal.timeout(25000));
        command = {
          ok: true,
          mode,
          commandSent: result.commandSent,
          confirmed: result.confirmed,
          guardMode: result.state.guardMode,
          currentMode: result.state.currentMode,
          elapsedMs: Date.now() - at,
        };
      } catch (error) {
        command = {
          ok: false,
          mode,
          error: error?.code ?? String(error),
          elapsedMs: Date.now() - at,
        };
      }
      await emit('control-mode-command', {
        ...command,
        videoChunksMeanwhile: chunksAt() - c0,
        ...routing(),
      });
      for (let attempt = 0; attempt < 3; attempt++) {
        const check = await readState(station);
        await emit('control-mode-check', { attempt, expected: mode, ...check });
        if (check.guardMode === mode) break;
        try {
          const restore = await client.setGuardMode(station.id, mode, AbortSignal.timeout(25000));
          await emit('control-mode-restore', {
            attempt,
            commandSent: restore.commandSent,
            guardMode: restore.state.guardMode,
          });
        } catch (error) {
          await emit('control-mode-restore', { attempt, error: error?.code ?? String(error) });
        }
      }
    }
    if (since >= nextReport || ended) {
      nextReport += REPORT_MS;
      const snap = oa.snapshot();
      const nowMark = cpu();
      await emit('window', {
        sinceStartMs: since,
        window: oa.window(lastSecond),
        total: { video: snap.video, audio: snap.audio },
        cpu: cpuDelta(cpuMark, nowMark),
        stationEvents: stationEvents - lastEvents,
        ...routing(),
        stationConnected: (await client.getStationState(station.id)).connected,
      });
      lastSecond = Math.max(0, snap.seconds - 1);
      cpuMark = nowMark;
      lastEvents = stationEvents;
    }
    if (since > BOUND_MS + 30000) {
      await emit('bound-missed', { sinceStartMs: since });
      const result = await Promise.race([
        a.stop(),
        delay(15000, { confirmed: false, reason: 'probe_wait_exhausted' }),
      ]);
      await emit('stop-result', { name: 'cam', forced: true, ...result });
      break;
    }
  }
  await emit('phase-end', {
    sinceStartMs: Date.now() - startAt,
    total: oa.snapshot(),
    ended,
    ...routing(),
  });
  await emit('state-after', await readState(station));
  await emit('snapshot-after', await freshSnapshot(cam, transport));
  await emit('battery-after', await batteryOf(cam, transport));
} catch (error) {
  exitCode = 1;
  await emit('error', { code: error?.code ?? null, message: String(error?.message ?? error) });
  if (cam) await emergency(cam);
} finally {
  clearTimeout(hardStop);
  await emit('summary', {
    stops,
    extraSessions: transport?.extraLives?.size ?? null,
    primaryLives: transport?.lives?.size ?? null,
  });
  await Promise.race([client.close(), delay(30000)]);
  await emit('closed', { exitCode });
  process.exit(exitCode);
}
