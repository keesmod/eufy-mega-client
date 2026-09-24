# API guide

All imports below come from `@keesmod/eufy-mega-client`. Public results and events
use library-owned types. Protocol SDK objects are private implementation details.

## Camera quick start

Use Node.js 24 and install the compiled package as described in the
[README](../README.md#install-and-upgrade).

```typescript
import { EufyMegaClient, FileSessionStore } from '@keesmod/eufy-mega-client';

const client = new EufyMegaClient({
  credentials: {
    email: process.env.EUFY_EMAIL!,
    password: process.env.EUFY_PASSWORD!,
    country: 'NL',
  },
  sessionStore: new FileSessionStore('/private/eufy/mega-session.json'),
});

try {
  const auth = await client.connect();
  if (auth.state === 'connected') {
    const devices = await client.listDevices();
    const station = devices.find((device) => device.kind === 'station');
    if (station) await client.connectStation(station.id);
    // Select devices by their stable IDs. See the operations below.
  }
  // Return authentication challenges to your UI. Do not retry them in a loop.
} finally {
  await client.shutdown();
}
```

Run on the HomeBase LAN with one controlling bridge per installation. The tested
Home Assistant deployment uses host networking and binds its bridge API to
loopback. Routed/VLAN and Docker bridge discovery have not passed acceptance.

The library uses Eufy's cloud and local device protocols, with no legacy cloud
fallback. It returns device operations and raw media streams. FFmpeg, playback,
viewer leases and Home Assistant entities belong in the consuming bridge.

## Modular clients

`EufyClient` adds optional `security` and `mowers` modules. Existing
`EufyMegaClient` imports, constructor options, methods and events remain valid.
Omitting a module or setting it to `false` leaves its property `undefined` and
requires no credentials or session store for that purpose. An empty client is
inert. Construction does not authenticate or start network activity.

Each bridge constructs its own library client. For the camera bridge:

```ts
import { EufyClient, FileSessionStore } from '@keesmod/eufy-mega-client';

const camera = new EufyClient({
  security: {
    credentials: cameraCredentials,
    sessionStore: new FileSessionStore('/private/camera/session.json'),
  },
});
await camera.security!.connect();
const devices = await camera.security!.listDevices();
await camera.shutdown();
```

The security module retains the complete camera API below, including typed
events. Both modules expose `authState`, `connected`, `lifecycle`,
`connect(answer?, signal?)`, `shutdown()` and `close()`. `lifecycle` moves from
`open` to `closing` to `closed`. Authentication state describes the individual
module, with no shared authenticated flag. `connected` accounts for session
expiry reported by the owner. Auth-state results are copied and exclude extra
adapter fields.

Call authentication explicitly on the desired module. A failure in one module
does not authenticate, close or invalidate the other. Closing one module is
terminal for that module. To reopen it, create a new client with its own store.
`EufyClient.shutdown()` closes every configured module, awaits their cleanup and
reports `shutdown_incomplete` if any cleanup fails. Repeated shutdown calls reuse
the same result. There is no automatic retry of authentication or physical work.

### Mower adapter boundary

A mower-only client can be constructed without camera credentials. Version 0.3.0
uses the independent Home/Tuya adapter by default. Existing custom lifecycle
adapters remain supported. A custom adapter without discovery reports
`mower_protocol_unavailable` when discovery is requested.

```ts
const mower = new EufyClient({
  mowers: {
    credentials: mowerCredentials,
    sessionStore: mowerSessionStore,
    adapter: createMowerAdapter,
  },
});
await mower.mowers!.connect();
await mower.shutdown();
```

`createMowerAdapter` is an implementation of the exported `MowerAdapter` contract,
not a bundled protocol factory. The module calls the factory lazily, once after
its first login request, with only its credentials and `MowerSessionStore`.
Return a fresh adapter for each client. Adapters expose library-owned `AuthState`
results and a current `connected` getter. They must bind restored sessions to the
account, report expiry, honor the supplied `AbortSignal`, and cancel activity and
flush persistence in `shutdown()`. Adapter failures expose known error codes or
`mower_authentication_failed`, without upstream messages, causes or objects.

A `MowerSessionStore` implements `load()` and `save(session)` for
`MowerSession`, an opaque `{ version: 1, data: string }` secret. Its data encoding
belongs to the adapter. It is deliberately separate from the existing security
`Session` and `FileSessionStore` formats. Protect the whole value with private
storage permissions. Session values are persistence inputs only, never device
identifiers, API results or diagnostics.

Use distinct credentials, stores and backing files for camera and mower
installations. A combined library client rejects the same store object assigned
to both modules with `shared_session_store`. Custom stores and different store
objects can still target the same file, so the caller must keep backing storage
separate. There is no shared service, HTTP server or dependency on the other
bridge. Neither module shuts down the other installation.

The default Home/Tuya authentication and discovery profile is described in
[Mower authentication](MOWER_AUTH_PROVENANCE.md). The EU E15 binding has a [live validation receipt](research/E15_AUTH_VALIDATION_2026-09-10.md).
Telemetry, commands, settings and maps remain in their E3/E4 stories. The adapter
contract adds no physical control methods and makes no E15 hardware claims.

## Authentication and sessions

Construct `EufyMegaClient` with `credentials` and a `SessionStore`. A custom store
implements `load()` and `save(session)`. Treat the entire session as secret.
`FileSessionStore` writes atomically with private directory/file permissions.
Its session format is independent of legacy eufy-security-client sessions.

`connect(answer?, signal?)` returns an `AuthState`:

| State                   | Caller action                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `connected`             | Discover devices and use operations.                                                          |
| `verification_required` | Ask the user for the code; call `connect({verifyCode})`.                                      |
| `captcha_required`      | Present `image` to the user; submit `connect({captchaId, answer})`.                           |
| `locked`                | Pause login attempts. Resolve the lock through Eufy before explicitly starting a new session. |
| `disconnected`          | No authenticated session is available.                                                        |

Restart with the same store to reuse a valid session. `connected` becomes false
before the stored token expires; call `connect()` to authenticate again. No
device command is automatically replayed after authentication or transport loss.
Account changes do not restore another account's session. Concurrent login
attempts fail with `authentication_busy`.

Cloud requests have a 15-second deadline, including queue time, and three-second
spacing by default. `requestTimeoutMs` and `minRequestIntervalMs` configure these.
CAPTCHA, verification and lockout states pause automatic login attempts.

## Discovery, state and snapshots

- `listDevices(signal?)` returns supported stations and cameras with stable
  `id`, `stationId`, model, name, firmware, hardware and optional battery value.
  Unknown hardware is excluded; a supported camera with an unsupported parent
  causes an error. Inventory at the server's 100-device boundary is unconfirmed.
- `connectStation(id, signal?)` establishes the explicit LAN connection.
- `getStationState(id)` returns the last observed state. Mode values can be
  `null` before device telemetry arrives.
- `refreshStationState(id, signal?)` requests a fresh device observation.
- `snapshot(cameraId, signal?)` returns the latest HomeBase cover JPEG with its
  receipt time. It does not wake a camera for a new live capture.

## Live media

`startLive(cameraId, signal?)` returns a `LiveStream`: `metadata`, separate raw
`video`/`audio` readable streams, `ended` and `stop()`. Metadata identifies H.264
or H.265 and supported AAC variants. Consume both streams, or call `resume()` on
an unused audio stream. The library does not transcode or package browser video.

One station carries one live stream by default. `maxLiveStreamsPerStation`
(1 to 4, default 1) lets that many cameras on the same station stream at the
same time. With the default of 1 the stream uses the station's primary session,
which also carries control, snapshots and recordings, and while it runs
recording transfers and mode commands fail with `station_busy`. Above 1, every
live stream gets its own P2P session, keyed by station and channel, opened by
`startLive` and released when that stream ends, and the primary session stays
free: mode commands, state refreshes and snapshots work while cameras stream.
Recording transfers still fail with `station_busy` while any live stream runs.
The same camera cannot stream twice. A start beyond the limit, during a
recording transfer or during a station command fails with `station_busy`. A
lost session ends only the streams it carried, and station state reports the
primary session.

Each stream has its own upper bound, 120 seconds by default.
`startLive(cameraId, { signal?, maxDurationMs? })` may set a bound between one
second and the client's `liveUpperBoundMs` ceiling (120000 to 3600000 ms,
default 120000), so a longer stream needs both a raised ceiling and an explicit
per-start value. Values outside that range fail with `invalid_live_bound`. At
the bound the library sends STOP and the stream ends with the device's
acknowledgement like any other stop. The caller's abort signal also stops an
established stream.

