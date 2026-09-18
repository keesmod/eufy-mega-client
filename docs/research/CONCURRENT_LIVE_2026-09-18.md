# Concurrent live streams on one HomeBase 3, 2026-09-18

Evidence for [#157](https://github.com/keesmod/eufy-mega-client/issues/157),
asked by [keesmod/ha-eufy-cam#84](https://github.com/keesmod/ha-eufy-cam/issues/84).
The question was whether a second, independent P2P session from the same
client process delivers a second concurrent live stream from one HomeBase 3.

## Result

Yes, on the maintainer's bench and for two cameras.

- The T8030 accepted a second P2P session from the same process and host, on a
  second UDP port, with its own `CMD_GATEWAYINFO` exchange and LAN-derived
  command key.
- Two live streams arrived at the same time for 20 seconds, both H.264 at
  3840 by 2160 with AAC audio, each at the camera's 15 frames per second.
- Every STOP was acknowledged by the device on the session that started the
  stream. Stopping the second stream left the first one untouched, and a start
  cancelled after its START command was confirmed on its own session.
- Observed cost in the process: 5.6 percent of one core with one stream and
  8.6 percent with two, including the probe's own counting. The station did not
  throttle or drop the first stream during the window.

This is one bench, one firmware tuple, two of three cameras and a 20-second
window. It establishes feasibility, not a support claim. The library still
owns one live stream per station until the design in the next-step issue lands.

## Bench and software

| Item        | Value                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Station     | T8030 HomeBase 3, firmware 3.8.7.4, hardware V05, wired LAN                                                                                                              |
| Cameras     | Two of three T8160 eufyCam, firmware 3.4.3.0, hardware P1, labelled A and B. A T8213 on the same station was not used.                                                   |
| Transport   | Local only, LAN lookup, LAN-derived command credentials, one session object per camera in the prototype                                                                  |
| Client      | Research prototype branch `concurrent-live-prototype-157` at `bc99c62` on main `956e92a` (0.13.0 unreleased), private transport flag, no public API change               |
| Probe       | `scripts/research/concurrent-live-probe.mjs` on that branch, commit `666ba6d`. Bounded phases, device-confirmed STOP only, labels instead of identifiers                 |
| Runtime     | Node 24.16.0 on macOS arm64, same LAN segment as the station                                                                                                             |
| Environment | The production camera bridge on this bench was stopped for the window and restored afterwards, so the station saw only the probe's sessions. One controller per attempt. |

Frame counts below are the P2P video and audio chunks delivered to the
consumer streams, one chunk per received media message. They are not decoded
frames.

## Method

Phase one, concurrent: connect the station on the primary session, start
camera A on it, observe 8 seconds alone, start camera B on an additional
session keyed by station and channel, observe both for 20 seconds, stop B,
observe A for 5 more seconds, stop A, refresh the station state and read a
stored snapshot through the primary session.

Phase two, cancel before media: start A on the primary session, start B on an
additional session and abort the caller 250 milliseconds after the START
command left that session, wait for the cleanup owner's result, observe A for
3 seconds, stop A, refresh the station state.

Each attempt stayed under 60 seconds. A local end of stream, socket close or
timeout never counted as success.

## Observations

Second run, complete. Times are seconds from the probe's start.

| Step                     | Observation                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Station connect          | Primary session connected with LAN-derived encryption 1.3 s after the call                                                                                                                                                  |
| A start, primary session | START at 1.3 s, first media at 3.6 s. Announced 15 fps 1920 by 1080, observed H.264 3840 by 2160 with AAC                                                                                                                   |
| A alone, 8 s             | 130 video chunks and 126 audio chunks, 1.62 MB of video                                                                                                                                                                     |
| B start, extra session   | New session connected, START sent and first media received within 3.3 s of the call. The primary session still owned A, one extra session registered                                                                        |
| Both, 20 s               | A 300 video chunks (15.0 per second), B 309 video chunks (15.5 per second), both with continuous audio. B delivered 4.78 MB of video in the window. Per-second counts stayed between 12 and 22 for both. No stall on either |
| Process cost             | 5.6 percent of one core alone, 8.6 percent with both streams                                                                                                                                                                |
| Stop B                   | STOP sent on the extra session, acknowledged there 9 ms later with return code 0, stream stop confirmed, extra session closed and its socket released                                                                       |
| A after B stopped, 5 s   | 69 video chunks, ownership and metadata unchanged                                                                                                                                                                           |
| Stop A                   | STOP sent on the primary session, acknowledged with return code 0                                                                                                                                                           |
| After cleanup            | Station state connected with LAN-derived encryption, stored cover JPEG of 8962 bytes read through the primary session                                                                                                       |
| Cancel before media      | A restarted on the primary session, this time observed as H.265. The extra session issued START 0.64 s after the call. The abort 250 ms later sent STOP on the extra session, acknowledged after 1.6 s with return code 0   |
| Cancel cleanup           | The caller's start rejected with `cancelled` after that acknowledgement, the transport reported a confirmed stop for B, no extra session or pending start remained, A continued at 15 per second and stopped confirmed      |

All four stops in the run were confirmed by the device on their own session.
The station stayed connected to the primary session throughout, including
while the extra session sent its END message.

### First run, not counted

The first run ended camera A's stream 25 seconds after its start. The probe had
passed a timeout signal to `startLive`, and the library keeps the caller's
signal attached to the established stream, so the stop came from the probe.
Before that, both streams had run concurrently for 11 seconds at 15 chunks per
second each, and B's STOP was confirmed on its own session. Its cancel case
aborted while the extra session was still connecting, before any START, so it
exercised no STOP path. The second run replaced it.

## What the sources did not predict

- No throttling: both channels ran at the full observed rate for the whole
  window. Longer windows and three streams are untested.
- The additional session connected, started and delivered first media in
  3.3 seconds, faster than the primary session's first connect on this bench.
- One start returned H.265 media although the start command requested the
  H.264 stream type. The metadata reflects the received data, so consumers
  must keep reading the codec from the stream metadata.

## Implementation check, 2026-09-18

The same probe ran once more against the implementation for
[#159](https://github.com/keesmod/eufy-mega-client/issues/159), with the client
option `maxLiveStreamsPerStation` set to 2 instead of the prototype flag, the
same bench and firmware, a fresh login into a separate session store, and the
production bridge paused for the window and restored afterwards.

| Step                   | Observation                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A alone, 8 s           | Primary session, observed H.265 3840 by 2160 with AAC, 132 video chunks, process 5.7 percent of one core                                                                                                       |
| B start, extra session | Connected, START sent and first media received 3.0 s after the call, H.264 3840 by 2160 with AAC, primary session still owned A, one extra session registered                                                  |
| Both, 20 s             | A 298 video chunks (14.9 per second), B 310 (15.5 per second), both with continuous audio, no stall, process 9.8 percent of one core                                                                           |
| Stop B                 | STOP on the extra session, acknowledged there after 10 ms with return code 0, confirmed, session closed and socket released                                                                                    |
| A after B stopped, 5 s | 73 video chunks, ownership unchanged                                                                                                                                                                           |
| Stop A, cleanup        | STOP on the primary session confirmed, station connected with LAN-derived encryption, stored cover JPEG of 8962 bytes read through the primary session                                                         |
| Cancel before media    | A restarted (H.264 this time), extra START issued 0.63 s after the call, abort 250 ms later, STOP on the extra session acknowledged after 1.5 s, caller rejected with `cancelled`, no media, A continued at 15 |
| Result                 | All four stops confirmed by the device on their own session, no extra session or pending start left, station telemetry connected                                                                               |

The counts match the prototype run within normal variation. The codec the
station delivers varies between starts on the same camera, which confirms that
consumers must read it from the stream metadata.

## Side finding, cloud identity

Reusing a stored session from a second host needs the same credentials and
failed until its cached key-exchange identity was cleared: the cloud answered
HTTP 463 with result code 4404. A fresh key exchange on the same token then
worked, but it invalidated the first host's identity. The client's identity
reset for code 4404 sits behind the HTTP status check in `post()`, so the first
host looped on `http_error` until its cached identity was cleared by hand. This
is a client defect independent of #157 and is recorded for a separate fix. Do
not copy a session between hosts for future probes.

## Limits

- One station and firmware tuple, two cameras, a 20-second concurrent window,
  one cancel case. Three or four streams, sub-streams, quality settings,
  battery-backed bases and other owners were not tested.
- Counts are consumer chunk counts from a research probe, not decoded frames
  or a bridge measurement.
- The prototype is a research branch with a private flag. `startLive` on main
  still rejects a second camera on a station with `station_busy`, and the API
  contract in [API.md](../API.md) is unchanged.

## Next step

One bounded library design issue: one session per live camera, ownership and
busy rules across the primary and extra sessions, recovery when a session is
lost or `ensureLiveStopped` runs while another camera streams, the
120-second cap per stream, the recording interlock, and disposal of extra
sessions. Bridge admission and card changes follow in keesmod/ha-eufy-cam.
