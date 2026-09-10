# Compatibility and limitations

Baseline acceptance for version 0.1.0, 2026-09-10. Feature tests and the agreed overnight observation
passed on the isolated HA VM. The production HA migration and feature acceptance
also passed, with the same fifteen entity identities and one controlling bridge.

| Hardware         | Firmware observed | Quantity |
| ---------------- | ----------------- | -------- |
| HomeBase 3 T8030 | 3.8.6.0           | 1        |
| T8160 camera     | 3.4.3.0           | 3        |
| T8213 doorbell   | 0.2.1.8           | 1        |

## S220 discovery, 0.1.1

Discovery now includes both cameras sold as S220 when paired with T8030:

| Camera                        | Model | Protocol device type | Validation                                |
| ----------------------------- | ----- | -------------------- | ----------------------------------------- |
| eufyCam S220 / eufyCam 2C Pro | T8142 | 15                   | Automated only. Hardware pending          |
| SoloCam S220                  | T8134 | 63                   | Partial reporter results. Live view fails |

Eufy's [camera comparison](https://support.nz.eufy.com/support/solutions/articles/154000241616-differences-between-all-add-on-eufycams)
identifies the 2C Pro as T8142. Its [SoloCam S220 documentation](https://support.nz.eufy.com/support/solutions/articles/154000242066-introducing-eufy-s220-solocam)
identifies T8134. S220 alone does not identify the reporter's camera.

The released 0.1.0 model filter silently excluded both. Version 0.1.1 retains
unknown-model exclusion and requires a discovered T8030 parent. The existing
protocol selects different livestream commands for these two device types.
Standalone SoloCam connections remain unsupported.

Before claiming hardware support, record backend, integration/bridge versions,
model and camera/HomeBase firmware. Confirm the bridge account can see the camera
in the Eufy app. With one controlling bridge, verify discovery after restart,
battery updates, stored snapshots, live video/audio and confirmed stop, recording
list/playback and cancellation, and one real motion event without duplicates.
Record pass/fail and redacted errors. No credentials or footage are needed.

The [T8134 reporter update from 2026-09-10](https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5619177924)
reports discovery, stored snapshots, battery, person events and recording
video/audio working after reinstallation. Live view fails. The reporter also
describes failed session recovery after an unspecified settings change. The
requested event idle-state behavior is an open semantics question. These are
partial reporter observations, not full hardware acceptance. Exact installed
versions, stream stop/reopen and recovery checks still need confirmation.

At the programme handover, both the [bridge manifest](https://github.com/keesmod/ha-eufy-cam/blob/5e4e82715e76667e6026bd9d7f5f27758e832c2d/bridge/package.json)
and [HA app manifest](https://github.com/keesmod/ha-eufy-cam/blob/5e4e82715e76667e6026bd9d7f5f27758e832c2d/ha_app/package.json)
pin released client 0.1.1. This records the repository dependency, not the current
state of every deployed bridge. Installing or editing this library alone does
not upgrade a bridge. Keep the previous package and lockfile for rollback, and
publish future client updates through the normal bridge release process.

## Verified on the test HA installation

The original production and test bridges were stopped. These checks used one
Mega controller, with the identified legacy Eufy cloud hosts blocked. The
candidate uses library 0.1.0-dev.8 and preserves the existing HA integration.

Production revalidation used version 0.1.0 with the subsequent audio-discovery
timing fix: all four snapshots, all four WebRTC video/audio streams, native and
converted recordings, seeking, closing/background/cancellation, complete
138-record history, camera filters and observed Guard Mode all passed. Guard
Mode was restored to Away. HA configuration checks passed; no active or
quarantined streams remained. The overnight idle result predates this
active-stream timing change; it was not repeated as a new 24-hour test.

- Fresh Mega authentication and discovery of all five devices, without importing
  legacy sessions or inventory. Persistent-session restart and controlled expiry
  recovery passed; renewal preserved client identity and obtained a new token.
- All four snapshots, without starting live video. These are existing cover
  images, not newly captured photos.
- Live JPEG playback on all four cameras. HA WebRTC decoded both video and audio
  on all four, followed by confirmed device STOP and zero remaining sessions.
  The isolated 4K test receiver needed a larger UDP receive buffer, as did the
  original bridge in preliminary comparison tests.
- Closing, background lease expiry, cancellation of an issued start and a
  recording download, and a seventeen-second simulated device-network outage.
  The first new live view after recovery delivered frames. Push reconnection
  took approximately five seconds. Fault-injection flags were removed.
- Shutdown during live HA viewing terminated the viewer, received device STOP
  confirmation, exited normally and recovered on restart.
- The same fifteen HA entity identities remain present. HA configuration checks
  passed and availability recovered after reconfiguration and restart.
- Real doorbell and person detections reached HA event entities without duplicate
  event IDs. Overnight, HA recorded eighteen unique detections: fifteen person
  events and three pet events. Three included recognized names. The bridge
  suppressed thirty-six duplicate transport messages; HA received all eighteen
  unique events. Name forwarding also has protocol and adapter tests.
  Non-person motion detection was disabled in the observed camera settings;
  those settings were preserved.
- The 2026-09-08 recording history exactly matched the original bridge: 48 camera
  clips from 50 HomeBase rows. Calendar dates, all camera filters including empty
  results, and stored thumbnails passed through HA.
- A real day with 138 clips, 2026-08-23, returned complete history. All four camera
  filters matched the combined list. The library expands the HomeBase query
  limit and rejects capped, changed or otherwise unconfirmed history.
- Native H.264/AAC and H.265/AAC recordings, H.264 compatibility conversion,
  decoding, seeking, authenticated playback, HTTP 206 ranges and deletion.
  Range requests caused no additional HomeBase download.
- Guard Mode changed through HA, was confirmed by fresh P2P state and was restored
  to the freshly observed original mode, Away (0). Invalid input was rejected.
  Rejected and unconfirmed device responses never cause automatic command retries.

## Connection and operating limits

The tested connection supplies LAN-derived command credentials explicitly,
matching the production bridge's observed encryption mode. It does not fetch
DSK/cipher values from legacy cloud APIs or downgrade after a cipher failure.
Host networking reaches the HomeBase; Docker bridge discovery did not. Routed
LAN/VLAN layouts, remote P2P relay operation and stronger command encryption are
not claimed.

Initial live media has a twenty-second deadline. Once media arrives, a five-second
stall timeout remains active. A stream starts as soon as video and audio are
identified, or after a three-second audio-discovery window for video-only media.
Lost connections require confirmed STOP recovery
before the bridge admits a new viewer. Local EOF or a command-send result alone
is not treated as device-stop or download-completion confirmation.

HomeBase calendar dates describe presence across the station, not per-camera
counts. Recording handles expire; complete history is bounded at 10,000 HomeBase
rows and fails explicitly at that limit. Downloads are bounded to 32 MiB. Codec
and audio availability depend on device settings and the existing HA player.
JPEG playback, including the macOS app compatibility route, has no audio.

Battery-life improvements remain unproven. Stream counters and a short stable
battery reading cannot establish battery consumption. Clean Mega startup on the
test VM took 13.4 seconds; the original bridge on production took 15.1 seconds
and had no additional stream starts in a 130-second idle comparison. The hosts
differ, so these measurements do not establish a speed improvement. The clean
observation covered 2026-09-09 at 19:34:27 UTC through 2026-09-10 at 07:00 UTC,
about 11 hours 26 minutes. The candidate issued no stream starts, recoveries or
downloads. HA recorder confirmed continuous availability after the initial
53-second integration refresh. A separate observer's HA token expired before
its renewal, leaving 213 polling gaps; HA recorder and bridge counters supplied
independent evidence for those intervals. The observer renewal was corrected.
This shortened window does not establish 24-hour reliability.

Other HomeBases, standalone cameras, locks and the wider Eufy ecosystem are
outside version 0.1.0's target. Eufy Mega authentication and Google push
infrastructure remain external dependencies. No service or FFmpeg conversion is
included in the library.