Two concurrent streams are verified on one HomeBase 3 with two eufyCam 3
cameras, see the [research note](research/CONCURRENT_LIVE_2026-09-18.md).
Three or four streams are permitted by the option but unverified on hardware. A
ten-minute stream and control on an idle primary session are verified on the
same bench, see [the live bound note](research/LIVE_BOUND_2026-09-19.md).

Always await `stop()` or `ended`. `confirmed: true` requires the device's STOP
acknowledgement; a local EOF, socket close or timeout does not establish success.
Cancelling an issued start retains its cleanup owner while awaiting STOP, even
if no stream handle was returned. Subscribe to `live-stop` for that result.

`stopLive(cameraId)` stops an owned stream on whichever session carries it.
`ensureLiveStopped(cameraId, signal?)` does the same for a camera's own stream.
For an uncertain previous session it sends an explicit STOP, checks its
acknowledgement and renews the primary session, which needs an idle station: it
rejects with `station_busy` while any camera streams or another operation owns
the station. An old stream handle cannot stop a newer stream.

## Recordings

- `recordingCalendar(stationId, 'YYYY-MM', signal?)` returns presence dates for
  the HomeBase. Calendar markers are not camera-specific counts.
- `listRecordings(stationId, 'YYYY-MM-DD', cameraIds?, signal?)` returns
  `{recordings, returned, complete: true}` only after completeness checks.
  Dates use the process's local timezone; configure it to match the installation.
  Camera filters do not change the underlying full-day completeness query.
