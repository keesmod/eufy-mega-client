# Implementation status

Approved scope: complete replacement of ha-eufy-cam on one HomeBase 3 T8030,
three T8160 cameras and one T8213 doorbell. Publish only after complete
acceptance, including an overnight observation period. The owner shortened the
original 24-hour gate to 09:00 Europe/Amsterdam on 2026-09-10 and explicitly
approved automatic continuation into migration and publication after acceptance.

## Baseline, 2026-09-09

- Live integration and bridge: 0.5.1, connected.
- T8030 firmware 3.8.6.0; T8160 firmware 3.4.3.0; T8213 firmware 0.2.1.8.
- Existing snapshots available on all four cameras. The initial HomeBase mode was Home (1).
  Later external activity changed it to Away (0); tests must restore the mode
  freshly observed before that particular test.
- Separate Mega HTTP research session authenticated without importing existing
  session data. Mega inventory returned all five target devices.
- Raw research responses and credentials remain on the HA host. They must not
  be packaged or published.

## Development and acceptance

The standalone library and bridge backend are implemented locally. The library
has 41 passing protocol and lifecycle tests. All 57 bridge tests pass; 76 HA regression tests pass. These checks accompany
hardware acceptance on both the test HA VM and production.

Preliminary hardware probes covered authentication, inventory, snapshots,
live JPEG and WebRTC video/audio, device stop acknowledgements, recording
history, H.264/H.265 playback and seeking, cancellation, device network recovery,
and a Guard Mode round trip restored to Home. The history matched the original
bridge's 48 camera clips from 50 rows on 2026-09-08, with hash
`b828afd95fd72b70d30dcd96d2d0a6e7a0164fb99b6a2002e721ecb9c3841947`.

A test-control defect was then identified: the production app watchdog restarted
the original bridge after Docker stopped it. These probes did not establish
exclusive device ownership and are not final acceptance evidence. Final
acceptance moved to the existing Proxmox HA test VM 100. The user explicitly authorized
keeping the production bridge disabled during development on 2026-09-09.
Its watchdog, auto-update and boot settings are backed up before the pause.

Feature acceptance and the production migration passed. Publication uses a
compiled GitHub asset and an exact dependency integrity pin in the bridge.

The isolated VM feature and fault checks have passed, including a real
138-record day, WebRTC video/audio on all four cameras, actual ring/person
notifications, push reconnection, active shutdown and controlled expiry recovery.
See [the compatibility results](COMPATIBILITY.md) for their limits.

## Connection evidence

A bounded LAN probe using descriptors from fresh Mega discovery connected to the
HomeBase, received video and audio, stopped the stream and disconnected. All SDK
cloud callbacks were denied. This proves the LAN transport path can avoid DSK
cloud lookup. It is not full replacement acceptance or HA playback proof.

The gateway requested cipher 55. The upstream probe selected level 1 when that
cipher callback was denied. A subsequent read of the actual production protocol
instance confirmed that it already uses level 1 on T8030, connected with no active
video. The temporary loopback debugger was closed and closure was verified.
The initial library therefore explicitly selects LAN-derived command credentials,
matching the observed baseline. It does not attempt a cipher request and fall back.
Stronger command encryption is not claimed.
A signed Mega request to the Mega-reported security product domain's existing
cipher route returned HTTP 463. No cipher or legacy session was imported.

The official Android app 6.0.90_29798 was obtained for interoperability research.
Its signing certificate matches the expected Anker SHA-256 fingerprint
`166c234557b776cad8ac94c979379e48df387d4d8f96a343df40fcd905bff686`.
Research binaries and app code are outside the package. No app code is copied
into this MIT library. The disposable emulator is stopped. No Eufy account was used in it.

Before the authorized development pause, production readback showed four
cameras, a connected station and zero active streams. Its original
configuration, sessions and entity identities are retained for rollback.

## Transport fixes covered by regression tests

- A local livestream-stop event is not a device acknowledgement.
- A local recording-download finish is not proof of a complete clip. Only the
  HomeBase completion command plus drained streams can complete the transfer.
- FCM parser reset preserves one owner subscription across reconnects.
- Guard Mode requires fresh P2P telemetry after the command acknowledgement.

Current implementation uses LAN-derived command credentials explicitly, as the
production bridge did. Legacy product hosts were blocked in all packaged tests.
Google FCM endpoints remain required for notifications; they are not legacy Eufy
cloud API endpoints. Mega push registration succeeded at
`app-push-eu-pr.eufy.com/app/push/register_push_token`.

## Test VM acceptance, 2026-09-09

Production is intentionally disabled for development, with automatic restart and
updates paused. VM 100 has a full Proxmox backup taken before boot. Its HACS
integration was updated from 0.4.1 to 0.5.1 through HA; the original ten identities
are preserved and all fifteen current entities remain available after reconfigure.
The original test bridge is stopped. Only the Mega candidate controls the devices.

