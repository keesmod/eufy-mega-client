# API guide

All imports below come from `@keesmod/eufy-mega-client`. Public results and events
use library-owned types. Protocol SDK objects are private implementation details.

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