- `recordingThumbnail(recordingId, signal?)` returns the referenced JPEG.
- `downloadRecording(recordingId, signal?)` returns a `RecordingDownload` with
  metadata, raw video/audio streams, `completed` and `cancel()`.

Recording IDs are opaque, bound to this client and expire after 15 minutes.
Refresh the list when they expire. Device paths and cipher identifiers are never
public API inputs. Queries widen beyond 100 rows through 500, 2,000 and 10,000;
fixed caps, duplicate IDs, changed prefixes and exact safety boundaries fail
with unconfirmed history. An empty or partial result is not substituted.

Consume both media streams and inspect `completed.complete`. Completion requires
the HomeBase's finish message and drained source streams. Transfers are bounded
to 32 MiB and 40 seconds, with a further five seconds for cancel acknowledgement.
Failure results include a reason and `stopConfirmed`. Keep a failed transfer out
of a playback cache. `cancel()` is idempotent and does not retry the download.

## Events and Guard Mode

Call `startEvents(signal?)` after discovery. Events use Google FCM and Mega push
registration, plus device messages. Reconnect restores the push registration and
stored delivery IDs. `eventStatus` reports connectivity and delivery counters.

Typed events are `auth`, `device`, `station`, `snapshot`, `event`,
`events-connection`, `live-stop` and `fault`. Detection events preserve supported
motion/person/ring semantics and recognized names when supplied by the device.
Deduplication correlates device/push copies and persists recent delivery hashes;
it does not manufacture missing names or detections.

`setGuardMode(stationId, mode, signal?)` accepts 0 (Away), 1 (Home), 2 (Schedule),
3–5 (Custom), 47 (Geofencing) or 63 (Disarmed). Its result requires a matching
command acknowledgement and fresh device-reported Guard Mode. `commandSent`
is false if a fresh read already matches. Rejection or timeout never causes an
automatic retry. Read the device again before deciding what to do next.

## Errors and shutdown

Catch `EufyError` and use its stable `code`; `remoteCode` is an optional numeric
device/service result. Do not log session contents or upstream objects.

