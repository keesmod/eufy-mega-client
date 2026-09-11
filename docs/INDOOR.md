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

Firmware is reported when supplied. None of these nine pinned property maps
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
pushes for all nine profiles. No new event types are introduced.
Owner changes replace the private object and clean its observations/listeners.
Unsupported tuples or one failed initialization leave other families usable.

The [Indoor tests](../test/indoor.test.mjs) exercise all nine actual factories,
public inventory and state, native push state changes, event correlation,
standalone descriptors, unknown state, owner changes and independent failure.
The #23 phase passed 95 tests across Indoor, SoloCam, eufyCam and battery
doorbells before media admission was changed.

## Remaining obligations

[#35](https://github.com/keesmod/eufy-mega-client/issues/35) owns other HomeBase
owners and [#36](https://github.com/keesmod/eufy-mega-client/issues/36) standalone
transport. [#57](https://github.com/keesmod/eufy-mega-client/issues/57) retains
hardware confirmation and unresolved model observations. Keep evidence per
model, firmware, topology and feature. PTZ, talkback and settings are outside
this slice. No physical movement, live test, consumer upgrade or publication
is performed. Voluntary reports use the [community process](COMMUNITY_VALIDATION.md)
and missing hardware reports alone do not block ordinary upgrades.

## H3 media profile

The added media admission requires one of the nine exact pairs above, an actual
matching T8030/type 18 inventory parent with a T8030 serial prefix, LAN-derived
credentials and numeric four-part owner firmware at or above 2.0.9.7. This is
the conservative additional-H3 profile already used by the client, not a newly
observed Indoor firmware minimum. Camera firmware 1.2.3 and owner 3.8.6.0 in
fixtures are synthetic. Admission is also checked at 2.0.9.7. Unknown, malformed
or earlier owner firmware returns `camera_media_unverified` before media starts.

The existing attributed `vendor/src/http/station.ts` at commit
`34863d81eb3bc50dbc095ff537fe156640f7042e` supplies all commands. No vendor source
or protocol is changed.

| Models                            | Existing live branch                | Full envelope distinction                                                                                                                                             |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8400, T8417                      | HomeBase-controlled Indoor base/E30 | `CMD_DOORBELL_SET_PAYLOAD`, `commandType=1000`, `accountId`, `camera_type=0`, `entrytype=0`, public `encryptkey`, codec 0/1                                           |
| T8410, T8416                      | HomeBase-controlled type 31/S350    | `CMD_SET_PAYLOAD`, `CMD_START_REALTIME_MEDIA`, actual `mChannel`, `mValue3`, `ClientOS`, both account fields, `camera_type=0`, `entrytype=0`, public `key`, codec 1/2 |
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
after it. #23 software evidence was recorded before #24 admission. The issues
remain open for coordinated batch review and integration. #57 remains the
separate hardware obligation. Version 0.12.0 needs no session-store migration.
Retain the preceding package, lockfile and private store for rollback.