With library 0.1.0-dev.3, fresh Mega authentication, five-device discovery, cached
snapshots and JPEG viewing on all four cameras passed. All four STOPs were
acknowledged and no streams remained. HA verified the exact 48-clip baseline,
all camera filters (including empty results), calendar dates, thumbnails, native
H.264/AAC and H.265/AAC playback, H.264 conversion, seeking, HTTP ranges, closing,
background expiration and cancellation. The available September days had 28–95
clips; no day above 100 was observed in that month.

Real doorbell and person events reached HA, with matching event entities and no
duplicate event IDs delivered. Samples were unknown or unidentified persons;
no recognized name was supplied. Non-person motion detection is disabled in the
observed device settings; these settings were not changed.

The cancellation/reconnect probe exposed a reused-protocol timer defect. A late
packet could arm a media timeout after a cancelled stream became idle; resetting
protocol state lost that timer, allowing it to stop a subsequent live stream.
A failing regression test reproduced the unwanted STOP on the later channel.
Version 0.1.0-dev.4 cancels old media timers before replacing their state.

Subsequent fault testing found a socket leak in the reused device-END handler:
it replaced the UDP socket without closing the previous descriptor. Three UDP
handles remained after library shutdown. Versions through 0.1.0-dev.7 close the
actual socket, serialize concurrent cleanup requests and establish a fresh
endpoint after confirmed STOP recovery. Idle process shutdown now exits normally.

A separate startup fault was measured precisely: after network loss the device
acknowledged START and delivered its first valid video packet after 6.6 seconds.
The inherited five-second media-stall timer had already discarded the pending
stream, while the public operation was still waiting. Version 0.1.0-dev.8 gives
initial media the same bounded twenty-second startup window as the public
operation and preserves the five-second timeout once media arrives. Each defect
has a failing-then-passing regression test. The complete VM feature and fault revalidation passed with library 0.1.0-dev.8.
The agreed overnight observation passed on 2026-09-10; see the review below.

The bridge also reconnects an idle, disconnected station without starting a
camera, while deferring that reconnect during viewer ownership and recovery.

## Clean observation and baseline comparison

The uninstrumented candidate began continuous observation on 2026-09-09 at
19:34:27 UTC. The owner revised the review time to 2026-09-10 at 07:00 UTC,
09:00 Europe/Amsterdam. That is about 11 hours 26 minutes of observation, not
a completed 24-hour test. The full sample and event history must be reviewed;
reaching that time alone is not a pass. The candidate has no fault-injection
bootstrap and the original test and production bridges are stopped.

Clean Mega startup on the test VM took 13,437 ms. A separate bounded run of the
original production bridge took 15,073 ms and had no additional stream starts
over 130 seconds idle. The candidate was stopped during that comparison, and
production was stopped again before observation began. Both runs discovered
four cameras and one station, connected push and recovered fifteen HA entities.
The measurements use different hosts and are approximate comparisons, not a
controlled speed benchmark. Battery-life effects remain unproven.

The overnight review covered approximately 11 hours 26 minutes. HA recorder
showed that all fifteen entities recovered after the first 53 seconds and had
no further unavailable transition. All eighteen unique detections reached HA,
including three with recognized names. Thirty-six duplicate transport messages
were suppressed. There were no stream starts, recording downloads, recoveries
or candidate fault-log entries; the container had not restarted.

The auxiliary observer used a 45-minute refresh interval for HA access tokens
that expired after 30 minutes, causing 213 failed HTTP samples. This was a test
observer defect, confirmed from token lifetime and matching failure periods.
The independent HA recorder and bridge counters covered the measurement gaps.
The observer now renews after 20 minutes. This evidence does not establish a
full 24-hour reliability result or improved battery life.

## Production acceptance, 2026-09-10

Fresh production Mega authentication succeeded with a separate session, the
existing bridge ID and credentials, and no imported legacy session or inventory.
The old bridge remained stopped and the VM controller exited cleanly first.
All fifteen HA identities were preserved through the supported reconfigure flow.

An initial audio test found an inactive audio track on one T8160. Bounded packet
timing probes measured first AAC packets as late as 610 ms after video, close
to the inherited 650 ms cutoff. A delayed-audio regression reproduced the false
no-audio decision. The default discovery window is now three seconds, with a
separate regression ensuring video-only streams still start within that bound.
Normal streams start as soon as both media types arrive.

The clean corrected candidate passed complete production acceptance: all four
snapshots and WebRTC video/audio, matching recording history, native H.264/H.265
and H.264 compatibility playback, seeking/ranges, viewer cleanup, a 138-record
day with all camera filters, and Guard Mode confirmed and restored to Away.
HA configuration checks passed. There was one controlling bridge and zero
remaining active/quarantined streams. Original configuration, credentials,
legacy session, identities and startup settings were backed up for rollback.