Await `shutdown()` (alias `close()`) to stop owned media, close device and event
transports and flush sessions. Shutdown is idempotent. A closed client cannot
be reopened; construct another client with the same session store.

## Home/Tuya mower profile, 0.3.1

`EufyClient({ mowers: { credentials, sessionStore } })` now uses the independent
Home/Tuya adapter. `home.requestTimeoutMs` bounds each request, default 15000 ms.
`home.fetch` injects a trusted private HTTP transport for synthetic tests. Existing
custom `adapter` factories retain precedence. Omitting the mower module makes
no Home/Tuya request.

Call `await client.mowers.connect()` explicitly, then
`await client.mowers.discover(signal)`. Results are copied `MowerDevice` values:
`{ id, kind: 'mower', model: 'E15', productCode: 'T2880' }`. The ID is opaque and
account-scoped. It is stable only while the same private identity salt is kept.
No local key, real device identifier, user name, token or SDK object is returned.

Discovery does not log in, refresh or replay a failed request. On
`authentication_required`, the caller decides when to call `connect()` again.
Unknown regions or unapproved regional hosts report `mower_region_unsupported`.
A mismatched cloud/device binding reports `mower_binding_unavailable`.
Concurrent discovery reports `mower_discovery_busy`. Neither operation issues
physical commands. The EU E15 authentication, discovery and private key binding are independently
validated. This does not establish command, telemetry or map support. Other
regions have synthetic coverage only.

## Portable map acquisition

`PortableMapAcquisition` owns one bounded read-only acquisition session for one
verified mower binding. It accepts private `MapSessionProvisioning`, exposes
copied `lastComplete` transport files and supports `acquire`, `disconnect`,
`shutdown` and `clearLastComplete`. This independent adapter uses Node built-ins
and preserves the existing camera and mower module interfaces. See the
[full contract, bounds and feature evidence](MAP_ACQUISITION.md).

## Decoded mower map geometry, 0.18.0

`decodeMowerMapSnapshot` turns one `lastComplete` snapshot into read-only
geometry: `map` with identity, grid, bounds, station pose, region boundaries,
obstacles, forbidden zones, walls, tunnels, required and pass-through zones,
`cleaningPath` with point kinds and end pose, and the display-only
`navigationPose`. `decodeMowerMapFile`, `decodeMowerPathFile` and
`decodeMowerPoseFile` decode one file each. Every file decodes independently,
none of the functions throws on malformed input, faults name the reason, byte
offset and message path, unknown enumeration values keep their code and
undecoded field numbers are listed. Integers stay integers and nothing is
selectable or editable. See the
[field semantics, confirmation levels and provenance](MAP_GEOMETRY.md).

## Accumulated cleaning-path history, 0.18.0

