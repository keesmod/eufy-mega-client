# Live streams beyond 120 seconds and a free primary session, 2026-09-19

Evidence for [#163](https://github.com/keesmod/eufy-mega-client/issues/163),
asked by [keesmod/ha-eufy-cam#94](https://github.com/keesmod/ha-eufy-cam/issues/94).
Two questions were tested on the maintainer's bench: does a HomeBase 3 keep a
P2P live stream running well beyond the client's 120-second bound, and does
control on an idle primary session work while the live stream runs on an extra
session. The tester's 30 to 60 minute run on mains powered cameras is not part
of this note.

## Result

- (a) Yes. One T8160 streamed for 600 seconds on the primary session. Neither
  the HomeBase nor the P2P session ended the stream at 120 seconds or at any
  other point. The only stop was the probe's own STOP at 600 seconds.
- (b) Cost stayed flat. 15.0 video chunks per second on average in every
  30-second window, no second without video, no second below 10, no reconnect,
  no session event. The client process used 5.3 to 6.5 percent of one core. The
  camera reported 86 percent battery before and after, both from the cloud
  inventory and from the P2P property.
- (c) Yes. With the first live stream on an extra session and the primary
  session idle, a cached state read, a station state refresh over P2P, a fresh
  cover snapshot and a guard mode command all succeeded during the stream. The
  HomeBase acknowledged the mode command with return code 0 and confirmed the
  mode by telemetry 432 milliseconds after the call. The stream kept its rate
  meanwhile.
- (d) Yes. Both STOPs were acknowledged by the device with return code 0 on the
  session that carried the stream, 19 milliseconds after the ten-minute stream
  and 16 milliseconds after the 40-second stream on the extra session.

The bound in this client is process-local and not a firmware limit, as the
camera bridge's architecture note already states. This is one bench, one battery
camera, one firmware tuple and ten minutes. It does not establish the cost of an
hour on a mains powered camera, which is the tester's observation.

## Bench and software

| Item        | Value                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Station     | T8030 HomeBase 3, firmware 3.8.7.4, hardware V05, wired LAN                                                                                                                                         |
| Camera      | One T8160 eufyCam 3, firmware 3.4.3.0, hardware P1, the one with the highest battery (86 percent). The other two T8160 (25 and 14 percent) and the T8213 on the same station were not used.         |
| Transport   | Local only, LAN lookup, LAN-derived command credentials, `maxLiveStreamsPerStation` 2 in the probe                                                                                                  |
| Client      | Research prototype branch [`live-bound-research-163`](https://github.com/keesmod/eufy-mega-client/tree/live-bound-research-163) at `2f384a3` on main `dff52f3` (0.13.0), environment switches only  |
| Probe       | `scripts/research/live-bound-probe.mjs` on that branch. Bounded phases, device-confirmed STOP only, labels instead of identifiers, emergency stop through `ensureLiveStopped`                       |
| Runtime     | Node 24.16.0 on macOS arm64, same LAN segment as the station                                                                                                                                        |
| Environment | The production camera bridge on this bench (0.8.21 with library 0.13.0) was stopped for the window and restarted afterwards, so the station saw only the probe's sessions. One controller at a time |

The prototype adds three switches to the transport for this experiment. One
overrides the per-stream bound for both the primary and the extra session
timer, one routes the first live stream on a station to an extra session and
lets a guard mode command use the idle primary session, and one sends a guard
mode write even when the requested mode equals the current one. Nothing in the
public API changed and the switches are not part of any release.

Chunk counts below are the P2P video and audio chunks delivered to the consumer
streams, one chunk per received media message. They are not decoded frames.

## Method

Observation A, one stream for ten minutes: log in fresh into a private session
store, connect the station on the primary session, read the guard mode, query
a fresh cover snapshot and record the battery. Start the camera on the primary
session with the client bound raised to 660 seconds so that only the probe's
stop at 600 seconds ends the stream. Report every 30 seconds. Stop, then read
the guard mode, query a fresh snapshot and record the battery again. A local end
of stream, socket close or timeout never counted as success.

Observation B, control while streaming, bounded to 60 seconds: with the first
stream routed to an extra session, start the camera and confirm that the
primary session owns no stream. After five seconds read the cached station
state, refresh the station state over P2P, query a fresh snapshot and send a
guard mode command that repeats the mode read before the stream, so that the
effective mode cannot change. Read the mode back and restore it if it differs.
Stop at 40 seconds and repeat the reads.

## Observation A, ten minutes on the primary session

Times are seconds since the live start.

| Step            | Observation                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before          | Station connected with LAN-derived encryption 0.8 s after the call, guard mode 1 and current mode 1, stored cover JPEG of 16147 bytes in 54 ms, battery 86 percent                                 |
| Start           | START on the primary session, first media 1.96 s after the call. Announced 15 fps 1920 by 1080, observed H.264 3840 by 2160 with AAC                                                               |
| 0 to 120 s      | Four windows at 15.3, 15.0, 15.0 and 15.1 chunks per second. The 120-second mark passed without any event from the station or the session                                                          |
| 120 to 600 s    | Sixteen windows between 14.9 and 15.1 chunks per second, per-second minimum 11 and maximum 19 after the first window, no second without video, no second below 10                                  |
| Totals          | 8981 video chunks in 598 counted seconds, 191.95 MB of video (2.56 Mbit per second), 9343 audio chunks, 1.79 MB of audio                                                                           |
| Session events  | None. No `livestream stop`, `livestream error` or `close` on the primary session, no station telemetry event, station connected at every report                                                    |
| Process cost    | 5.3 to 6.5 percent of one core per window, resident memory 179 to 296 MB                                                                                                                           |
| Stop at 600.1 s | STOP sent by the probe on the primary session, the session reported the stream stopped 1 ms later, device acknowledgement with return code 0 after 19 ms, `stop()` resolved confirmed after 103 ms |
| After           | Station state refreshed over P2P in 412 ms, connected, guard mode 1 and current mode 1 unchanged, fresh cover query returned the same 16147-byte JPEG in 85 ms, battery 86 percent                 |

The cover snapshot is the HomeBase's stored image and does not change without a
new event, so the test shows that the query path works after the stream, not
that a new image was captured.

## Observation B, control on an idle primary session

Times are seconds since the live start.

| Step                   | Observation                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before                 | Primary session connected, guard mode 1 and current mode 1, cover JPEG of 16147 bytes, battery 86 percent                                                                                                |
| Start on extra session | Extra session connected 0.4 s after the call, START and first media within 2.79 s. The primary session owned no stream, one extra session registered. Observed H.264 3840 by 2160 with AAC               |
| 0 to 4 s               | 70 video chunks, 17.5 per second with the initial burst                                                                                                                                                  |
| Cached state, 5 s      | Connected, guard mode 1, current mode 1                                                                                                                                                                  |
| State refresh over P2P | Command on the idle primary session, answered in 59 ms, connected, guard mode 1. The stream delivered 2 chunks meanwhile                                                                                 |
| Fresh snapshot         | Database query and image download on the primary session, 16147 bytes in 69 ms, 1 chunk meanwhile                                                                                                        |
| Guard mode command     | Mode 1 sent again on the primary session. Acknowledged by the station with return code 0 on channel 255 for the guard mode property, confirmed by a P2P observation, 432 ms in total, 6 chunks meanwhile |
| Mode check             | Refreshed in 293 ms, guard mode 1 and current mode 1, no restore needed                                                                                                                                  |
| 0 to 40 s              | 562 video chunks in 37 counted seconds (15.2 per second), minimum 12 and maximum 24, no second without video, 10.31 MB of video, 581 audio chunks                                                        |
| Stop at 40.0 s         | STOP on the extra session, stream stopped 1 ms later, acknowledged with return code 0 after 16 ms, confirmed, extra session closed and its socket released, `stop()` resolved after 176 ms               |
| After                  | Primary session still connected, state refreshed in 46 ms with guard mode 1 and current mode 1, fresh snapshot in 61 ms, battery 86 percent, no extra session and no primary stream left                 |

The HomeBase therefore does not refuse a mode command because another session
streams. The `station_busy` answer during a live stream today comes from this
client's interlock, which treats every live session on the station as busy.

## What the sources did not predict

- No cost over time in ten minutes. The rate, the process load and the memory
  stayed within the same band in every window, so the 120-second bound protects
  nothing on the station side for this camera. Its remaining reasons are the
  viewer bound in the bridge and battery use, which this run could not measure
  through the reported percentage.
- A same-mode guard write is a real command for the HomeBase 3. The vendored
  station code sends it without comparing the current mode, and the station
  acknowledged it with return code 0 and reported the mode again afterwards.

## Implementation check, 2026-09-19

The probe ran once more against the implementation for
[#165](https://github.com/keesmod/eufy-mega-client/issues/165) on the public
API instead of the prototype switches: `maxLiveStreamsPerStation` 2,
`liveUpperBoundMs` 180000 and `startLive(cameraId, { maxDurationMs: 180000 })`,
same bench, same camera at 86 percent, a fresh login into a separate session
store, the production bridge paused for the window and restored afterwards.
Times are seconds since the live start.

| Step             | Observation                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bound validation | A start with `maxDurationMs` one above the ceiling was rejected with `invalid_live_bound` before any station contact                                                                                                                                                     |
| Start            | The stream took an extra session, the primary session owned no stream, first media 3.2 s after the call, observed H.264 3840 by 2160 with AAC                                                                                                                            |
| Control at 30 s  | Cached state fine, state refresh over the primary session in 69 ms, fresh cover snapshot in 65 ms, `setGuardMode` with the mode read before (1) passed the interlock and confirmed in 123 ms without a write, mode unchanged on the check afterwards                     |
| 0 to 180 s       | Six windows between 14.7 and 15.3 chunks per second, one window with a per-second minimum of 6 and two seconds below 10 around the third minute, no second without video, process 5.0 to 6.4 percent of one core                                                         |
| Bound at 180 s   | The library's timer sent STOP on the extra session 180.0 s after the stream handle was created, the session reported the stream stopped 2 ms later, device acknowledgement with return code 0 after 17 ms, `ended` resolved confirmed, extra session closed and released |
| After            | Primary session connected, state refreshed in 360 ms with guard mode 1 and current mode 1, fresh snapshot in 68 ms, battery 86 percent, no extra session and no primary stream left                                                                                      |

Totals: 2709 video chunks in 180 counted seconds, 56.58 MB of video, 2813
audio chunks. The bridge came back with its stored token valid this time, see
the side finding below for the case where it does not.

## Side finding, bridge token after a second login

The production bridge came back after the window with its stored cloud token
rejected: every inventory call answered HTTP 401 with result code 26084, once
per minute, although the token's expiry was four weeks away. The client treats a
stored token with a future expiry as connected without a cloud check, and a
non-2xx answer other than the identity codes 4404 and 4416 becomes `http_error`,
which the bridge retries as a transient failure. No new login happened. The
repair was a backup of the session file, removal of the token, user id, expiry
and cached identity, and a restart, after which the bridge logged in with its
stored credentials in 3.1 seconds and reported inventory, station and push as
connected. The probe's fresh login on the same account twelve minutes earlier is
the probable cause. On 2026-09-18 the same procedure left the bridge's token
valid, so a second login on one account is not reliably harmless. Two follow-ups
belong outside this issue: a rejected token should invalidate the stored session
so that the next connect logs in again, and bench probes should expect to reset
the bridge session afterwards.

## Limits

- One station and firmware tuple, one battery camera, ten minutes on the
  primary session and 40 seconds on an extra session. No mains powered camera,
  no hour-long run, no GPU or bridge measurement, no three-stream case.
- Battery cost is the reported percentage before and after, which did not
  change. That is not a power measurement.
- One guard mode command, repeating the current mode. A real mode change, a
  recording transfer and `ensureLiveStopped` during an extra-session stream were
  not tested.
- Counts are consumer chunk counts from a research probe, not decoded frames.
- The prototype is a research branch with environment switches. `startLive` on
  main still puts the first stream on the primary session, mode commands still
  fail with `station_busy` while any live stream runs, and the 120-second bound
  and the API contract in [API.md](../API.md) are unchanged.

## Next step

One bounded library design issue: a per-start upper bound as an option with
120 seconds as the default, the first live stream on an extra session when
concurrency is enabled so that the primary session stays free for control,
ownership and recovery for that case, and the recording and command interlock
restated for a station whose primary session is idle while extra sessions
stream. The camera bridge and card follow in their own repository, with a
longer bound only for cameras the bridge can identify as mains powered.
