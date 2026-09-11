# Wall-light camera software evidence

Story [#31](https://github.com/keesmod/eufy-mega-client/issues/31) adds exact
recognition, observed state and event routing to unreleased 0.12.0. Tests use
synthetic inventories and the actual private protocol classes. They do not
establish physical support.

## Recognition, state and events

| Model | Type  | Product                   | Battery                          | Availability                |
| ----- | ----- | ------------------------- | -------------------------------- | --------------------------- |
| T84A1 | 151   | Wired Wall Light Cam S100 | Unknown, no mapped property      | Unknown, no mapped property |
| T81A0 | 10005 | Solar Wall Light Cam S120 | Validated observation or unknown | Unknown, no mapped property |

The exact pairs come from the [model matrix](MODEL_MATRIX.md). Their firmware is
reported only when supplied. The attributed `DeviceProperties` at client commit
`34863d81eb3bc50dbc095ff537fe156640f7042e` has no `DeviceState` mapping for either
model. A generic status parameter or a connected HomeBase therefore cannot turn
availability into online. T84A1 also has no battery mapping. T81A0 accepts observed
zero and rejects malformed or out-of-range battery values.

The existing `WallLightCam` class is reused because it decodes native motion and
person push messages and updates detection state. These are concrete differences
from generic `Camera`. No new family adapter or vendor protocol is introduced.
The MIT camera source retains its [attribution](../NOTICE.md).

Each camera keeps its actual inventory parent, channel and public identifier.
A T8030/type 18 parent selects the existing station route. An empty or self
parent retains a camera descriptor with `standalone_transport_unverified`,
without creating a HomeBase entity, opening a connection or enabling events.
Other owners return `unsupported_station`. Unknown or mismatched model/type pairs
return `unsupported_device`. Adapter initialization failures remain local to the
camera. Changing an owner removes old listeners and observations.

Only motion/person properties enable their respective detections. Ring codes
cannot produce a ring on these cameras. Native pushes, H3 companion messages,
local detections and replay use existing owner checks and duplicate suppression.
Unknown names stay unknown. Light settings, PTZ, talkback and other controls are
outside these stories.

[Wall-light tests](../test/walllight.test.mjs) cover both exact adapters, public
inventory/state, unsupported variants, bad initialization, wrong owners/channels,
unknown state, observed battery, parent changes, native push state conversion,
event correlation and standalone descriptors alongside other camera families.

## Media and remaining work

Story [#32](https://github.com/keesmod/eufy-mega-client/issues/32) admits only
**T81A0/type 10005 with an actual matching T8030/type 18 inventory parent**.
The owner must have the T8030 serial prefix and the existing additional-H3
four-part numeric firmware admission at or above 2.0.9.7. Credentials remain
LAN-derived. This is a conditional experimental software route, not a claim that
all S120 installations use HomeBase as their command owner. An empty/self parent
never becomes an H3 parent because the product supports HomeBase storage.

The official [compatibility guide][HB-guide] lists S120 with H3. The official
[battery Wall-light connection FAQ][Wall-FAQ] describes connection and a stream
test, requiring the same network, home and account. Neither source provides a
wire protocol or confirms this library on hardware. The FAQ labels a firmware
value as HomeBase 3-2.1.1.9. We have no independent confirmation of that value's
meaning. We do not derive a new firmware requirement from it. The existing
2.0.9.7 software admission boundary remains a library policy, not a measured S120
firmware minimum. Test firmware 1.2.3 for the camera and 3.8.6.0 for its owner are
synthetic branch inputs.

T84A1/type 151 remains `camera_media_unverified` for snapshots, live and recording
media even with an H3 inventory parent. Its matrix evidence establishes H3
storage, with unresolved AI/owner behavior. Storage compatibility alone cannot
establish which device owns commands. T84A1 keeps recognition/state/events from
#31. Its remaining transport/owner and hardware obligations stay under #36 and #61.

### Reused media commands

The attributed source at commit `34863d81eb3bc50dbc095ff537fe156640f7042e` supplies
`Station.startLivestream`, `stopLivestream`, `startDownload`, `cancelDownload`,
`databaseQueryLatestInfo`, `downloadImage`, `databaseQueryByDate` and
`databaseCountByDate`. `Device.isWallLightCam` explicitly includes type 10005,
and its command table declares the existing media operations. Each Station
operation checks the device's actual station serial and command support.
No new vendor code, credential lookup or legacy security-cloud fallback is added.

- Live uses the existing `CMD_DOORBELL_SET_PAYLOAD`, `commandType=1000`,
  `accountId`, public `encryptkey` and `streamtype` 0/1 for H.264/H.265. It does
  not add the pan/tilt branch's `camera_type` or `entrytype` fields.
- Live stop uses `CMD_STOP_REALTIME_MEDIA` on the actual channel. Both a matching
  acknowledgement and local stop are required. Missing or rejected ACK remains
  unconfirmed, with bounded cleanup and connection disposal.
- Stored snapshots query the latest HomeBase cover and use `CMD_DATABASE_IMAGE`.
  These are stored images, not a fresh camera exposure.
- Recording metadata uses `CMD_DATABASE_COUNT_BY_DATE` and
  `CMD_DATABASE_QUERY_BY_DATE`. H3 downloads reuse `CMD_SET_PAYLOAD` with
  `CMD_DOWNLOAD_VIDEO`, file path and public download key. Cancellation uses
  `CMD_DOWNLOAD_CANCEL` and requires acknowledgement. The old upstream H3 TODO
  is preserved. It is neither a new failure observation nor a hardware guarantee.

The [T81A0 fixture](../test/fixtures/walllight-media.mjs) joins the existing
[media](../test/eufycam-media.test.mjs), [capability](../test/capabilities.test.mjs)
and [lifecycle](../test/family-lifecycle.test.mjs) tests. Checks assert full vendor
command envelopes for both codecs, snapshot bytes, separate video/audio bytes,
metadata, thumbnails, completed/cancelled downloads, wrong/missing/rejected ACK,
late events and repeated cleanup. Failure of one owner's live stream must leave
a second owner's audio working. Invalid tuples, owners and firmware reject media
before start. A separate S100 regression checks all blocked media operations.
Synthetic bytes do not prove physically decodable or audible video/audio.

These new T81A0 tests first failed on #31's media-unverified baseline and pass
with its exact additional-H3 admission. The existing shared lifecycle and public
API remain unchanged. Further actual topology evidence can refine admission
without restricting ordinary library upgrades.

[HB-guide]: https://service.eufy.com/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide
[Wall-FAQ]: https://service.eufy.com/article-description/FAQ-About-Wall-Light-Cam-Battery-Connection-to-Homebase3

[#36](https://github.com/keesmod/eufy-mega-client/issues/36) retains standalone
transport and [#35](https://github.com/keesmod/eufy-mega-client/issues/35) other
HomeBase owners. [#61](https://github.com/keesmod/eufy-mega-client/issues/61)
retains hardware validation for exact model, firmware, topology and feature.
These software changes do not close those obligations.

The [community process](COMMUNITY_VALIDATION.md) accepts voluntary results.
Missing hardware evidence alone does not block ordinary upgrades. No live test,
consumer deployment or release publication is performed here. There is no
session-store migration. Keep the preceding package and lockfile for rollback.