`MowerPathAccumulator` merges the decoded cleaning paths of successive
acquisition snapshots into one ordered `MowerPathHistory` per map identity and
generation. `merge` takes the `MowerMapGeometry` of each snapshot in receipt
order and reports `started`, `extended`, `unchanged`, `empty` or `rejected`
with a reason. Every segment records the acquisition revision and `receivedAt`
it came from, the end pose and the path kind follow the latest history or
complete path, point kinds stay unchanged, a `realtime` path never replaces
established points, and empty, malformed, duplicate and out-of-order inputs
leave the history untouched. A changed identity or generation and a diverging
history path start a new history and return the previous one. Histories are
frozen plain data, `history` returns the current one and `clear` drops it.
See the [merge rules and confirmation levels](MAP_GEOMETRY.md#accumulated-cleaning-path-history).

## Read-only local mower session, 0.13.0

`client.mowers.openLocalSession(id, { host, port?, timeoutMs? }, signal?)` opens one
authenticated Tuya LAN protocol 3.5 session to one discovered E15 and returns a
`MowerLocalSession`. `id` is the opaque ID from `discover()`. The private local key
is borrowed from the verified cloud binding only while the session key is
negotiated and is erased afterwards. Consumers never receive or store the local
key. Discovery must have succeeded on the same connected module, otherwise the
call reports `authentication_required` or `mower_binding_unavailable`. A custom
adapter without the private binding capability reports `mower_protocol_unavailable`.

```ts
const [mower] = await client.mowers.discover();
const session = await client.mowers.openLocalSession(mower.id, { host: '192.0.2.10' });
try {
  const snapshot = await session.queryStatus();
  // snapshot.dps holds raw data points exactly as reported. Do not log them.
} finally {
  await session.disconnect();
}
```

The session is read-only. `queryStatus(signal?)` sends one status query and
returns a copied `MowerDpSnapshot` with `source: 'local-tuya-3.5'`, `observedAt`
as the local ISO 8601 receipt time and `dps`, the raw data points as the device
reported them. No data point is interpreted, written or refreshed, and this API
has no command or setting. `queryTelemetry()` decodes that same query response. Snapshot
values can contain private data, so consumers must not log them.

`connected` reports whether the negotiated socket is still open. `closed`
resolves with a `MowerLocalSessionEnd` once the socket has closed and all owned
resources are released. `disconnect()` is idempotent and resolves after actual
closure. Module `shutdown()` closes every open session with `shutdown` and awaits
that closure. An open session no longer depends on the cloud session, so it
survives cloud expiry and a later `discover()`. Opening a new session requires a
connected module with current discovery bindings.

One session runs one operation at a time, without retry, reconnect or automatic
polling. `timeoutMs` bounds connecting plus key negotiation, and separately each
query, default 5000 ms and at most 60000 ms. The device closes a connection that
stays silent for about 30 seconds, so poll one open session at a shorter interval
or open a session per poll. Errors are `EufyError` codes: `mower_invalid_options`,
`mower_local_key_invalid`, `mower_local_unreachable`, `mower_local_authentication_failed`,
`mower_local_protocol_error`, `mower_local_rejected`, `mower_local_binding_mismatch`,
`mower_local_disconnected` and `mower_local_busy`, plus the existing
`request_timeout`, `request_aborted` and `client_closed`. A wrong local key usually
appears as `request_timeout` or `mower_local_disconnected` while opening, because
the device cannot authenticate the first frame. After any failure other than a
device rejection the session is closed and must be opened again.

The protocol facts, their public sources and the independent reproduction are in
[Mower transport provenance](MOWER_TRANSPORT_PROVENANCE.md). The
[2026-09-16 E15 receipt](research/E15_TELEMETRY_OBSERVATION_2026-09-16.md)
adds live query and cleanup evidence on firmware 6.9.28 to the synthetic tests.

## Spontaneous mower reports, 0.13.0

`session.receiveReport(signal?)` waits for one authenticated command-8 device
report. It returns `MowerDpReport`, a snapshot with `kind: 'device-report'` and
the frame's `sequence`. It never substitutes a query response, cloud cache or
previously merged data points. Report counters may be zero or independent of
request counters, so they are not request acknowledgements.

```ts
const session = await client.mowers.openLocalSession(mower.id, {
  host: '192.0.2.10',
  timeoutMs: 20_000,
});
try {
  const report = await session.receiveReport(signal);
  // This is full-frame arrival time, even if the report waited before consumption.
  const ageMs = Date.now() - Date.parse(report.observedAt);
  if (ageMs >= 0 && ageMs < 5_000) {
    const telemetry = decodeMowerTelemetry(report, { schema: session.schema });
    // Only this report's data points are decoded. Missing values remain missing.
  }
} finally {
  await session.disconnect();
}
```

The session timeout bounds each read. Cancellation, timeout and client shutdown
close the connection. A command-9 transport heartbeat is sent every 10 seconds
only while a report read is pending. It changes no data point and does not
request a refresh. There is no reconnect, report replay or background poll.
One read or query owns the session at a time.

Incoming complete frames retain their arrival time in a queue bounded to 32
frames and 128 KiB including partial input. A slow consumer that exceeds either
bound loses the session with a protocol error instead of silently losing data.
`observedAt` proves receipt, not when the device measured a field. A report can
be partial. Do not mark an older absent field fresh by merging it into a newer
report. A status query can discard intervening reports while waiting for its
reply, so use successive `receiveReport()` calls when observing transitions.

The permitted protocol sources and owned-device observations are recorded in
[the report receipt](research/E15_ACTIVITY_REPORTS_2026-09-16.md).

## Typed mower telemetry, 0.13.0

`session.queryTelemetry(signal?)` runs one status query and returns a
`MowerTelemetry`: `source`, `observedAt`, the four typed fields `status`,
`battery`, `progress` and `network`, `fields` with every reported data point
typed by the device's own declared schema, and the raw `dps` copy.
`decodeMowerTelemetry(snapshot, { schema?, definitions? })` is the same pure
decoder for a snapshot you already hold. `session.schema` is a copy of the
declared data points from discovery, or `undefined` when the cloud supplied none.

```ts
const telemetry = await session.queryTelemetry();
if (telemetry.battery.state === 'reported') console.log(telemetry.battery.value.percent);
// telemetry.fields['8'] carries the E15 battery's declared code, type, unit and validity.
```

A typed field is `reported` only from a `confirmed` definition and a value that
conforms to both the definition and the device declaration. Otherwise it is
`missing`, `invalid` or `unconfirmed`. Nothing is inferred from age or absence.
The E15 defaults report battery percentage, the observed `Wifi` network kind
and `network.value.signalPercent` from independently observed definitions.
`signalPercent` is a 0 to 100 percentage and is not converted to dBm. Status
reports `mowing`, `paused` or `returning` from the confirmed DP 107 payloads,
mowing progress remains `unconfirmed`, and unobserved network enum values are
rejected. Consumers with their own confirmed evidence pass `definitions`,
or `[]` to disable the defaults. See
[typed mower telemetry](MOWER_TELEMETRY.md) for the definition format, levels,
schema provenance and remaining acceptance.

### Raw wire payloads, 0.13.0

`parseMowerWirePayload(value)` decodes one raw data-point value from base64 into
wire records without assigning meaning. It returns `shape: 'fields'` with
`number`, `wire` and `value` per record, `shape: 'default'` for the observed
empty or single-zero-byte payload, or `shape: 'malformed'` with a `reason`. It
is bounded to 256 bytes and 32 records and never throws. The decoder attaches
the same result as `fields[dp].wire` for data points named by a `wire`
definition, today DP 107 `robot_status` on the E15.

```ts
const telemetry = decodeMowerTelemetry(report, { schema: session.schema });
const wire = telemetry.fields['107']?.wire;
if (wire?.shape === 'fields') {
  // Structural values only, for example [{ number: 1, wire: 'varint', value: 2 }, ...].
  // telemetry.status reports 'mowing' for this payload from the confirmed E15 registry.
}
```

The shipped DP 107 definitions are `confirmed` for `mowing`, `paused` and
`returning`. A `wire` definition reports its activity only when every listed
field matches, so the transitional first frame after a control, the map-saving
payload, field 6 and the default payload leave `status` `invalid` for that
report. See the
[DP 107 contract receipt](research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md)
and the
[reproduction receipt](research/E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md).

## Opt-in mower commands, 0.16.0 and 0.17.0

Physical control is off unless the client is constructed with
`mowers.commands`. The opt-in must be explicit and must name the consumer's
own stop route. An invalid opt-in fails construction with
`mower_invalid_options`. Without it `session.sendCommand()` reports
`mower_commands_disabled` before any frame is written.

```ts
const client = new EufyClient({
  mowers: {
    credentials,
    sessionStore,
    commands: {
      enabled: true,
      stopRoute: 'pause then return through this session, official app at hand',
      readBackMs: 10_000,
    },
  },
});
const session = await client.mowers.openLocalSession(mower.id, { host: '192.0.2.10' });
const outcome = await session.sendCommand({ kind: 'pause' });
if (outcome.end === 'reflected') {
  // A fresh DP 107 report decoded to `paused`. Nothing else counts as success.
}
```

`sendCommand({ kind, readBackMs? })` accepts `start`, `pause`, `resume`,
`stop` and `return`. It runs one fresh status query, returned as `before`,
decides the typed refusals on it, writes one declared boolean point, then
reads fresh reports back within the bound, default 10 seconds and at most 60.
The result carries `write`, `sentAt`, the device's frame `reply` when one
arrived, the first `acknowledgement` by a control-point or echo report, the
first matching `activity` from the confirmed DP 107 definitions or, for
`stop`, the first `payload` whose DP 107 records are exactly the map-saving
payload, every report received in `reports`, and `stage` with `end`. `stage` is `sent`, `acknowledged` or
`reflected`. `end` is `reflected`, `rejected`, `timed_out` or `report_limit`.
A timeout resolves rather than throws because the write already happened, and
the library never resends it. There is no `completed` and dock arrival is
never inferred.

An optional `onProgress` callback receives fresh observations while the
read-back runs: `{ kind: 'acknowledged', observedAt, sequence, dp }` once, as
in the outcome, and `{ kind: 'activity', observedAt, sequence, value }` for
every fresh DP 107 report that decodes to a confirmed activity. After a `stop`
on the owned E15 that is `returning` within a second, about 30 seconds before
the map-saving reflection ends the read-back. The callback is called
synchronously with frozen copies. Errors it throws are ignored. It cannot
change, end, retry or replay the command, and the outcome stays the only
result. A non-function `onProgress` is refused with `mower_command_invalid`.

Refusals before any write are `mower_command_invalid`,
`mower_command_undeclared`, `mower_command_evidence_missing`,
`mower_command_map_saving`, `mower_command_task_active` and
`mower_command_already_set`. `return` is written only from the stopped task,
DP 1 `switch_go` false with DP 118 at 100, the state in which the official app
offers Charge. On the owned E15 `stop` over DP 1 false ends the task and the
mower returns to the dock by itself, and `return` over DP 3 was ignored from
`paused` and from the stopped task, see the hardware acceptance in
[Opt-in mower commands](MOWER_COMMANDS.md). One
command owns the session, so a concurrent read reports `mower_local_busy`. Peer loss during
the read-back reports `mower_local_disconnected` and closes the session, which
the consumer must reopen deliberately. `client.mowers.commandsEnabled` and
`session.commandsEnabled` report the opt-in. The written points, their public
sources, the frame format and the remaining hardware acceptance are in
[Opt-in mower commands](MOWER_COMMANDS.md).

## Discovery relationships

`discoverDevices(signal?)` returns typed `DiscoveryResult` data with devices,
relationships and per-device issues. `listDevices(signal?)` retains `Device[]`
and stable identifier fields. Recognized unsupported identities remain visible.
See [the discovery contract](DISCOVERY.md) for operation gates and software evidence.

## Observed camera state

`getDeviceState(id)` returns the latest available `Device` state without opening
a P2P connection. `Device.availability` is an additive optional field, returned
as `online`, `offline`, `disabled` or null from the model's reported status.
`listDevices()` and `discoverDevices()` also include validated cloud battery and
availability observations. See [the eufyCam state contract](EUFYCAM.md) for missing
values, unsupported properties, source priority and unchanged identity fields.

## SoloCam discovery, 0.11.0

The [SoloCam evidence guide](SOLOCAM.md) lists ten exact model/type pairs with
H3 discovery, observed state and motion/person routing. Public identifiers and
API signatures are unchanged. Standalone descriptors identify their own owner
but retain `standalone_transport_unverified`. Existing T8134 media admission is
preserved. Version 0.12.0 enables the nine additional models on the existing
[H3 media profile](SOLOCAM.md#h3-core-media-0120), with unchanged API methods.
Unsupported owner/firmware combinations retain `camera_media_unverified`.

### Audio discovered after live startup

`LiveStream.metadata` returns the current observed metadata. Video-only startup
remains bounded to the existing audio discovery deadline. A later first audio
packet updates `audioCodec` before its bytes reach `LiveStream.audio`, without
a second start event or camera command. Read the handle metadata again when
consuming first audio data. A cached metadata object remains a snapshot.

This does not renegotiate consumer transports. A consumer that started a
video-only mux or SDP session must handle late track admission separately.
No actual audio packet is inferred from expiration of the startup timer.
