# eufyCam software evidence

Story [#19](https://github.com/keesmod/eufy-mega-client/issues/19) adds software
coverage in unreleased 0.6.0. The independently authored
[regressions](../test/eufycam.test.mjs) exercise the actual private `Camera` factory,
state adapter and event route. They do not establish physical support.

## Exact scope

| Model | Protocol type | Power   | Discovery | Battery        | Availability  | Motion/person  |
| ----- | ------------- | ------- | --------- | -------------- | ------------- | -------------- |
| T8111 | 1             | Battery | Software  | Observed only  | Unknown       | Software on H3 |
| T8112 | 4             | Battery | Software  | Observed only  | Unknown       | Software on H3 |
| T8113 | 8             | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8114 | 9             | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8140 | 14            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8142 | 15            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8160 | 19            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8161 | 23            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8600 | 24            | Wired   | Software  | Not applicable | Observed only | Software on H3 |
| T8162 | 26            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8144 | 49            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8172 | 89            | Battery | Software  | Observed only  | Observed only | Software on H3 |

Model/type associations come from the pinned, attributed catalogue and primary
product sources in [MODEL_MATRIX.md](MODEL_MATRIX.md). Fixtures use synthetic
firmware 1.2.3, not firmware acceptance evidence. H3 means an admitted T8030/type
18 inventory owner with valid local connection credentials. No additional
HomeBase or connection profile is enabled. Camera serial, parent serial and
channel remain the actual inventory values. The existing SDK adds HomeBase event
properties for its T8030 serial profile. Unsupported properties remain unavailable.

T8142R and other unresolved suffixes are not aliases. Unknown model/type pairs
report `unsupported_device`. Unsupported parents retain `unsupported_station`.
The same inventory can retain usable cameras from another family. A malformed
camera initialization reports `device_initialization_failed` without a protocol
payload. Older-owner protocols remain in #35 and standalone transport in #36.

## State contract

`listDevices()` and `discoverDevices()` include validated cloud battery and status
observations. `getDeviceState(id)` initializes the private adapter as needed and
returns the latest available device observations without opening a P2P connection.
The existing device update event carries the same fields.

`firmware` remains the reported nonempty `main_sw_version` or null. Battery is an
observed integer from 0 through 100, only where the model's property table has a
battery property. Missing values, malformed strings, booleans and out-of-range
values are null. E330 has no battery property. A supplied battery field cannot
make it a battery camera.

`availability` is an additive optional property in the public `Device` type,
returned as `online`, `offline`, `disabled` or null. It uses the existing
`CMD_GET_DEV_STATUS` property only where the model table defines it. Status 1 is
online, 2 is manually disabled, and 0/3/4/5 are offline. Missing or unknown values
are null. T8111/T8112 have no mapped status property and remain null. A HomeBase
connection, sleeping radio, push connection or successful command cannot establish
camera availability. The value is the last report, not a fresh reachability probe.

P2P runtime battery updates require the actual owner and channel and a valid
percentage. Raw device state updates require the actual owner. A changed device
relationship destroys the old camera and its observations. Existing SDK source
priority remains in place, so a lower-priority cloud refresh does not overwrite
a P2P observation. This story adds no freshness guarantee or periodic polling.

## Event contract and unsupported features

Only true SDK detections and model-supported properties enter the event route.
An eufyCam has no ring property. It cannot emit a ring, even if a push carries 3103. Existing battery-doorbell ring handling remains available. Motion/person
handling, person identity enrichment, idle-reset suppression and cross-transport
settling/replay suppression keep the existing `Detections` semantics. Unknown
notification codes retain the existing generic notification/SDK decode route.

Push routing requires the actual camera's admitted HomeBase. Wrong-owner pushes,
unsupported cameras and initialization failures cannot enter detection delivery.
HomeBase-only push messages still reach its state processor. They do not become
camera detections. The software tests include two distinct doorbell rings, one
person seen through two transports, replay suppression and invalid owner input.

The 0.6.0 discovery slice rejected newly admitted model media. The 0.7.0
profile below supersedes that guard only for its exact tuples and owner branch.
Factory classification remains separate from media evidence. Existing T8160,
T8142, T8134 and T8213 routes are preserved. No settings or non-camera controls
are added.

## Remaining obligations

- [#20](https://github.com/keesmod/eufy-mega-client/issues/20) delivers the software
  media profile below. Additional owner/encryption profiles remain outside it.
- [#55](https://github.com/keesmod/eufy-mega-client/issues/55), E2 and E6 retain
  model/firmware/topology-specific hardware acceptance, including discovery,
  observed state, real events, media and recovery. Fixture success adds no H cells.
- [Camera #19](https://github.com/keesmod/ha-eufy-cam/issues/19) owns HA capability
  presentation. Existing HA identifiers and public client methods are preserved.
- T8111/T8112 availability mapping remains unverified within E2/#55. Do not
  substitute a battery or HomeBase connection for that missing observation.

No publication, deployment or physical device operation is required for #19.
For package rollback, retain the preceding version and private session store.
There is no store migration. Read the exact profile below before claiming
expanded functionality.

## H3 core media, 0.7.0

[#20](https://github.com/keesmod/eufy-mega-client/issues/20) extends the existing
local-only T8030/type 18 transport with explicit LAN-derived command credentials.
The [Ready scope](https://github.com/keesmod/eufy-mega-client/issues/20#issuecomment-5630826309)
and its [command correction](https://github.com/keesmod/eufy-mega-client/issues/20#issuecomment-5630862712)
precede acceptance. Exact command evidence comes from the repository's attributed
MIT camera adapter at `b5e030b0bcf954678a877a666f6bc862ad588f4e`, especially
`Station.startLivestream`, `stopLivestream`, `startDownload`, `cancelDownload`,
`databaseQueryLatestInfo`, `downloadImage`, `databaseQueryByDate` and
`databaseCountByDate`. No vendor wire implementation changes in this story.

The additional model gate requires the exact pairs below, a T8030/type 18 owner
whose serial follows the existing T8030 branch, and a four-part numeric owner
firmware at or above 2.0.9.7. This is the existing payload branch threshold,
not a firmware-support claim. Fixtures use owner firmware 3.8.6.0 and camera
firmware 1.2.3. Unknown, malformed and earlier owner versions retain
`EufyError` code `camera_media_unverified`. Existing baseline model behavior is
preserved. Command credentials, connections and media stay with the actual owner.

| Model/type | Live command branch       | Stored snapshot | Live video/audio + stop | Recordings + cancel |
| ---------- | ------------------------- | --------------- | ----------------------- | ------------------- |
| T8111/1    | Generic payload           | Software        | Software                | Software            |
| T8112/4    | Generic payload           | Software        | Software                | Software            |
| T8113/8    | Generic payload           | Software        | Software                | Software            |
| T8114/9    | Generic payload           | Software        | Software                | Software            |
| T8140/14   | Generic payload           | Software        | Software                | Software            |
| T8142/15   | Generic payload, existing | Software        | Software                | Software            |
| T8160/19   | Generic payload, existing | Software        | Software                | Software            |
| T8161/23   | Generic payload           | Software        | Software                | Software            |
| T8600/24   | Professional payload      | Software        | Software                | Software            |
| T8162/26   | Generic payload           | Software        | Software                | Software            |
| T8144/49   | Generic payload           | Software        | Software                | Software            |
| T8172/89   | Outdoor pan/tilt envelope | Software        | Software                | Software            |

Generic live commands use `CMD_SET_PAYLOAD` containing
`CMD_START_REALTIME_MEDIA`, `ClientOS`, public `key` and `streamtype` 1/2 for
H.264/H.265. T8600 selects `isCameraProfessional247`, adding `camera_type=0`
and `entrytype=0`. T8172/type 89 selects the earlier
`isOutdoorPanAndTiltCamera` branch. It uses `CMD_DOORBELL_SET_PAYLOAD` with
`commandType=1000`, `accountId`, `camera_type=0`, `entrytype=0`, public
`encryptkey` and `streamtype` 0/1. This does not expose PTZ controls.
All commands retain the camera channel. The full envelopes and both codec
values are asserted independently for every tuple in
[eufycam-media.test.mjs](../test/eufycam-media.test.mjs).

Snapshots query the HomeBase's latest database covers and retrieve
`CMD_DATABASE_IMAGE`. They do not take a fresh photograph or start live media.
Missing covers keep the bounded timeout. Unsupported profiles cannot download
covers implicitly through latest-info events or retrieve recording thumbnails.
Recording calendar/list uses `CMD_DATABASE_COUNT_BY_DATE` and
`CMD_DATABASE_QUERY_BY_DATE`. List results are complete station metadata,
including known cameras whose media is unverified. Camera-bound thumbnail and
download operations check admission before opening their media connection.
Downloads use the existing H3 payload with `CMD_DOWNLOAD_VIDEO`, `filepath` and
public download key. No cipher or legacy-cloud fallback is added. The upstream
H3 TODO in vendor source is historical, not a new hardware finding.

Live stop requires a successful matching `CMD_STOP_REALTIME_MEDIA` result and
local stop on the same owner/channel. A regression fixes wrong-channel local
stop events incorrectly satisfying that condition. Cancelled starts retain
ownership until their bounded STOP outcome. Recording cancel requires matching
`CMD_DOWNLOAD_CANCEL`. Local EOF alone cannot complete a download. Recording
cleanup now removes pending source EOF listeners even when cancelled sources
never finish, and duplicate finish events do not add listeners.
The existing eight-second live cleanup and five-second download cancel bounds,
32 MiB recording limit, completion checks and no-command-replay policy remain.

The fixtures forward distinct synthetic video/audio bytes, not playable footage.
They exercise snapshots, filtered complete history, calendars, thumbnails,
download completion, cancellation, wrong channels, missing/rejected ACKs,
timeouts, late ACKs and a failing owner alongside a second active owner.
[Family lifecycle fixtures](../test/family-lifecycle.test.mjs) additionally run
each newly admitted eufyCam through duplicate events and cancelled-start cleanup.
Software success does not establish decoded or audible hardware playback.

No new H evidence is assigned. The dated T8160/T8030 baseline remains in
[COMPATIBILITY.md](COMPATIBILITY.md). #55 retains physical acceptance for each
model/firmware/topology, including unavailable hardware, real video/audio,
recordings, events and restart recovery. #35 retains older owners and #36
standalone protocols. E2/E6 remain open. Release/HA integration acceptance is
separate from this software story. Version 0.7.0 is unreleased and requires no
session migration. Retain the prior package and private store for rollback.
