// Research probe for #163: one live stream well beyond 120 seconds on one camera
// (phase "long", observation A) and control on an idle primary session while the
// first live stream runs on an extra session (phase "control", observation B).
// Runs on the LAN of one HomeBase against a build of the private prototype branch
// with the research switches in src/device-transport.ts. Every attempt is bounded,
// every stop must be confirmed by the device, and the output carries labels
// (station, cam) instead of identifiers. Keep the session and credentials files
// private and delete them afterwards.
//
// Usage from a built checkout of the prototype branch:
//   EUFY_SESSION_FILE=/private/path/mega-session.json \
//   EUFY_CREDENTIALS_FILE=/private/path/credentials.json \
//   EVIDENCE_DIR=/private/path/evidence PHASES=long LONG_MS=600000 \
//   EUFY_RESEARCH_LIVE_BOUND_MS=660000 node scripts/research/live-bound-probe.mjs
//   PHASES=control CONTROL_MS=40000 EUFY_RESEARCH_FREE_PRIMARY=1 \
//   EUFY_RESEARCH_FORCE_MODE_WRITE=1 node scripts/research/live-bound-probe.mjs
// The camera is the one of CAMERA_MODEL (default T8160) with the highest battery
// value, or CAMERA_INDEX in id order. The control phase re-sends the mode it read,
// so the effective guard mode never changes, and restores it if a read differs.
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
const PHASES = (process.env.PHASES ?? 'long').split(',');
const LONG_MS = num(process.env.LONG_MS, 600000);
const REPORT_MS = num(process.env.REPORT_MS, 30000);
const CONTROL_MS = num(process.env.CONTROL_MS, 40000);
const CONTROL_SETTLE_MS = num(process.env.CONTROL_SETTLE_MS, 5000);
if (LONG_MS > 600000) throw new Error('the long phase is bounded to 10 minutes');
if (CONTROL_MS > 50000) throw new Error('the control phase is bounded to 60 seconds with stop');

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
const stopConfirmed = async (handle, name) => {
  const at = Date.now();
  const result = await Promise.race([
    handle.stop(),
    delay(15000, { confirmed: false, reason: 'probe_wait_exhausted' }),
  ]);
  await emit('stop-result', { name, elapsedMs: Date.now() - at, ...result });
  return result;
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
      void emit('arming-ack', {
        session: name,
        channel: r.channel,
        code: r.return_code,
        property: r.customData?.property?.name ?? null,
      });
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
  stationObj.on(
    'runtime state',
    (_s, channel, battery, temperature) =>
      void emit('runtime-state', { session: name, channel, battery, temperature }),
  );
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
const hardStop = setTimeout(
  () => {
    void emit('hard-stop', { reason: 'probe overran its budget' }).then(async () => {
      if (cam) await emergency(cam);
      process.exit(2);
    });
  },
  (PHASES.includes('long') ? LONG_MS : CONTROL_MS) + 180000,
);
hardStop.unref();
try {
  await emit('runtime', {
    node: process.version,
    phases: PHASES,
    longMs: LONG_MS,
    controlMs: CONTROL_MS,
    env: {
      liveBoundMs: process.env.EUFY_RESEARCH_LIVE_BOUND_MS ?? null,
      freePrimary: process.env.EUFY_RESEARCH_FREE_PRIMARY ?? null,
      forceModeWrite: process.env.EUFY_RESEARCH_FORCE_MODE_WRITE ?? null,
    },
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
  await emit('option', { maxLiveStreamsPerStation: transport.liveLimit });
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

  if (PHASES.includes('long')) {
    await emit('phase', { name: 'long', start: true, budgetMs: LONG_MS });
    const startAt = Date.now();
    const a = await client.startLive(cam.id);
    const oa = observe(a, 'cam');
    await emit('live-start', {
      name: 'cam',
      session: transport.lives.get(station.id)?.handle === a ? 'primary' : 'extra',
      startElapsedMs: Date.now() - startAt,
      metadata: a.metadata,
    });
    let endedEarly = null;
    void a.ended.then((result) => {
      endedEarly = { t: Date.now() - t0, sinceStartMs: Date.now() - startAt, ...result };
      void emit('ended-by-itself', endedEarly);
    });
    let lastSecond = 0;
    let cpuMark = cpu();
    let lastEvents = stationEvents;
    while (Date.now() - startAt < LONG_MS && !endedEarly) {
      const remaining = LONG_MS - (Date.now() - startAt);
      await delay(Math.min(REPORT_MS, Math.max(remaining, 0)));
      const snap = oa.snapshot();
      const nowMark = cpu();
      await emit('window', {
        sinceStartMs: Date.now() - startAt,
        window: oa.window(lastSecond),
        total: { video: snap.video, audio: snap.audio },
        cpu: cpuDelta(cpuMark, nowMark),
        stationEvents: stationEvents - lastEvents,
        primaryLive: transport.lives.get(station.id)?.handle === a,
        stationConnected: (await client.getStationState(station.id)).connected,
        endedEarly: endedEarly !== null,
      });
      lastSecond = Math.max(0, snap.seconds - 1);
      cpuMark = nowMark;
      lastEvents = stationEvents;
    }
    const stopResult = endedEarly ?? (await stopConfirmed(a, 'cam'));
    await emit('phase', {
      name: 'long',
      end: true,
      sinceStartMs: Date.now() - startAt,
      total: oa.snapshot(),
      stop: stopResult,
      endedByItself: endedEarly !== null,
    });
    await emit('state-after', await readState(station));
    await emit('snapshot-after', await freshSnapshot(cam, transport));
    await emit('battery-after', await batteryOf(cam, transport));
  }

  if (PHASES.includes('control')) {
    await emit('phase', { name: 'control', start: true, budgetMs: CONTROL_MS });
    const mode = stateBefore.guardMode;
    if (typeof mode !== 'number') throw new Error('guard mode unknown before the control phase');
    const startAt = Date.now();
    const a = await client.startLive(cam.id);
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
    if (!routing().onExtra) throw new Error('the first stream did not take an extra session');
    let endedEarly = null;
    void a.ended.then((result) => {
      endedEarly = { t: Date.now() - t0, sinceStartMs: Date.now() - startAt, ...result };
      void emit('ended-by-itself', endedEarly);
    });
    await delay(CONTROL_SETTLE_MS);
    await emit('settled', { window: oa.window(0), ...routing() });
    const cached = await client.getStationState(station.id);
    await emit('control-cached-state', {
      connected: cached.connected,
      guardMode: cached.guardMode,
      currentMode: cached.currentMode,
    });
    const chunksAt = () => oa.counts.video.chunks;
    let c0 = chunksAt();
    const read = await readState(station);
    await emit('control-refresh-state', { ...read, videoChunksMeanwhile: chunksAt() - c0 });
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
        detail: error?.detail ?? error?.message ?? null,
        elapsedMs: Date.now() - at,
      };
    }
    await emit('control-mode-command', {
      ...command,
      videoChunksMeanwhile: chunksAt() - c0,
      ...routing(),
    });
    // Safety: the mode must still read as before. Restore it if not.
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
    const remaining = CONTROL_MS - (Date.now() - startAt);
    if (remaining > 0 && !endedEarly) await delay(remaining);
    await emit('control-window', {
      sinceStartMs: Date.now() - startAt,
      window: oa.window(0),
      total: oa.snapshot(),
      ...routing(),
    });
    const stopResult = endedEarly ?? (await stopConfirmed(a, 'cam'));
    await emit('phase', { name: 'control', end: true, stop: stopResult, ...routing() });
    await emit('state-after', await readState(station));
    await emit('snapshot-after', await freshSnapshot(cam, transport));
    await emit('battery-after', await batteryOf(cam, transport));
  }
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
