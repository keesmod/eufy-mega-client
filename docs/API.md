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

A mower-only client can be constructed without camera credentials. Since 0.3.0
the mower module uses the independent Home/Tuya adapter by default. Existing
custom lifecycle adapters remain supported. A custom adapter without discovery
reports `mower_protocol_unavailable` when discovery is requested.

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
Telemetry, commands, settings and maps are described in the mower sections below.
The adapter contract adds no physical control methods. Dated E15 hardware results
per feature are in the [model matrix](MODEL_MATRIX.md#e15-local-telemetry-2026-09-16).

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
  `connectStation(id, { signal?, onProgress?, onLookup? })` also reports its
  [stages](#station-connection-stages-0260) and its
  [lookup observation](#station-lookup-observation-0300).
- `getStationState(id)` returns the last observed state. Mode values can be
  `null` before device telemetry arrives.
- `refreshStationState(id, signal?)` requests a fresh device observation.
- `snapshot(cameraId, signal?)` returns the latest HomeBase cover JPEG with its
  receipt time. It does not wake a camera for a new live capture.

### Station connection stages, 0.26.0

The library looks for the station on the LAN before it opens a session. The
first lookup goes to the private LAN address the inventory had when the
station's session was created. Without one, it goes to the private address the
station last completed a session handshake from, if any. When the first lookup
stays silent for a second, every retry also goes to the directed broadcast
address of each external IPv4 interface, at most 16 and skipping /31 and /32
interfaces. Without any address the first lookup already goes to those
broadcasts. Without any address and without a broadcast address, the earlier
guess applies, the /24 broadcast of the first external IPv4 address if there is
one. Without an interface list at all, only a known address is asked. Only the
station's answer with its own DID ends the lookup. A connection attempt fails
with `device_request_timeout` after 20 seconds, or earlier with
`device_disconnected` when it joins a reconnect the library started itself and
that reconnect gives up first.

`connectStation(id, { onProgress })` reports each stage of that attempt once,
in the order observed, with `elapsedMs` since the attempt started:

| Stage              | Meaning                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lookup`           | The attempt started and its local lookup is about to begin. `inventoryAddress` says whether the station's session was created with a LAN address from the inventory |
| `station_found`    | The station answered the lookup with its own DID                                                                                                                    |
| `session_open`     | The station answered the session handshake                                                                                                                          |
| `encryption_ready` | The command key is in place and the connection resolves                                                                                                             |

An already connected station resolves without stages. The callback runs
synchronously until the attempt resolves, fails or is cancelled. Errors it
throws are ignored, and it cannot change or retry the connection. A stage
carries no identifiers or addresses. A failure after `lookup` alone means no
reply with the station's own DID arrived, after `station_found` the station did
not complete the handshake, and after `session_open` the command key was not
established. The [lookup observation](#station-lookup-observation-0300) shows
whether anything else answered the lookup.

### Station lookup observation, 0.30.0

`connectStation(id, { onLookup })` reports what the local lookup of an attempt
saw, so a failure at the `lookup` stage can tell a lookup that received nothing
from one whose replies arrived and were dropped. It is called synchronously at
most once per attempt that reached `lookup`, when that attempt resolves, fails
or is cancelled, and before a failed attempt closes its session. An already
connected station, an attempt refused with `connection_busy` and an attempt that
ended before `lookup` report nothing. Errors it throws are ignored, and it
cannot change the connection. The lookup's targets, timing, retries, socket and
the DID it accepts are the same with and without `onLookup`.

| Field                      | Meaning                                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rounds`                   | Lookup rounds sent, 0 to 99. A round with no target is not counted                                                                                                          |
| `broadcastTargets`         | Directed broadcast targets of the latest round, 0 to 16. The first round to a known address has none                                                                        |
| `broadcastEnabled`         | Whether the session's UDP socket accepted broadcasts when it was bound                                                                                                      |
| `sendErrors`               | Lookup sends that failed                                                                                                                                                    |
| `datagrams`                | Datagrams the session's socket received while the lookup ran                                                                                                                |
| `otherHeaders`             | Of those, datagrams that are not lookup replies                                                                                                                             |
| `ownReplies`               | Replies with the station's own DID, by the exact comparison the lookup uses. The first one ends the lookup                                                                  |
| `ownRound`                 | Only with an own reply: the latest round sent when the first one arrived, counted from 0, at most 99                                                                        |
| `accountReplies`           | Replies with the DID of another device or station in the inventory the client loaded                                                                                        |
| `foreignReplies`           | Replies with a DID that is not in that inventory                                                                                                                            |
| `nearReplies`              | Replies that are not own but match the own DID once each part is cut at its first NUL byte, trimmed and upper-cased, with the middle number compared as an integer          |
| `inventoryReply`           | `own`, `account`, `foreign` or `near`: the class of the first classified reply from the inventory address the session was created with. `none` without one                  |
| `inventoryAddressOnSubnet` | Only with an inventory address: whether it lies inside the address and netmask of one of the host's external IPv4 interfaces. Absent when the interface list cannot be read |
| `inventoryAddressShared`   | Only with an inventory address: whether another device or station in the inventory has the same private LAN address                                                         |

Counts without a bound in the table saturate at 999. A lookup reply shorter
than 16 bytes has no complete DID and counts only in `datagrams`. An attempt
whose session ran no lookup, such as one cancelled from its `lookup` stage
callback, reports zero counts, `broadcastEnabled: false` and
`inventoryReply: 'none'`, whatever an earlier lookup of the session saw. An
attempt that joins a reconnect the library started itself reports that lookup
from its start. A close the attempt did not make, after a rejected command key
or by another operation, keeps the counts for its report.

The observation carries no DID, address, port, serial or interface name. Before
an attempt starts its session, the client hands the session the DIDs of the
other devices and stations in the inventory. The session keeps its own copy of
them, which never leaves the process. It compares the DID of each lookup reply
with the station's own DID and with that copy when the reply arrives, and then
only counts the reply. The DID of a replying device is never stored or
reported. Only the counters are kept, also across a close, until the session
starts its next connection.

`rounds: 0` means no lookup left the session. `datagrams: 0` means nothing
reached the session's socket during the lookup. `sendErrors` and
`broadcastEnabled` then show whether the lookups could leave the host. Account
or foreign replies without an own reply show that other devices answered.
`nearReplies` points to a reply that the exact DID comparison rejects.
`inventoryAddressOnSubnet: false` says the inventory address is outside every
local subnet of the host. None of these values proves a cause on its own.

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

### Live start stages, 0.21.0

`startLive(cameraId, { onProgress })` reports each stage of that start once, in
the order observed, with `elapsedMs` since the call:

| Stage           | Meaning                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `session_ready` | The P2P session that carries the stream is connected and encrypted                                                                      |
| `start_issued`  | START was handed to that session                                                                                                        |
| `start_result`  | The station answered START, with its numeric `returnCode`, 0 for success                                                                |
| `no_data_end`   | The P2P library ended the stream because no media followed: 5 seconds after the station's answer, or 20 seconds after START without one |
| `metadata`      | The stream's metadata arrived and the start resolves                                                                                    |

The callback runs synchronously from the call until the start resolves, fails
or is cancelled, also while an issued start awaits its STOP. Errors it throws
are ignored, and it cannot change, end or retry the start. A stage carries no
identifiers. `elapsedMs` is bounded to one hour and `returnCode` to a 32-bit
integer, and a code outside that range is omitted. Only the first answer to
START counts. A start that ends after `start_issued` got no answer from the
station, a non-zero `returnCode` is a refusal, and `start_result` 0 followed
by `no_data_end` or by the caller's cancellation is a start the station
accepted without sending media.

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

Each of the four also accepts `{ signal?, onObservation?, onProgress?, onLookup? }`
in place of the signal, to [observe the operation](#recording-operation-observation-0301)
and its connection.

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

A recording operation that fails or is cancelled after it reached the owner's
connection closes the owner's session, as before. So does a download whose
transfer ends incomplete. On a HomeBase that session is shared by all its
cameras, and the next operation connects again.

### Recording operation observation, 0.30.1

`listRecordings`, `recordingCalendar`, `recordingThumbnail` and
`downloadRecording` accept `RecordingOperationOptions` in place of the signal:
`{ signal?, onObservation?, onProgress?, onLookup? }`. A plain signal works as
before. When the operation has to connect the owner, `onProgress` and `onLookup`
are passed to that connection and report its
[stages](#station-connection-stages-0260) and its
[lookup observation](#station-lookup-observation-0300) as with
`connectStation`. An owner that is already connected reports neither.

`onObservation` is called synchronously exactly once per operation, before its
promise settles: on success, on failure, on a refusal before any connection and
on cancellation. Errors it throws are ignored, and it cannot change the
operation. A call that fails before the client's device transport is ready,
such as with `authentication_required` or `client_closed`, reports nothing. A
download reports the start of its transfer when the `RecordingDownload` is
returned, not its `completed` result. Without `onObservation` the operation
attaches no listener.

| Field                 | Meaning                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operation`           | `list`, `calendar`, `thumbnail`, `download` or `probe`, the [standalone recording probe](#standalone-recording-probe-0301)                                                                                                                  |
| `owner`               | `standalone` for an [experimental standalone](#experimental-standalone-cameras) owner, whose recordings capability is unavailable, see below. Else `station`. Also `station` for an unknown or expired recording ID, whose owner is unknown |
| `sessionOpen`         | Whether the owner's session was connected when the operation started. `false` for an unknown or expired recording ID                                                                                                                        |
| `stage`               | The last stage reached, see below                                                                                                                                                                                                           |
| `code`                | The `EufyError` code on failure, `unexpected_error` for any other error, `null` on success                                                                                                                                                  |
| `remoteCode`          | The error's numeric `remoteCode`, such as the database result of `history_rejected`, else `null`                                                                                                                                            |
| `elapsedMs`           | Milliseconds since the operation started                                                                                                                                                                                                    |
| `pages`               | A list: one entry per query page sent, at most 4. A calendar: one entry with `limit: 0`. A probe: one entry with `limit: 20`. A thumbnail or download: empty                                                                                |
| `unhandledReplies`    | Database replies the owner's session could not dispatch during the operation, 0 to 99. A probe does not count those with inner command 10013                                                                                                |
| `unhandledReason`     | Of the latest such reply: `unknown_cmd` when it has no inner command the session handles, `parse_error` when the session could not parse it. `null` without one                                                                             |
| `unhandledResultCode` | The database result code (mIntRet) of the latest such reply, `null` when it has none                                                                                                                                                        |
| `rowClasses`          | A list or probe: counts over the rows of the latest answered page, once an answer with a row array arrived. Otherwise `null`                                                                                                                |

| Stage       | Meaning                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admission` | Input, recording reference and busy checks before any connection. `station_busy`, invalid input, an expired ID and, on a standalone owner, `recording_cipher_unavailable` and `standalone_recordings_unverified` end here |
| `connect`   | The owner's connection was requested. `connection_busy` and a failed connection end here                                                                                                                                  |
| `query`     | The query or image request was sent on the owner's session and no answer arrived                                                                                                                                          |
| `validate`  | An answer arrived and was checked. `history_rejected`, `calendar_rejected`, the completeness codes and `invalid_recording` end here                                                                                       |
| `transfer`  | A download was started on the owner's session                                                                                                                                                                             |

Each entry of `pages`:

| Field        | Meaning                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`      | Rows requested: 100, 500, 2000 or 10000 for a list, 0 for a calendar and 20 for a probe                                                                                                                               |
| `elapsedMs`  | From sending the page until its answer, or until the operation ended without one                                                                                                                                      |
| `answered`   | Whether the answer for this page arrived                                                                                                                                                                              |
| `ackCode`    | The return code of the command result for this query, matched by the query's command name and in send order. Results of commands that were still pending when the operation began are not counted. `null` without one |
| `resultCode` | The answer's database result code (mIntRet). `null` without an answer                                                                                                                                                 |
| `rows`       | Rows in the answer, 0 to 10000. `null` without an answer                                                                                                                                                              |

`rowClasses` counts the rows the way the list checks them. `own`,
`otherDevice` and `stationMismatch` divide the rows. The other three count
across them. A probe counts each merged 10017 record by its device and station
IDs and its history row's storage path, cipher ID and times. A record with crop
pictures only has no history row, so one of the owner's cameras counts as
`stationMismatch` and `invalidTime`.

| Field             | Meaning                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `own`             | A camera of this owner, with the owner's station ID and a valid storage path                                                                                                  |
| `otherDevice`     | A device that is not a camera of this owner. The list skips it                                                                                                                |
| `stationMismatch` | A camera of this owner with another station ID or an invalid storage path. The list fails with `invalid_recording`                                                            |
| `invalidTime`     | A start or end time that is not a valid date. For a camera of this owner the list fails with `invalid_recording_date`                                                         |
| `otherDay`        | A valid start time on another day than the requested one. The list skips it                                                                                                   |
| `cipherId`        | A row with a cipher ID of any value, also 0 or `null`. A standalone owner refuses its download with `recording_cipher_unavailable`, before `standalone_recordings_unverified` |

Every number is an integer. Times are bounded to one hour, counts of rows to
10000, and codes are clamped to -999999 to 999999. The observation carries no
serial, DID, path, name or address. The vendored P2P session reports a database
reply it cannot dispatch with its inner command and result code only, never the
payload.

Some readings. A list that ends with `device_request_timeout` at `query` and
`answered: false` received no usable answer within 15 seconds. With
`ackCode: null` and no unhandled reply, no command result arrived for the query
within the page bound, so the device stayed silent. A non-zero `ackCode` other
than -133 is the device's refusal. -133 is the session's own result. It reports
a device that kept answering 503 (failed to request) until the session gave up,
or a query without a command result 30 seconds after the device acknowledged
it, which is longer than a page bound.
`unknown_cmd` with an `unhandledResultCode` such as -6006 is an answer without
an inner command, and `parse_error` an answer the session could not parse.
Results of commands that were still pending when the operation began, such as
a late result of an earlier query on the same open session, are not counted.
Within one list, a page without a command result lets the next page's result
count for it, because results are matched in send order. `history_rejected` at
`validate` carries the database result in `remoteCode` and `resultCode`.
`device_disconnected` at `query` is a session that closed while the query
waited. None of these values proves a cause on its own.

On an [experimental standalone](#experimental-standalone-cameras) owner the
recordings capability is unavailable with the reason
`standalone_recordings_unverified`. A thumbnail or download of one of its
records ends at `admission` with that code, with `owner: 'standalone'`, no pages
and no connection or device command. A download of a record with a cipher ID
ends with `recording_cipher_unavailable` first. `listRecordings` and
`recordingCalendar` stay owner-wide library calls without that gate. A consumer
that ignores the capability and calls them on a standalone owner still sends
10006 or 10008 to the camera, can wait 15 seconds for each page, and gets the
observation as before.

Observation only. Query payloads, page sizes, timeouts, error codes and the
session close after a failure are the same with and without these options.

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
and since 0.22.0 from the mission status, which adds the app's other mowing
missions and `idle` for a message without a mission,
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
field matches, so the transitional first frame after a control and the
map-saving payload leave `status` `invalid` for that report. Since 0.22.0 the
mission status reports field 6 = 1 and the default payload as `idle`. See the
[DP 107 contract receipt](research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md),
the [reproduction receipt](research/E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md)
and the [mission status receipt](research/E15_MISSION_STATUS_SCHEMA_2026-09-25.md).

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

## Opt-in mower settings, 0.20.0

Setting writes are off unless the client is constructed with
`mowers.settings`, an opt-in separate from `commands`. An invalid opt-in fails
construction with `mower_invalid_options`. Without it `session.setSetting()`
reports `mower_settings_disabled` before any frame is written. Reading needs
no opt-in.

```ts
const client = new EufyClient({
  mowers: { credentials, sessionStore, settings: { enabled: true, readBackMs: 10_000 } },
});
const session = await client.mowers.openLocalSession(mower.id, { host: '192.0.2.10' });
const { settings } = await session.querySettings();
if (settings.mowHeight.state === 'reported' && settings.mowHeight.writable) {
  const outcome = await session.setSetting({ name: 'mowHeight', value: 45 });
  if (outcome.end === 'reflected') {
    // A fresh report carried DP 110 at 45. A restore is a second, deliberate call:
    await session.setSetting({ name: 'mowHeight', value: outcome.previous });
  }
}
```

`querySettings()` runs one status query and `decodeMowerSettings(snapshot,
{ schema })` decodes an existing snapshot without I/O. Each of `mowHeight`,
`volume`, `smartNoGoZones`, `sparseLawnOptimization`, `rainAutoReturn`,
`childLock` and `birdViewCapture` is `reported` with `dp`, `type`, `value` and
`writable`, plus `min`, `max`, `step` and `unit` for the two value settings,
or `missing` or `invalid`. `writable` requires the library's table and the
session schema, not the opt-in.

`setSetting({ name, value, readBackMs? })` writes only `mowHeight` (25 to 75
mm), `volume` (0 to 100 %), `smartNoGoZones` and `sparseLawnOptimization`. It
runs one fresh status query, returned as `before` with the current value as
`previous`, decides the typed refusals on it, writes one declared point in the
control frame of the commands, then reads fresh reports back within the
bound, default 10 seconds and at most 60. `stage` is `sent` or `reflected`.
`end` is `reflected`, `rejected`, `timed_out` or `report_limit`. The first
fresh report with the written value is `reflection`, the latest fresh report
with another value is `other`. A timeout resolves because the write already
happened, and the library never resends or restores it.

Refusals before any write are `mower_setting_invalid`,
`mower_setting_read_only`, `mower_setting_undeclared`,
`mower_setting_evidence_missing`, `mower_setting_map_saving` and
`mower_setting_already_set`. Rain and child protection, `rainAutoReturn` and
`childLock`, are read only in either direction, as is `birdViewCapture`. One
write owns the session like a command. `client.mowers.settingsEnabled` and
`session.settingsEnabled` report the opt-in. The data points, their permitted
sources and the pending hardware acceptance are in
[Opt-in mower settings](MOWER_SETTINGS.md).

Upgrade note: `MowerLocalSession` gains `settingsEnabled`, `querySettings()`
and `setSetting()`, and `MowerModule` gains `settingsEnabled`. A consumer that
implements these interfaces itself, for example in a test double, adds them.

## Mower cloud state

`client.mowers.queryCloudState(id, signal?)` reads DP 107 activity, the DP 108
charger contact and DP 155 work parameters from one discovered E15's
authenticated cloud device record. It makes one `tuya.m.device.get` request and
returns `MowerCloudStateReading`:

```ts
const reading = await client.mowers.queryCloudState(mower.id);
// source is 'cloud'. observedAt is receipt time, not device time.
if (reading.status.state === 'reported') {
  const activity = reading.status.value;
}
if (reading.charger.state === 'reported') {
  const atStation = reading.charger.connected;
}
if (reading.workParameters.state === 'reported') {
  const parameters = reading.workParameters.parameters;
}
```

`status` is `{ state: 'reported', value: MowerActivity }`, `{ state: 'missing' }`
or `{ state: 'invalid' }`. It shares the confirmed DP 107 decoder with local
telemetry. No activity is inferred from a task flag, battery value or absent
point. `idle` does not prove that the mower is docked.

`charger` is `{ state: 'reported', connected: boolean }`, `{ state: 'missing' }`
or `{ state: 'invalid' }`, since 0.27.0. It reads field 2 of DP 108, the
battery status message, which the official app decodes as its charger
connection. `connected` is true while the mower stands on its charging
station's contacts and false once it has left them. On the owned E15 it held
through a 29-minute rest in hibernation and through 20-minute stops on the
lawn, so it is the confirmed reading that separates a rest at the station from
a stop on the lawn. It does not replace `status`:
while the mower defogs in the station after a start, `status` is already
`mowing` and `charger` still connected, and on arrival `charger` connects
before `status` leaves `returning`. See the
[charger contact receipt](research/E15_CHARGER_CONTACT_2026-09-29.md).

`workParameters` retains the `MowerWorkParametersReading` contract below and has
the same `observedAt`. Each field keeps its own missing or invalid result.

All three fields are cloud cache values. The library knows when the response arrived,
not when the device last changed any value. Consumers own refresh policy and
expiry. Keep this source separate from local telemetry and never use it to
confirm a command or setting write. The reading exposes no raw data points,
device identifiers or credentials. No control opt-in is needed.

The module must be connected and the mower must have a current discovery binding.
The read uses the existing mower session, never logs in, retries, polls or writes.
Cancellation, shutdown, binding revocation and session expiry prevent a late
result. Authentication, binding, request and lifecycle errors match
`queryWorkParameters()` below. Custom adapters without the internal read
capability report `mower_protocol_unavailable`. Existing `queryWorkParameters()`
callers retain their return contract and still make one request per call.

## Mower work parameters, 0.23.0

`client.mowers.queryWorkParameters(id, signal?)` reads DP 155, the work
parameters of one discovered E15, from the Tuya cloud's device record through
the request discovery already makes. The E15's local status replies do not
carry DP 155. The result is a `MowerWorkParametersReading` with
`source: 'cloud'` and `observedAt`, the library's receipt time of the cloud
response. The cloud value is a cache, so it can be older than that time.

```ts
const [mower] = await client.mowers.discover();
const reading = await client.mowers.queryWorkParameters(mower.id);
if (reading.state === 'reported') {
  const { mowSpeed, bladeSpeed, direction } = reading.parameters;
  // Each field exists only when the value carried it. Nothing was written.
}
```

`state` is `reported` with `parameters` and `undecodedFields`, `missing` when
the record carries no DP 155, or `invalid` when its value does not decode. The
parameters are `mowHeight`, `mowSpeed`, `edgeDistance`, `direction`,
`mowSpacing`, `bladeSpeed` and `currentMowSpacing`, as the device's integers
and the app's enumeration names, with `{ unknown: number }` for an unnamed
enumeration value. `decodeMowerWorkParameters(value)` is the same pure decoder
for a base64 value you already hold. It returns `shape: 'decoded'` or
`shape: 'malformed'` with a `reason`, is bounded to 256 bytes, 64 records and
three nested messages, and never throws. Only DP 155 leaves the adapter. No
identifier, key or other data point of the record is returned.

Discovery must have succeeded on the same connected module, otherwise the
call reports `authentication_required` or `mower_binding_unavailable`. A
custom adapter without the capability reports `mower_protocol_unavailable`.
Cloud errors are `mower_request_failed`, `mower_invalid_response`,
`request_timeout`, `request_aborted` and `client_closed`. Each call makes one
request, without retry or caching. The numbering, its source and the decoding
rules are in [Mower work parameters](MOWER_WORK_PARAMETERS.md).

Behind the settings opt-in, `session.setWorkParameter({ name, value,
readBackMs? })` writes the mow speed or the blade speed as one partial DP 155
message on an open local session:

```ts
const outcome = await session.setWorkParameter({ name: 'bladeSpeed', value: 'high' });
if (outcome.end === 'reflected') {
  // A fresh report carried DP 155 with the blade speed at high. A restore is a second call:
  await session.setWorkParameter({ name: 'bladeSpeed', value: outcome.previous });
}
```

`mowSpeed` takes `low`, `medium` or `adaptive_high`, and `bladeSpeed` takes
`low`, `medium` or `high`, as the exported frozen `WRITABLE_WORK_PARAMETERS`
table lists them. Edge distance, mow spacing, the direction, the mow
height and the current mow spacing are refused as read only. One cloud
reading, like `queryWorkParameters()`, supplies `previous`, because the LAN
status query does not carry DP 155, and one fresh status query decides the
map-save refusal. The write sends only the parameter's field, then reads fresh
reports back like `setSetting()`. `reflection` carries every parameter the
reflecting report decoded to. The outcome also carries `cloud`, the reading
the write was decided on, and `write.encoded`, the base64 message sent.

Refusals before any write are the settings refusals: `mower_settings_disabled`,
`mower_setting_invalid`, `mower_setting_read_only`,
`mower_setting_undeclared`, `mower_setting_evidence_missing`, which includes a
failed or late cloud reading, `mower_setting_map_saving` and
`mower_setting_already_set`. They leave the session open. The written values
and their sources are in [Mower work parameters](MOWER_WORK_PARAMETERS.md).

Upgrade note: `MowerModule` gains `queryWorkParameters()` and
`MowerLocalSession` gains `setWorkParameter()`. A consumer that implements
these interfaces itself, for example in a test double, adds them. The
settings opt-in now also allows the two work parameter writes, and only
through this new call.

## Discovery relationships

`discoverDevices(signal?)` returns typed `DiscoveryResult` data with devices,
relationships and per-device issues. `listDevices(signal?)` retains `Device[]`
and stable identifier fields. Recognized unsupported identities remain visible.
See [the discovery contract](DISCOVERY.md) for operation gates and software evidence.

## Experimental standalone cameras

Version 0.29.0 adds the client option `experimentalStandalone`. It is off by
default. Without it, standalone results only gain the `descriptor` described
below. With it, a standalone camera whose
exact profile allows it becomes its own P2P owner on the existing local route.
Three profiles allow it. `T84A1`/151, the Wall Light Cam S100, has it since 0.29.0 for
[#142](https://github.com/keesmod/eufy-mega-client/issues/142) and
[ha-eufy-cam#66](https://github.com/keesmod/ha-eufy-cam/issues/66). `T8410`/31,
the Indoor Cam E220, which Eufy's comparison page calls Indoor Cam 2K Pan & Tilt,
has it since 0.29.1 for
[ha-eufy-cam#152](https://github.com/keesmod/ha-eufy-cam/issues/152).
`T8410C`/31, the Indoor Cam Pan&Tilt 2K admitted in 0.29.2, has it since 0.30.0
for [ha-eufy-cam#168](https://github.com/keesmod/ha-eufy-cam/issues/168).

- Discovery returns `{ kind: 'standalone', ownerId, transport: 'experimental', descriptor }`
  without an issue. Every other standalone row keeps
  `reason: 'standalone_transport_unverified'` and its issue. Under a HomeBase
  all three models keep their H3 relationship and table media policy, blocked
  for the T84A1 and H3 for the T8410 and T8410C.
- The camera's `stationId` is its own ID. `connectStation(id, { onProgress })`
  connects to the camera itself with the same lookup, [stages](#station-connection-stages-0260)
  and LAN-derived command key as a HomeBase. No cloud DSK, cipher or legacy
  security-cloud call is made.
- Snapshot and live report `available: true` with status `experimental`. They
  use the camera's own session and the vendor command set of its device type.
  Live always uses that one session, also when `maxLiveStreamsPerStation` is
  above 1.
- Since 0.30.1 recordings report `available: false` with status `unsupported`
  and the reason `standalone_recordings_unverified`, for
  [ha-eufy-cam#175](https://github.com/keesmod/ha-eufy-cam/issues/175). No
  recording request with evidence exists on this route, as recorded in the
  [model matrix](MODEL_MATRIX.md#standalone-recordings-outcome-0301).
  `recordingThumbnail` and `downloadRecording` fail with that code at stage
  `admission`, before any connection or device command. A download of a record
  with a cipher ID fails with `recording_cipher_unavailable` first, because it
  would need a cloud cipher. HomeBase owners and their cameras are unchanged.
- Since 0.30.1 `probeStandaloneRecordings` sends one diagnostic 10017 query to
  the camera when a consumer calls it, see the
  [standalone recording probe](#standalone-recording-probe-0301). It leaves the
  recordings capability unavailable.
- `listRecordings` and `recordingCalendar` stay owner-wide library calls, as the
  [capability contract](CAMERA_CAPABILITIES.md) allows for owner-wide metadata.
  They query the camera's own database with the unchanged 10006 and 10008
  requests. A consumer that ignores the capability and calls them still sends
  those requests, can wait 15 seconds for an answer, and gets the
  [recording operation observation](#recording-operation-observation-0301) as
  before. Consumers should follow the capability and not start them.
- Guard mode and `refreshStationState` fail with
  `operation_outside_hardware_scope`. `getStationState` and `station` events
  report its session only, with null modes and no alarm. Pushes for the camera
  are not admitted, so it has no detection events on this route.
- A row without a P2P device ID or administrator user fails with
  `invalid_connection_credentials` for every operation.

No standalone result on this route has been independently reproduced. On
2026-10-13 a T8410 on firmware 2.3.2.4 was reported with working live video, and
on 2026-10-15 one on firmware 2.3.1.6, as recorded in the
[model matrix](MODEL_MATRIX.md#reported-standalone-t8410-result-2026-10-13).
On 2026-10-16 a standalone T8410C on firmware 3.3.4.4 was
[reported](https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6208097780)
with working live video and snapshot. Its firmware is on the 3.3.x line, so the
T8410 results do not transfer to it. In the same report no recording list worked
on this route. Both T8410 cameras acknowledged the query with `ackCode: 0` and
never answered it, and the T8410C, which has no microSD card, rejected it with
`history_rejected` and database result -1100, as recorded in the
[model matrix](MODEL_MATRIX.md#reported-standalone-t8410-and-t8410c-results-2026-10-16).
No other request had enough evidence, so 0.30.1 reports recordings as
unavailable on this route.
A failure is still useful evidence for the next step, not a regression. The
stage a failed connection reached says whether the camera answered the lookup
with its own DID, completed the session handshake, or opened the session without
a command key being established. The
[lookup observation](#station-lookup-observation-0300) from `onLookup` shows
whether anything else answered the lookup.
A connected session sets the key locally, so the first answered command or media
result is what shows the camera accepts it.

Every standalone relationship carries `descriptor`: whether the inventory row
has a P2P device ID (`did`), a P2P license (`license`), an administrator user
(`adminUser`) and a private IPv4 LAN address (`lanAddress`). The values never
leave the library. A present field proves neither validity nor authentication.

### Standalone recording probe, 0.30.1

For [ha-eufy-cam#178](https://github.com/keesmod/ha-eufy-cam/issues/178),
`probeStandaloneRecordings(id, options?)` sends one read-only recording query to
an experimental standalone camera and resolves with a
[recording operation observation](#recording-operation-observation-0301) with
`operation: 'probe'`. It is a diagnostic. It shows whether the camera answers
the app-shaped `CMD_DATABASE_QUERY_LOCAL` 10017 query, which is candidate 1 in
the [model matrix](MODEL_MATRIX.md#standalone-recordings-outcome-0301). It does
not open recordings. Unverified on hardware.

- `options` is `{ signal?, onProgress?, onLookup? }`, the recording operation
  options without `onObservation`, because the observation is the result.
- Only an experimental standalone owner is admitted. A HomeBase, a camera
  behind a HomeBase, an unknown ID and a standalone camera without
  `experimentalStandalone` fail with `operation_outside_hardware_scope` before
  any connection, observation or request. `authentication_required` and
  `client_closed` reject as for every device call.
- After admission the promise resolves for every outcome, with the error code
  in `code`.
- One call sends exactly one 10017 request. When the owner is not connected,
  its connection first sends the vendored latest-info query 10013, as at every
  connect. The probe uses the bounds of the other
  recording operations: the per-owner busy check, the owner's connection with
  `onProgress` and `onLookup` when it is not connected, 15 seconds for the
  answer and 60 seconds overall.
- The day is today in the process's local timezone. The request asks for the
  newest page of at most 20 records from that day to the next.
- It creates no recording ID and sends no 10006, 10008, image or download
  request. The recordings capability stays unavailable with
  `standalone_recordings_unverified`.

The request is command 1350 (`CMD_SET_PAYLOAD`) on frame channel 0, sealed like
every other command on the camera's session, with this JSON. `account_id` is
the row's administrator user, `transaction` the send time in milliseconds, and
the dates are today and the next day. Key order carries no meaning.

```json
{
  "account_id": "<administrator user>",
  "cmd": 1306,
  "mChannel": 0,
  "mValue3": 0,
  "payload": {
    "cmd": 10017,
    "payload": {
      "ai_type": 0,
      "count": 20,
      "detection_type": 0,
      "end_date": "20261017",
      "event_type": 0,
      "flag": 0,
      "start_date": "20261016",
      "start_time": "0",
      "storage_cloud": -1,
      "trigger_type": 0
    },
    "table": "history_record_info",
    "transaction": "1792140000000"
  }
}
```

`start_time` `"0"` asks for the newest records. The request names no device and
asks for no unzipped result. It is built by `databaseQueryLocalNewest`, a client
addition to the vendored Station, see [NOTICE.md](../NOTICE.md). The vendored
`databaseQueryLocal` builder is unchanged and unused. It sends `device_info`,
`res_unzip: 1`, `start_time` as the day at midnight and no `trigger_type`, the
shape a standalone E30 answered with an empty page in
[bropat/eufy-security-client#963](https://github.com/bropat/eufy-security-client/issues/963).
The answer is read by the vendored 10017 parser, unchanged. It merges the
history and crop picture rows of each record. Each source of the request and its
kind of claim is listed in the model matrix. Nothing is copied from the
unlicensed public report.

| `code`                             | `stage`     | Meaning                                                                                                                                                           |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `null`                             | `validate`  | Answered with database result 0. `pages[0].rows` is the number of records, 0 for an empty page, and `rowClasses` counts them                                      |
| `history_rejected`                 | `validate`  | Answered with another database result or none. `remoteCode` and `pages[0].resultCode` carry it when it is an integer                                              |
| `device_request_timeout`           | `query`     | No answer within 15 seconds. `ackCode` is the camera's command result for the request, and `unhandledReplies` counts 10017 replies the session could not dispatch |
| `cancelled`, `device_disconnected` | `query`     | The signal or the client aborted the probe, or the session closed while it waited                                                                                 |
| `device_request_failed`            | `query`     | The request could not be sent, for example a `NotSupportedError` from a station without the query command. No page                                                |
| a connection code                  | `connect`   | The owner's connection failed, such as `device_request_timeout` or `connection_busy`. No request was sent                                                         |
| `station_busy`                     | `admission` | A recording operation, live start or command holds the owner. No request was sent                                                                                 |

A probe that fails after its connection was requested closes the owner's
session, as the other recording operations do. An answer keeps the session open,
also one with a non-zero database result. That differs from `listRecordings`,
which closes the session after `history_rejected`. `unhandledReplies` counts
every unhandled reply except one with inner command 10013. The vendored Station
sends the latest-info query 10013 at every connect, and an unparsable reply to
it during the probe is not counted. Both admitted types, 31 and 151,
list the query command in their vendored command set. How a bridge records and
reads the outcome is described in its own documentation. Each model's result,
a failure included, is recorded in the
[model matrix](MODEL_MATRIX.md#standalone-recording-probe-ha-eufy-cam178).

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
