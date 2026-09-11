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
and a ring code cannot create a doorbell feature. Pet/sound/crying properties
remain private implementation details, without expanding the public event API.
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
