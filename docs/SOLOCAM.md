# SoloCam software evidence

Story [#21](https://github.com/keesmod/eufy-mega-client/issues/21) adds discovery,
observed state and event routing in unreleased 0.11.0. The
[per-model regressions](../test/solocam.test.mjs) exercise the actual private
SoloCamera adapter. They establish software behavior, not physical support.

## Model and connection scope

| Model | Protocol type | Product            |
| ----- | ------------- | ------------------ |
| T8130 | 32            | SoloCam E20        |
| T8131 | 33            | SoloCam E40        |
| T8170 | 48            | SoloCam S340       |
| T8122 | 60            | SoloCam L20        |
| T8123 | 61            | SoloCam L40        |
| T8124 | 62            | SoloCam S40 / S230 |
| T8134 | 63            | SoloCam S220       |
| T8B00 | 64            | SoloCam C210       |
| T8171 | 88            | SoloCam E30        |
| T8173 | 98            | SoloCam E42        |

Each exact model/type pair uses its actual T8030/type 18 inventory parent and
camera channel. No new HomeBase protocol is added. The pinned
[model matrix](MODEL_MATRIX.md) links identity and topology sources. The existing
MIT-attributed `SoloCamera` implementation and `DeviceProperties` come from the
vendor source at client commit `1c4d8e381aa33ce8ab8585d8e9a7fc62e9694e38`, with
[upstream attribution](../NOTICE.md). No vendor protocol code changes.

Adapter selection uses our exact family registry. The broader vendor
`isSoloCameras` predicate also includes eufyCam S4 and LTE variants, so using it
for this change would alter unrelated family behavior. eufyCam and battery
doorbell adapters are preserved.

An empty or self parent retains a camera descriptor with itself as connection
owner and `standalone_transport_unverified`. It creates no HomeBase entity,
station connection or event/media route. Other owners remain
`unsupported_station`. Unknown model/type pairs and unresolved T8124V/R suffixes
remain `unsupported_device`. An initialization failure remains local to that
camera and reports `device_initialization_failed`.

## State and events

All ten H3 profiles expose firmware when provided and battery/availability only
from validated observations. Missing or malformed values remain unknown. Zero
battery is an observed value, not a missing value. Device status does not come
from the bridge's connection flag. Local updates must match the owning HomeBase
and camera channel. Changing the owner replaces the private adapter and clears
its old observations and listeners while preserving the camera's public ID.

Motion and person events require the adapter's corresponding properties. A
SoloCam cannot emit a doorbell ring merely because an incoming event uses a ring
code. Pushes must name the camera's actual owner. Native SoloCam payloads and HB3
companions use the existing event decoder and duplicate suppression, preserving
person names when supplied. False property resets do not create detections.

Tests cover all ten actual adapters, public discovery/state, both parent forms
for standalone descriptors, wrong owners/channels, malformed observations,
per-property event rejection, native push state updates, local/push/HB3 event
correlation, replay suppression and coexistence with eufyCam S4 and doorbells.
Existing S220 command and shared family lifecycle tests remain required.
Synthetic firmware and events are test inputs, not observed hardware results.

## Media and remaining work

T8134 keeps its existing snapshot, live and recording admission, with unchanged
[S220 command regression coverage](../test/s220.test.mjs). Version 0.11.0 kept
media unverified for the other nine models. The [0.12.0 H3 media profile](#h3-core-media-0120)
below supersedes that restriction for its exact connection profile. Selecting
SoloCamera alone does not enable media, settings or physical controls.

- [#36](https://github.com/keesmod/eufy-mega-client/issues/36) owns standalone
  transport and [#35](https://github.com/keesmod/eufy-mega-client/issues/35) other
  HomeBase owners. Candidate and unresolved variants remain in the matrix and
  those existing family/validation obligations.
- [#56](https://github.com/keesmod/eufy-mega-client/issues/56) owns scoped hardware
  confirmation. [Camera #10](https://github.com/keesmod/ha-eufy-cam/issues/10)
  retains the T8134 reporter investigation, missing audio, requested retest and
  recovery confirmation. Earlier successful discovery/state/events and recordings
  remain dated partial evidence. This software change does not resolve that issue.

Use the [community process](COMMUNITY_VALIDATION.md) for voluntary results.
Missing hardware evidence alone does not block ordinary upgrades. No hardware
trial, consumer upgrade or release publication is performed for #21.
Version 0.11.0 requires no session-store migration. Retain the preceding package,
lockfile and private store for rollback.

## H3 core media, 0.12.0

Story [#22](https://github.com/keesmod/eufy-mega-client/issues/22) enables the
existing media operations for the nine additional exact SoloCam pairs above.
T8134 retains its existing admission. No new adapter or vendor implementation is
introduced. The command source is the attributed `vendor/src/http/station.ts`
at client commit `58f1ca2183bfcb7e9e205b511b924dd3f52014ab`, specifically
`startLivestream`, `stopLivestream`, `startDownload`, `cancelDownload`,
`databaseQueryLatestInfo`, `downloadImage`, `databaseQueryByDate` and
`databaseCountByDate`.

### Selected connection profile

The added models use the existing additional-H3 admission: exact model/type,
actual matching T8030/type 18 parent with a T8030 serial prefix, local LAN-derived
credentials and four-part numeric owner firmware at or above 2.0.9.7. This reuses
the conservative profile already used for other added H3 cameras. It is not a
newly observed SoloCam firmware minimum. The two SoloCam live envelopes below
have no firmware branch of their own in the attributed source.

Unknown, malformed and earlier owner firmware retain `camera_media_unverified`
for these nine added profiles. That restriction is not added to T8134. Tests use
synthetic camera firmware 1.2.3 and owner 3.8.6.0, with a separate admission test
at 2.0.9.7. They are software inputs, not hardware acceptance evidence.
Standalone and other-owner relationships retain their existing typed reasons.
No cloud DSK lookup, legacy authentication fallback or guessed key is added.

### Existing command paths

| Models                                   | Live envelope    | Stored snapshot | Live video/audio + stop | Recordings + cancel |
| ---------------------------------------- | ---------------- | --------------- | ----------------------- | ------------------- |
| T8130, T8131, T8122, T8123, T8124, T8B00 | SoloCam          | Software        | Software                | Software            |
| T8170, T8171, T8173                      | Pan/tilt camera  | Software        | Software                | Software            |
| T8134                                    | Existing SoloCam | Regression      | Regression              | Regression          |

Both live envelopes use `CMD_DOORBELL_SET_PAYLOAD` with `commandType=1000`,
`accountId`, public `encryptkey` and `streamtype` 0/1 for H.264/H.265. The
T8170/T8171/T8173 branch also sends `camera_type=0` and `entrytype=0`. Tests assert
both full envelopes and the actual channel for every model and codec. These
names describe existing wire formats, not new adapters or permission to move a
pan/tilt camera.

Snapshots query the latest HomeBase cover and download it through
`CMD_DATABASE_IMAGE`. They do not wake the camera for a fresh image. Recording
metadata uses `CMD_DATABASE_COUNT_BY_DATE` and `CMD_DATABASE_QUERY_BY_DATE`.
Thumbnail/download admission is checked for the exact camera before opening its
media connection. Downloads reuse H3 `CMD_SET_PAYLOAD` with `CMD_DOWNLOAD_VIDEO`,
file path and public download key. The historical upstream H3 TODO remains in
source. It is not a new measured failure or proof that every SoloCam supports
recordings. Existing T8134 reporter video/audio results remain dated evidence.

Live stop uses `CMD_STOP_REALTIME_MEDIA` and requires matching acknowledgement
and local stop on the same channel. Recording cancellation uses
`CMD_DOWNLOAD_CANCEL`. Local EOF or a finished transport alone cannot establish
complete recording delivery. Existing eight-second live cleanup, five-second
recording cancellation, byte/duration limits and no automatic replay remain.

### Software validation and limits

The independently authored [SoloCam fixtures](../test/fixtures/solocam-media.mjs)
extend the existing [H3 media tests](../test/eufycam-media.test.mjs),
[capability tests](../test/capabilities.test.mjs) and
[family lifecycle tests](../test/family-lifecycle.test.mjs). They cover all ten
models with exact commands, synthetic snapshot and separate video/audio bytes,
complete metadata, thumbnails, recording completion/cancellation, rejected or
missing acknowledgements, late events, repeated cleanup and replay suppression.
A failed stream on one HomeBase must leave a simultaneous second owner's audio
stream working. All nine added profiles also reject invalid model/type, owner
and firmware before starting media, and retain their existing standalone block.

The nine stored-snapshot regressions failed with `camera_media_unverified` on
the baseline and pass with admission added. Existing T8134 behavior receives the
same shared checks, including a regression that preserves its firmware admission.
These synthetic bytes do not prove decodable or audible media on real hardware.
Camera #10's audio, live-route and recovery questions remain open. #56 retains
exact hardware confirmation, #36 standalone transport and #35 other owners.

No physical camera test, consumer upgrade or product publication is performed
for this software story. Version 0.12.0 needs no session-store migration. Retain
the preceding package, lockfile and private store for rollback. Community results
remain voluntary and are recorded through the existing process.
