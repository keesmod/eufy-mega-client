# Battery doorbell software evidence

Story [#25](https://github.com/keesmod/eufy-mega-client/issues/25) adds the following
bounded discovery and state/event slice in unreleased 0.8.0.

| Model/type | Adapter               | Discovery                   | Battery/availability | Motion/person/ring | Media                    |
| ---------- | --------------------- | --------------------------- | -------------------- | ------------------ | ------------------------ |
| T8213/91   | BatteryDoorbellCamera | Existing, regression tested | Observed only        | Software           | Existing route preserved |
| T8214/94   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |
| T8224/95   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |
| T8223/96   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |

All rows require the actual admitted T8030/type 18 HomeBase owner. Transport is
the existing local LAN-derived credential path. Model/type associations use the
pinned attributed MIT catalogue and product references in
[MODEL_MATRIX.md](MODEL_MATRIX.md). This is software classification evidence,
not an observed Mega inventory from new hardware. The adapter's type predicates,
`DeviceProperties`, `Device.getPropertiesMetadata`, `DoorbellCamera` and
`BatteryDoorbellCamera` at client commit
`adcd77883d0da2fd48a48889d3a84bf6cce20973` provide the existing software semantics.
No vendor wire implementation changes. The
[synthetic tests](../test/battery-doorbell.test.mjs) use camera firmware 1.2.3 and
owner firmware 3.8.6.0. These values do not establish firmware support.

## State and identity

Discovery and `getDeviceState()` retain the inventory serial, parent serial and
channel. Available nonempty firmware remains the reported value. Missing firmware
is null. Battery uses the model's numeric battery property and accepts only
observed integer percentages from zero through 100. Missing, malformed and
out-of-range values are null. Availability uses observed `CMD_GET_DEV_STATUS`.
1 means online, 2 disabled, and 0/3/4/5 offline. Missing or invalid status is null.
No HomeBase connection or successful command becomes camera availability.

Runtime battery updates require the actual owner and channel. Raw property updates
require the actual owner. Relationship changes remove the prior adapter and its
observations. Existing observation source priority remains unchanged. State reads
do not open a P2P connection and have no new freshness guarantee.

## Events and media boundary

Existing motion/person/ring properties route true detections only. False SDK
resets do not produce actionable events. Pushes must name the actual admitted
owner and a supported property. The current T8030 metadata adds other existing
HomeBase detection properties. Their presence is not a new hardware claim.
Tests exercise property rejection, wrong-owner rejection, SDK/push settling,
cross-transport replay suppression, person identity and two distinct ring events
for every admitted tuple. An eufyCam still cannot ring, as covered by
[eufyCam regressions](../test/eufycam.test.mjs).

Classification does not grant media access. T8214, T8224 and T8223 retain typed
`camera_media_unverified` before camera-bound media operations can connect.
The 0.9.0 profile below supersedes this 0.8.0 guard only for its exact owner branch.
Existing T8213 media and T8160/T8142/T8134 identities remain unchanged. No settings,
PTZ, talkback, non-camera actuation or legacy-cloud fallback is added.

## Unsupported paths and remaining obligations

Unknown tuples and suffixes return `unsupported_device`. T8210/T8212 type 7 and
T8220/T8221/T8222 type 16 remain candidate associations. They need sanitized exact
model/type inventory evidence before admission. Unsupported parents remain
`unsupported_station`, and empty/self parents retain `invalid_device_relationship`.
No standalone owner or older HomeBase protocol is enabled. Invalid initialization
is isolated as `device_initialization_failed` without raw protocol data. Other
families continue to work in the same inventory.

- [#26](https://github.com/keesmod/eufy-mega-client/issues/26) must select its own
  exact Ready media profile before implementation. The selected profile is below.
- [#58](https://github.com/keesmod/eufy-mega-client/issues/58) retains per-model,
  firmware and topology hardware acceptance, including candidate-pair evidence,
  observed battery, real motion/person/ring events and restart recovery.
- [#35](https://github.com/keesmod/eufy-mega-client/issues/35) retains older owners
  and chime relationships. [#36](https://github.com/keesmod/eufy-mega-client/issues/36)
  retains standalone authentication and transport.
- [Camera #19](https://github.com/keesmod/ha-eufy-cam/issues/19) owns HA capability
  presentation. E2/E6 and camera migration/release acceptance remain open.

No hardware or live service is tested for #25. Dated T8213 baseline evidence in
[MODEL_MATRIX.md](MODEL_MATRIX.md) remains dated and unchanged. Software tests do
not add H cells. Version 0.8.0 requires no session-store migration. For rollback,
retain the preceding package and private store. No release is published here.

## H3 core media, 0.9.0

Story [#26](https://github.com/keesmod/eufy-mega-client/issues/26) extends media
admission for the exact three additional tuples below. The
[Ready selection](https://github.com/keesmod/eufy-mega-client/issues/26#issuecomment-5631125846)
records command evidence before implementation. The source is the attributed
MIT adapter at `e968376f176cfb91f1dc4a74d43fe82a40c2d190`, specifically
`Station.startLivestream`, `stopLivestream`, `startDownload`, `cancelDownload`,
`databaseQueryLatestInfo`, `downloadImage`, `databaseQueryByDate` and
`databaseCountByDate`. No vendor wire code changes.

| Model/type | Live command             | Stored snapshot | Live video/audio + stop | Recordings + cancel |
| ---------- | ------------------------ | --------------- | ----------------------- | ------------------- |
| T8213/91   | Existing generic payload | Regression      | Regression              | Regression          |
| T8214/94   | E340 doorbell envelope   | Software        | Software                | Software            |
| T8224/95   | Generic payload          | Software        | Software                | Software            |
| T8223/96   | Generic payload          | Software        | Software                | Software            |

New media requires the actual matching T8030/type 18 parent with a T8030 serial
prefix and a four-part numeric owner firmware at or above 2.0.9.7. Unknown,
malformed and earlier versions retain `camera_media_unverified`. For C30/C31 this
is the existing generic live payload threshold. E340 selects its earlier
`isBatteryDoorbellDualE340` branch on a non-MiniBase owner. The same conservative
minimum bounds this story, without asserting E340 cannot work on older firmware.
Camera firmware 1.2.3 and owner 3.8.6.0 are synthetic inputs, not hardware proof.
T8213 keeps its established firmware behavior. Other owner and transport profiles
remain blocked. LAN-derived command credentials and media stay with the actual
owner. No legacy cloud fallback or new encryption scheme is added.

E340 uses `CMD_DOORBELL_SET_PAYLOAD` with `commandType=1000`, `accountId`,
`camera_type=0`, `entrytype=0`, public `encryptkey` and `streamtype` 0/1 for
H.264/H.265. C30/C31 use `CMD_SET_PAYLOAD` with `CMD_START_REALTIME_MEDIA`,
`ClientOS=Android`, public `key` and `streamtype` 1/2. Both retain the actual
camera channel. Tests assert the full envelopes for both codecs per tuple.

Stored snapshots read latest HomeBase database covers through
`CMD_DATABASE_IMAGE`, without taking a fresh picture or opening live media.
Calendar and list use `CMD_DATABASE_COUNT_BY_DATE` and
`CMD_DATABASE_QUERY_BY_DATE`. Lists remain complete station metadata. Camera-bound
thumbnail and download calls check admission before opening media connections.
H3 download uses `CMD_SET_PAYLOAD`, `CMD_DOWNLOAD_VIDEO`, `filepath` and public
uppercase download key. The historical upstream H3 download TODO is unchanged
and does not create a new hardware finding.

The [shared per-model media tests](../test/eufycam-media.test.mjs) and
[battery doorbell fixtures](../test/fixtures/battery-doorbell-media.mjs) exercise
snapshot bytes, separate synthetic live video/audio bytes, calendar, filtered
complete history, thumbnails, recording completion and cancellation for every
row. Live stop requires successful matching `CMD_STOP_REALTIME_MEDIA` and local
stop on the same owner/channel. Download cancellation requires matching
`CMD_DOWNLOAD_CANCEL`. Local EOF alone cannot complete a recording.
Wrong-channel, missing, rejected and late acknowledgements preserve the existing
failure outcomes. Eight-second live cleanup, five-second download cancellation,
32 MiB recording bounds and no command replay remain unchanged. Each doorbell is
also tested alongside an active second owner so a failed stop cannot close that
owner's audio stream. Family lifecycle tests cover cancelled starts, duplicate
events, replay suppression and bounded cleanup for every new tuple. Existing
model/property-bound ring regressions remain in the discovery suite.

These tests establish software forwarding and lifecycle behavior. Synthetic
bytes do not prove decoded video or audible playback. No new hardware cells are
assigned. #58 retains exact model/firmware/topology snapshots, real live video
and audio, confirmed stop, recordings/playback/cancel, events and restart recovery,
including unavailable models and type 7/16 inventory gaps. #35/#36 retain other
owners and standalone protocols. E2/E6 remain open. Camera #19 owns capability
presentation, with migration, release and legacy retirement still required by
the camera chain. Version 0.9.0 is unreleased and needs no store migration.
Retain the preceding package and private store for rollback. No live device was
tested for this software story.
