# Battery doorbell software evidence

Story [#25](https://github.com/keesmod/eufy-mega-client/issues/25) adds the following
bounded discovery and state/event slice in 0.8.0.

| Model/type | Adapter               | Discovery                   | Battery/availability | Motion/person/ring | Media                    |
| ---------- | --------------------- | --------------------------- | -------------------- | ------------------ | ------------------------ |
| T8213/91   | BatteryDoorbellCamera | Existing, regression tested | Observed only        | Software           | Existing route preserved |
| T8214/94   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |
| T8224/95   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |
| T8223/96   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |
| T8224/96   | BatteryDoorbellCamera | Software, reported tuple    | Observed only        | Software           | Unverified               |
| T8210/7    | BatteryDoorbellCamera | Software, public evidence   | Observed only        | Software           | Unverified               |
| T8210C/7   | BatteryDoorbellCamera | Software, public evidence   | Observed only        | Software           | Unverified               |

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

Unknown tuples and suffixes return `unsupported_device`. T8212 type 7 and
T8220/T8221/T8222 type 16 remain candidate associations. They need sanitized exact
model/type inventory evidence before admission. 0.30.1 admits T8210/7 and
T8210C/7 on public evidence, as described
[below](#public-t8210-and-t8210c-type-7-evidence-0301). Unsupported parents remain
`unsupported_station`, and empty/self parents retain `invalid_device_relationship`.
No standalone owner or older HomeBase protocol is enabled. Invalid initialization
is isolated as `device_initialization_failed` without raw protocol data. Other
families continue to work in the same inventory.

- [#26](https://github.com/keesmod/eufy-mega-client/issues/26) selected its own
  exact Ready media profile before implementation. The selected profile is below.
- [#58](https://github.com/keesmod/eufy-mega-client/issues/58) held per-model,
  firmware and topology hardware acceptance, including candidate-pair evidence,
  observed battery, real motion/person/ring events and restart recovery, until it
  closed on 2026-09-11. The [model matrix](MODEL_MATRIX.md) records the evidence
  status and gaps per tuple.
- [#35](https://github.com/keesmod/eufy-mega-client/issues/35) held older owners
  and chime relationships.
  [#36](https://github.com/keesmod/eufy-mega-client/issues/36) held standalone
  authentication and transport. Both closed on 2026-09-16.
  [#143](https://github.com/keesmod/eufy-mega-client/issues/143) and
  [#142](https://github.com/keesmod/eufy-mega-client/issues/142) track the
  older-owner and standalone gaps.
- [Camera #19](https://github.com/keesmod/ha-eufy-cam/issues/19) held HA capability
  presentation until it closed on 2026-09-11. At 0.8.0, E2/E6 and camera
  migration/release acceptance were open.

No hardware or live service is tested for #25. Dated T8213 baseline evidence in
[MODEL_MATRIX.md](MODEL_MATRIX.md) remains dated and unchanged. Software tests do
not add H cells. Version 0.8.0 requires no session-store migration. For rollback,
retain the preceding package and private store. Version 0.8.0 was not published.
This slice first shipped in 0.10.0, published on 2026-09-11.

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
| T8224/96   | Generic payload          | Software        | Software                | Software            |
| T8210/7    | Generic payload          | Software        | Software                | Software            |
| T8210C/7   | Generic payload          | Software        | Software                | Software            |

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
assigned. At 0.9.0, #58 held exact model/firmware/topology snapshots, real live
video and audio, confirmed stop, recordings/playback/cancel, events and restart
recovery, including unavailable models and type 7/16 inventory gaps. #35/#36
held other owners and standalone protocols, and E2/E6 were open. Camera #19
owned capability presentation, and the camera chain still required migration,
release and legacy retirement. Version 0.9.0 was not published. This profile
first shipped in 0.10.0 and needs no store migration. Retain the preceding
package and private store for rollback. No live device was tested for this
software story.

## Reported C30 type 96, 0.18.1

A bounded discovery report on
[ha-eufy-cam#40](https://github.com/keesmod/ha-eufy-cam/issues/40#issuecomment-5801839459)
shows a Video Doorbell C30 received as `device_model=T8224` with `device_type=96`,
camera firmware 3.4.9.2, under a T8030 owner on firmware 3.8.5.2. The pinned
catalogue assigns 96 to the C31 (`T8223`), so 0.18.0 and earlier reject the pair
as `unsupported_device`. This is reported, not independently reproduced, and the
upstream catalogue and its C30/C31 issue contain no other observation of the pair.

[#183](https://github.com/keesmod/eufy-mega-client/issues/183) admits exactly
T8224/96 through `reportedTypes` on the T8224 profile, with the same H3 topology
and media policy as T8224/95. Every other model keeps one exact type, and T8224
with any other type, including 97, stays `unsupported_device`. The vendored
adapter selects its behavior from the received type, so T8224/96 follows the C31
branches. The C30 and C31 property metadata and command lists in the pinned
catalogue are identical, both select `BatteryDoorbellCamera`, and both use the
generic C30/C31 live payload. The only type-specific difference is a motion
sensitivity setter this client does not expose.

The per-model [adapter tests](../test/battery-doorbell.test.mjs), the
[shared media fixtures](../test/fixtures/battery-doorbell-media.mjs) and the
[profile tests](../test/device-profiles.test.mjs) cover T8224/96 like the other
rows. Discovery, state, events and media of the reported C30 on hardware remain
unverified until the reporter tests a release with this change.

## Public T8210 and T8210C type 7 evidence, 0.30.1

[ha-eufy-cam#198](https://github.com/keesmod/ha-eufy-cam/issues/198) reports a
Video Doorbell T8210 under a HomeBase 3 (T8030) that the integration does not
list. It works in the Eufy app and in another integration. The report gives no
received model, type or firmware. 0.30.0 has no profile for this doorbell, so it
rejects a security row with either model code as `unsupported_device`.

The doorbell arrives with more than one model code. 0.30.1 admits exactly
T8210/7 and T8210C/7 with the H3 topology and media policy of T8224/95. The
evidence is public and comes from other clients, as for T8410C in 0.29.2:

- Eufy's [HomeBase 3 compatibility page](https://service.eufy.com/article-description/S380-HomeBase-HomeBase-3-Compatibility)
  lists the T8210 Video Doorbell 2K as compatible.
- A [2023 inventory](https://github.com/fuatakgun/eufy_security/issues/958#issuecomment-1799501814)
  shows model T8210 with type 7 and firmware 5.7.5 under a T8030.
- A [public Mega inventory](https://github.com/mscodemonkey/eufy-mega-security/issues/134)
  shows `model="T8210" device_type=7 category=eufy_security` with a parent,
  under a HomeBase 2.
- Public diagnostics on
  [alaraun/homeassistant-eufy-home-security#107](https://github.com/alaraun/homeassistant-eufy-home-security/issues/107)
  show a battery doorbell whose received cloud `device_model` is `T8210C`, with
  type 7 and firmware 3.0.8.6, under a HomeBase 2. That client documents the
  field as the inventory entry's own `device_model`, the field this client
  matches.
- [bropat/eufy-security-client#763](https://github.com/bropat/eufy-security-client/pull/763)
  tested HomeBase 3 recording downloads on a Video Doorbell S220 (T8210C) with
  firmware 3.0.8.2 under a T8030, and
  [mega-yfue/eufy-sdk#302](https://github.com/mega-yfue/eufy-sdk/issues/302)
  describes a T8210C under a T8030. Neither shows the received model or type.

No source shows a type other than 7 for either code. That the other clients read
the same inventory field as this client is verified only for the
alaraun diagnostics. Which code the #198 row carries is not known. Its owner
calls it T8210, which does not decide it, as for T8410 and T8410C in
[INDOOR.md](INDOOR.md). The bounded `unsupported_device` diagnostic of a
release before 0.30.1 shows the received pair.

The vendored adapter selects the behavior of both codes from type 7. It is
`BatteryDoorbellCamera`, like the other admitted doorbells. Battery
(`CMD_GET_BATTERY`), availability (`CMD_GET_DEV_STATUS`) and the motion, person
and ring properties are the same keys as for types 91, 94, 95 and 96. Under the
H3 media gate type 7 matches no special live branch and sends the generic
`CMD_SET_PAYLOAD` envelope of C30/C31. Stored snapshots, calendar, lists and
downloads use HomeBase station commands. The only type 7 specific items in the
vendored adapter are writable settings this client does not expose and a
keyframe TODO that applies only when a T8210 is its own P2P station, which the
H3 topology excludes. The video codec is read from the stream, as for every
HomeBase camera.

The per-model [adapter tests](../test/battery-doorbell.test.mjs), the
[shared media fixtures](../test/fixtures/battery-doorbell-media.mjs) and the
[profile tests](../test/device-profiles.test.mjs) cover both pairs like the
other rows. T8212/7, other suffixes such as `T8210P` and other types for either
code stay `unsupported_device`. Discovery, state, events and media of either
code on hardware remain unverified until a tester reports a release with this
change.
