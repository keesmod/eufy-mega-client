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

One station can own one live stream, recording transfer or conflicting command
at a time. Conflicts fail with `station_busy`. Live sessions have a 120-second
upper bound. The caller's abort signal also stops an established stream.

Always await `stop()` or `ended`. `confirmed: true` requires the device's STOP
acknowledgement; a local EOF, socket close or timeout does not establish success.
Cancelling an issued start retains its cleanup owner while awaiting STOP, even
if no stream handle was returned. Subscribe to `live-stop` for that result.

`stopLive(cameraId)` stops an owned stream. `ensureLiveStopped(cameraId, signal?)`
sends an explicit STOP and checks its acknowledgement when recovering from an
uncertain previous session. It rejects while another operation owns the station.
An old stream handle cannot stop a newer stream.

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
