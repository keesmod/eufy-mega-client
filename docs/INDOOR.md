# Indoor camera software evidence

Stories [#23](https://github.com/keesmod/eufy-mega-client/issues/23) and
[#24](https://github.com/keesmod/eufy-mega-client/issues/24) contribute to the
unpublished 0.12.0 batch. Software coverage is experimental. No physical camera
was used for these changes.

## Exact model and owner scope

| Model | Protocol type | Product                            |
| ----- | ------------- | ---------------------------------- |
| T8400 | 30            | Indoor Cam 2K / C120               |
| T8410 | 31            | Indoor Cam 2K Pan & Tilt / E220    |
| T8401 | 34            | Indoor Cam 1080p                   |
| T8411 | 35            | Indoor Cam 1080p Pan & Tilt / E210 |
| T8441 | 45            | Outdoor Cam Pro / C24              |
| T8442 | 46            | Outdoor Cam / C22                  |
| T8414 | 100           | Indoor Cam Mini 2K / P44           |
| T8416 | 104           | Indoor Cam S350                    |
| T8417 | 105           | Indoor Cam E30                     |
| T817L | 10031         | Wired Cam C31, added in 0.28.0     |

Identity and possible topology sources are recorded in the
[model matrix](MODEL_MATRIX.md). H3 compatibility alone does not establish
command ownership. The client requires the inventory to name the camera's
actual T8030/type 18 parent, and retains its channel. It never substitutes a
HomeBase merely because that HomeBase can store the camera's recordings.

An empty or self parent retains a camera descriptor and
`standalone_transport_unverified`. It creates no station or working event/media
route. Other owners report `unsupported_station`. T8410C, T8440, T8W11C,
T8W11P, T8419 and T8419N remain unadmitted because their exact matrix association
or relevant topology is unresolved. C210/C220 subtypes are not inferred.

## Discovery, state and events

The existing MIT-attributed `IndoorCamera` class processes native Indoor push
messages in addition to the base camera's H3 messages. Selecting it preserves
that concrete behavior. No new adapter or vendor code is introduced. Source is
`vendor/src/http/device.ts` and `vendor/src/http/types.ts` at client commit
`34863d81eb3bc50dbc095ff537fe156640f7042e`, with [attribution](../NOTICE.md).

Firmware is reported when supplied. None of the nine original pinned property maps
provides a battery property or an observed numeric device-state property.
Battery and availability therefore remain null. Generic battery/status numbers,
SDK defaults and a connected HomeBase cannot establish those camera values.
Malformed or missing observations also remain unknown.

Motion and person events require corresponding properties. Native Indoor and
H3 companion pushes, local detections and replay share the existing duplicate
suppression. The actual owner must match. False resets do not produce detections
and a ring code cannot create a doorbell feature. The existing owner-aware H3 metadata adds pet, sound, crying and other H3
detection properties to the base model maps. The existing public event API
routes supported properties. Tests also exercise native Indoor pet/sound/crying
pushes for every profile, including the C31 below. No new event types are introduced.
Owner changes replace the private object and clean its observations/listeners.
Unsupported tuples or one failed initialization leave other families usable.

The [Indoor tests](../test/indoor.test.mjs) exercise every actual factory,
public inventory and state, native push state changes, event correlation,
standalone descriptors, unknown state, owner changes and independent failure.
The #23 phase passed 95 tests across Indoor, SoloCam, eufyCam and battery
doorbells before media admission was changed.

## Wired Cam C31, 0.28.0

[ha-eufy-cam#136](https://github.com/keesmod/ha-eufy-cam/issues/136) reports a
Wired Cam C31 received as exactly `T817L` with type 10031, camera firmware
2.1.0.3, under a T8030 owner on firmware 3.8.5.2. Earlier clients rejected it as
`unsupported_device` because the pair was not in the profile allowlist. The
pinned catalogue also had no type 10031, so a profile alone would have created a
camera without commands or detection properties. Eufy's
[product page](https://www.eufy.com/products/t817l121) describes a mains-powered
360° pan and tilt Wi-Fi camera with human, vehicle, pet, sound and cry detection,
compatible with HomeBase 3 and HomeBase Mini but not HomeBase 2. A public
[homebridge-eufy report](https://github.com/homebridge-plugins/homebridge-eufy/issues/1027)
shows the same pair as its own station. The profile is therefore
`h3-or-standalone`. As an outdoor wired camera it follows the indoor family.

0.28.0 is the first change that adds a type to the vendored catalogue. Each
addition carries a 0.28.0 marker in the source and is listed in
[NOTICE](../NOTICE.md):

- `DeviceType.WIRED_CAM_C31 = 10031` and its type label.
- A property map with `GenericDeviceProperties` and the motion, person, person
  name, pet, vehicle, sound and crying detection states. These are client-side
  `custom_` states. No setting, battery, device state or other wire parameter is
  claimed, so battery and availability stay null as for the other mains models.
- `DeviceStartLivestream`, `DeviceStopLivestream`, `DeviceStartDownload` and
  `DeviceCancelDownload` only. PTZ, presets, talkback, alarm and snooze are not
  registered.
- Type 10031 in `Device.isCamera()`. Its effective use here is push
  normalization: a push relayed by a T8030 is read as a HomeBase camera push,
  with `a`, `msg_type` and `nick_name`, as for the other Indoor cameras. The
  owner-aware H3 metadata does not change, because the property map has no
  detection-type setting.
- `Device.isWiredCamC31()` and its use in the existing HomeBase-controlled
  type 31/S350 live branch in `Station.startLivestream`.

Without the last addition the camera would fall through to the generic
`CMD_SET_PAYLOAD` branch, which sends no `mChannel`, `camera_type`, `entrytype` or
`accountId`. The selected branch sends the same fields as the HomeBase-attached
media start of the MIT-licensed
[eufy-mega-security](https://github.com/mscodemonkey/eufy-mega-security/blob/7980f342ac844457f92388b94ca087747e486e9c/eufy_event_gateway/src/stream/first-party-ppcs.ts#L116-L147)
gateway. Its [T817L catalogue entry](https://github.com/mscodemonkey/eufy-mega-security/blob/7980f342ac844457f92388b94ca087747e486e9c/eufy_event_gateway/device_catalogue/devices/t817l-wired-cam-c31.yaml)
records live view and snapshots through a T8030 as tested by its maintainer on
2026-09-21. No code is taken from that project. Its result is a third-party
report, not an observation through this client.

Stop, stored snapshots, recording lists, downloads and cancellation use the
unchanged H3 paths above. The cited gateway stops a HomeBase child with
`CMD_STOP_REALTIME_MEDIA` inside the same payload envelope as its start. This
client sends the plain `CMD_STOP_REALTIME_MEDIA` it uses for every H3 camera and
needs the matching acknowledgement. Whether the C31 acknowledges it is
unverified. Without it a stop ends unconfirmed after the existing bound and
closes the station session. Motion and person pushes from a HomeBase arrive as the
base camera's H3 messages. Native Indoor pet, sound and crying pushes use the
`IndoorCamera` class. The [Indoor tests](../test/indoor.test.mjs), the
[media profile](../test/fixtures/indoor-media.mjs) and a focused
[profile test](../test/device-profiles.test.mjs) cover the exact pair, rejected
variants such as `T817L121` and `t817l`, the H3 and standalone relationships, the
complete H.264 and H.265 start envelopes, stop, recordings, the four registered
commands and the normalization of a relayed push. No physical C31 was used. The reporter on #136 can supply the first
observation through this client.

## Remaining obligations

[#35](https://github.com/keesmod/eufy-mega-client/issues/35) owns other HomeBase
owners, including the HomeBase Mini for the C31, and [#36](https://github.com/keesmod/eufy-mega-client/issues/36) standalone
transport. [#57](https://github.com/keesmod/eufy-mega-client/issues/57) retains
hardware confirmation and unresolved model observations. Keep evidence per
model, firmware, topology and feature. PTZ, talkback and settings are outside
this slice. No physical movement, live test, consumer upgrade or publication
is performed. Voluntary reports use the [community process](COMMUNITY_VALIDATION.md)
and missing hardware reports alone do not block ordinary upgrades.

## H3 media profile

The added media admission requires one of the exact pairs above, an actual
matching T8030/type 18 inventory parent with a T8030 serial prefix, LAN-derived
credentials and numeric four-part owner firmware at or above 2.0.9.7. This is
the conservative additional-H3 profile already used by the client, not a newly
observed Indoor firmware minimum. Camera firmware 1.2.3 and owner 3.8.6.0 in
fixtures are synthetic. Admission is also checked at 2.0.9.7. Unknown, malformed
or earlier owner firmware returns `camera_media_unverified` before media starts.

The existing attributed `vendor/src/http/station.ts` at commit
`34863d81eb3bc50dbc095ff537fe156640f7042e` supplies all commands. No vendor source
or protocol was changed for the nine original models. The C31 joins the second
branch through the 0.28.0 addition described above.

| Models                            | Existing live branch                | Full envelope distinction                                                                                                                                             |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8400, T8417                      | HomeBase-controlled Indoor base/E30 | `CMD_DOORBELL_SET_PAYLOAD`, `commandType=1000`, `accountId`, `camera_type=0`, `entrytype=0`, public `encryptkey`, codec 0/1                                           |
| T8410, T8416, T817L               | HomeBase-controlled type 31/S350    | `CMD_SET_PAYLOAD`, `CMD_START_REALTIME_MEDIA`, actual `mChannel`, `mValue3`, `ClientOS`, both account fields, `camera_type=0`, `entrytype=0`, public `key`, codec 1/2 |
| T8401, T8411, T8441, T8442, T8414 | Existing generic Indoor branch      | `CMD_DOORBELL_SET_PAYLOAD`, `commandType=1000`, `account_id`, public `encryptkey`, codec 0/1                                                                          |

The vendor predicate `isIndoorCamC24` in the second branch means protocol type
31, T8410 in this matrix. It does not mean marketing-name C24, T8441/type45.
Fixtures assert the exact complete envelopes for H.264 and H.265 per model, using
real Station methods and the real camera class. Each uses the actual channel.
Only the first two source branches explicitly test HomeBase control. The last
branch is generic Indoor behavior exercised with an H3 owner in software. Its
physical route remains unverified along with the other added profiles.

Stored snapshots reuse `databaseQueryLatestInfo` and `downloadImage`, including
`CMD_DATABASE_IMAGE`. They return stored covers, not newly captured images.
Recording metadata reuses `databaseCountByDate` and `databaseQueryByDate`.
`startDownload` uses the existing H3 `CMD_SET_PAYLOAD` / `CMD_DOWNLOAD_VIDEO`
branch with path and public download key. The historical vendor H3 TODO is
retained. It is not a measured failure or proof of physical Indoor recordings.
No cloud cipher fallback or key guessing is introduced.

`stopLivestream` uses `CMD_STOP_REALTIME_MEDIA` with matching device ACK and
local stop. `cancelDownload` uses `CMD_DOWNLOAD_CANCEL`. EOF alone cannot release
recording ownership or establish complete delivery. Existing eight-second live
and five-second recording cleanup bounds, byte/duration limits and no replay
remain unchanged.

The [Indoor media profiles](../test/fixtures/indoor-media.mjs) extend shared
[H3 media](../test/eufycam-media.test.mjs), [capability](../test/capabilities.test.mjs)
and [lifecycle](../test/family-lifecycle.test.mjs) tests. Coverage includes stored
JPEG bytes, separate video/audio bytes, recording metadata/thumbnails/completion,
wrong channels, missing/rejected/late ACKs, repeated events and failed-owner
isolation. Model/type/owner/firmware rejection occurs before media commands.
Synthetic streams do not prove decodable video or audible sound on hardware.

The T8400 snapshot regression fails with `camera_media_unverified` before the
admission change. All nine real command paths and the expanded shared tests pass
after it. #23 software evidence was recorded before #24 admission. The batch
acceptance and final package evidence are tracked in #63. #57 remains the
separate hardware obligation. Version 0.12.0 needs no session-store migration.
Retain the preceding package, lockfile and private store for rollback.
