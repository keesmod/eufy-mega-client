# Indoor camera software evidence

Stories [#23](https://github.com/keesmod/eufy-mega-client/issues/23) and
[#24](https://github.com/keesmod/eufy-mega-client/issues/24) contributed to
0.12.0, published on 2026-09-11. Software coverage is experimental. No physical
camera was used for these changes.

## Exact model and owner scope

| Model  | Protocol type | Product                                 |
| ------ | ------------- | --------------------------------------- |
| T8400  | 30            | Indoor Cam 2K / C120                    |
| T8410  | 31            | Indoor Cam E220                         |
| T8410C | 31            | Indoor Cam Pan&Tilt 2K, added in 0.29.2 |
| T8401  | 34            | Indoor Cam 1080p                        |
| T8411  | 35            | Indoor Cam 1080p Pan & Tilt / E210      |
| T8441  | 45            | Outdoor Cam Pro / C24                   |
| T8442  | 46            | Outdoor Cam / C22                       |
| T8414  | 100           | Indoor Cam Mini 2K / P44                |
| T8416  | 104           | Indoor Cam S350                         |
| T8417  | 105           | Indoor Cam E30                          |
| T817L  | 10031         | Wired Cam C31, added in 0.28.0          |

Identity and possible topology sources are recorded in the
[model matrix](MODEL_MATRIX.md). H3 compatibility alone does not establish
command ownership. The client requires the inventory to name the camera's
actual T8030/type 18 parent, and retains its channel. It never substitutes a
HomeBase merely because that HomeBase can store the camera's recordings.

An empty or self parent retains a camera descriptor and
`standalone_transport_unverified`. It creates no station or working event/media
route. The [experimental standalone T8410](#experimental-standalone-t8410-0291)
and, since 0.30.0, the [standalone T8410C](#experimental-standalone-t8410c-0300)
are the only opt-in exceptions. Other owners report `unsupported_station`. T8440, T8W11C, T8W11P, T8419 and T8419N remain
unadmitted because their exact matrix association or relevant topology is
unresolved. C210/C220 subtypes are not inferred. The T8410 and T8410C names
follow Eufy's [HomeBase compatibility guide][HB-guide-EU], which names T8410
"Indoor Cam E220" and T8410C "Indoor Cam Pan&Tilt 2K". Eufy's own
[Indoor Cam comparison][Indoor] still names T8410 "Indoor Cam 2K Pan & Tilt"
and lists no T8410C, so Eufy's sources disagree. Earlier versions of this
document followed the comparison page. Owners use Pan & Tilt names for both
models. The ha-eufy-cam#152 reporter calls cameras received as exactly `T8410`
Indoor Cam Pan & Tilt. The owner behind the [Mega inventory log][Mega-7] lists
two Indoor Cam Pan&Tilt, which that log shows as a T8410/31 and a T8410C/31. A
product name alone therefore does not identify the model.

## Discovery, state and events

The existing MIT-attributed `IndoorCamera` class processes native Indoor push
messages in addition to the base camera's H3 messages. Selecting it preserves
that concrete behavior. No new adapter or vendor code was introduced for the nine
original models. Source is
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
addition except the one-line type label carries a 0.28.0 marker in the source.
All are listed in [NOTICE](../NOTICE.md):

- `DeviceType.WIRED_CAM_C31 = 10031` and its type label.
- A property map with `GenericDeviceProperties` and the motion, person, person
  name, pet, vehicle, sound and crying detection states. These are client-side
  `custom_` states. No setting, battery, device state or other wire parameter is
  claimed, so battery and availability stay null as for the other mains models.
- `DeviceStartLivestream`, `DeviceStopLivestream`, `DeviceStartDownload` and
  `DeviceCancelDownload` only. PTZ, presets, talkback, alarm and snooze are not
  registered.
- Type 10031 in `Device.isCamera()`. Its effective use here is push
  normalization: a push relayed by a T8030 is read by the same HomeBase camera
  branch as the other Indoor cameras, instead of the generic branch. The
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
needs the matching acknowledgement. The reporter on #136 saw it acknowledged,
`stop_confirmed: true`, on the tuple below. Without the acknowledgement a stop
ends unconfirmed after the existing bound and closes the station session.
Motion and person pushes from a HomeBase arrive as the base camera's H3 messages. Native Indoor pet, sound and crying pushes use the
`IndoorCamera` class. The [Indoor tests](../test/indoor.test.mjs), the
[media profile](../test/fixtures/indoor-media.mjs) and a focused
[profile test](../test/device-profiles.test.mjs) cover the exact pair, rejected
variants such as `T817L121` and `t817l`, the H3 and standalone relationships, the
complete H.264 and H.265 start envelopes, stop, recordings, the four registered
commands and the normalization of a relayed push. No physical C31 was used for
the change.

On 2026-10-05 the reporter on
[#136](https://github.com/keesmod/ha-eufy-cam/issues/136#issuecomment-5993196872) ran bridge
0.8.30 with client 0.28.0 and integration 0.8.38 on camera firmware 2.1.0.3
under a T8030 on firmware 3.8.5.2. They reported discovery under the HomeBase 3,
a snapshot, live video and audio, a closed live view with
`stop_confirmed: true`, recording lists and playback, and a person event working.
Motion, pet, vehicle, sound and crying events were not reported. Playback of a
recording was a native remux even with H.264 output selected, which means this
camera's recordings arrived as H.264. This is a reported result, not
independently reproduced.

## Experimental standalone T8410, 0.29.1

[ha-eufy-cam#152](https://github.com/keesmod/ha-eufy-cam/issues/152) reports two
cameras received as exactly `T8410` with type 31, which the reporter calls Indoor
Cam Pan & Tilt, on camera firmware 2.3.2.4 and 2.3.1.6. On 2026-10-10 the
reporter ran integration 0.8.43, bridge 0.8.34 and client 0.29.0 on HA OS amd64
with `experimental_standalone` on. Both cameras are standalone Wi-Fi cameras
without a HomeBase, on the same subnet as the bridge. Discovery passed with a
complete descriptor. Snapshot, live and recordings stayed
`standalone_transport_unverified` and no local session was attempted, because
0.29.0 admitted only the T84A1 profile to the opt-in route.

With the client option `experimentalStandalone`, 0.29.1 admits exactly
T8410/type 31 with an empty or self parent as its own local owner, as described
in [API.md](API.md#experimental-standalone-cameras). No other Indoor model or
type-only match is admitted to this route, apart from the exact
[T8410C](#experimental-standalone-t8410c-0300) since 0.30.0. The camera is then the
station of the reused Station operations. Its type 31 station table declares
`downloadImage`, `databaseQueryLatestInfo`, `databaseQueryByDate` and
`databaseCountByDate`, and its device table declares live start and stop and
download start and cancel. The session uses the existing local lookup and the
LAN-derived command key from the camera's own serial and P2P device ID. No
vendor source changes.

Live takes the generic Indoor branch of the [H3 media profile](#h3-media-profile)
table, not the HomeBase-controlled type 31/S350 row, because the camera's own
station is not a HomeBase. It sends `CMD_DOORBELL_SET_PAYLOAD` with
`commandType=1000`, `account_id`, public `encryptkey` and codec 0/1 on the
camera's channel. Stop is the plain `CMD_STOP_REALTIME_MEDIA`.

Before the 2026-10-13 report it was unknown whether a standalone T8410 accepts
that key and envelope, and whether it answers the gateway information request
after the handshake. The reported live video on firmware 2.3.2.4 on 2026-10-13
and on 2.3.1.6 on 2026-10-15 implies that both firmware versions do both. For
other firmware both remain unknown. Without that answer no command key is set and the connection ends at
the `session_open` stage. Whether it serves snapshot covers from its own storage is unknown too. With a
microSD card, firmware 2.3.2.4 and 2.3.1.6 acknowledged the recording query in
the 2026-10-16 report below but never answered it. Since 0.30.1 the camera's
recordings report `standalone_recordings_unverified` on this route, and its
thumbnail and download are refused before any connection. A download with a
cipher ID is refused first with `recording_cipher_unavailable`, because it would
need a cloud cipher. Guard mode and events stay off. Since 0.30.1 its pushes
are counted in `standalonePushStatus` but refused.

The [standalone tests](../test/standalone-experimental.test.mjs) run the
model-independent T84A1 cases for the T8410 too: discovery, credentials,
connection stages, a live start and confirmed stop on the one session, snapshot
assignment, the unavailable recordings, and the refused guard mode, pushes and
cipher downloads, with synthetic rows and a stubbed station. They also cover the
`IndoorCamera` owner
wiring, reloads between its own owner, a HomeBase and no transport, and a real
vendor Station and `IndoorCamera` for the type 31 row without a socket, with the
complete H.264 and H.265 start envelopes and the stop.

Without the option a standalone T8410 keeps `standalone_transport_unverified`.
Under a HomeBase it keeps its H3 relationship, media and live branch, also with
the option. On 2026-10-13 the reporter of ha-eufy-cam#152 reported live video
working on a standalone T8410 with firmware 2.3.2.4. The one with firmware
2.3.1.6 first ended its connection at the lookup without a reply from that
camera, and on 2026-10-15 it was reported streaming live video too, as recorded
in the
[model matrix](MODEL_MATRIX.md#reported-standalone-t8410-result-2026-10-13).
The physical result belongs
to [ha-eufy-cam#152](https://github.com/keesmod/ha-eufy-cam/issues/152) and
[#142](https://github.com/keesmod/eufy-mega-client/issues/142).

On 2026-10-15 the same reporter's recording list failed for the standalone
T8410 on firmware 2.3.2.4, which streams live video, with bridge
0.8.38-beta.1 and client 0.30.0-beta.1. The bridge returned only
`recording_unavailable`, so that report does not show the cause, as recorded in
the
[model matrix](MODEL_MATRIX.md#reported-standalone-t8410-result-2026-10-13).
Live video uses another command and says nothing about the database query
`databaseQueryByDate` (10006). That query is verified only on a HomeBase 3 so
far, and in the public analog
[bropat/eufy-security-client#963](https://github.com/bropat/eufy-security-client/issues/963)
a standalone E30 never answered it. Since 0.30.1 the
[recording operation observation](API.md#recording-operation-observation-0301)
reports the device's command result for the query, its answer or the lack of
one, database replies the session could not dispatch, and the classes of
returned rows, including rows with a cipher ID, whose download a standalone
owner refuses. Recording playback on the standalone route is still unconfirmed for the T84A1
and the T8410C. The 2026-10-16 report below covers the T8410.

On 2026-10-16 the [same reporter][standalone-results] used that observation,
with bridge 0.8.39-beta.1 and client 0.30.1-beta.1. Both standalone T8410
cameras, on firmware 2.3.2.4 and 2.3.1.6, acknowledged the query with command
result 0 and never answered it. With power on, each list ended with
`device_request_timeout` at stage `query` after about 16 seconds, twice per
camera, without unhandled database replies. The camera on 2.3.1.6 was
unpowered during its first list, which ended at stage `lookup`. Both cameras
have a microSD card and record continuously, as the reporter
[wrote on 2026-10-15][continuous], and the Eufy app shows only a continuous
timeline for the T8410 cameras, without separate event clips. The
reading, not a proven cause, is that firmware 2.3.x accepts 10006 without
answering it, consistent with the E30 above and with recording that is
continuous only. With no answer from either camera, recording playback on the
standalone T8410 route does not work with the current request. Which request the camera answers for its
continuous timeline is unknown. This is reported, not independently reproduced, as recorded in the
[model matrix](MODEL_MATRIX.md#reported-standalone-t8410-and-t8410c-results-2026-10-16).

Standalone recordings moved to
[ha-eufy-cam#175](https://github.com/keesmod/ha-eufy-cam/issues/175). No other
request had enough evidence for a standalone T84xx camera, so since 0.30.1 the
client reports recordings on the experimental standalone route as unavailable
with `standalone_recordings_unverified`, as described in
[API.md](API.md#experimental-standalone-cameras). Snapshot and live are
unchanged, and Indoor cameras under a HomeBase keep their recordings
capability. The ranked candidates are recorded in the
[model matrix](MODEL_MATRIX.md#standalone-recordings-outcome-0301). Since
0.30.1 `probeStandaloneRecordings` sends candidate 1 on request, as described
in [API.md](API.md#standalone-recording-probe-0301).
On 2026-10-23 the same reporter reported that both T8410 cameras answered it,
on firmware 2.3.2.4 with an empty page and on 2.3.1.6 with database result
-1100. In an earlier run on 2026-10-19 one of them listed one record of its
own. These are reported results, not independently reproduced. Recordings stay
unavailable, as recorded in the
[model matrix](MODEL_MATRIX.md#reported-standalone-recording-probe-results-2026-10-23).

## Indoor Cam Pan&Tilt 2K T8410C, 0.29.2

The [2026-10-09 report on ha-eufy-cam#149][149-report] lists two cameras with
`device_type=31` and firmware 3.3.4.4 under a T8030 on firmware 3.8.7.4, which
the reporter calls Indoor Cam Pan&Tilt 2K. Bridge 0.8.33/client 0.28.2 rejected
both as `unsupported_device`. Their model showed as unavailable, because the
received string failed the diagnostic model bound of that version. T8410/31 was
already admitted, so the received string was not exactly `T8410`.

0.29.2 admits exactly `T8410C` with type 31, using the T8410 H3 policy without
the experimental standalone flag: the `IndoorCamera` adapter, `h3-or-standalone`
topology and additional-H3 media.
The admission rests on public evidence, not on a value received in this report:

- Eufy's [EU HomeBase compatibility guide][HB-guide-EU] lists "Indoor Cam
  Pan&Tilt 2K" as T8410C and "Indoor Cam E220" as T8410, both supported on
  HomeBase 3.
- A [public Mega inventory log][Mega-7] of 2026-09-14 shows model `T8410C` with
  device type 31 and a parent, next to T8030/18, T8160/19, T8213/91 and a
  separate T8410/31.
- [bropat/eufy-security-client#722][bropat-722] of 2025-12-11 reports a T8410C
  with firmware 3.3.3.2 and type 31 under a T8030. That issue reports live start
  failing with `return_code -104`. Upstream fixed it with a third-party change
  that later became the HomeBase-controlled type 31 live branch the vendored
  code carries. At 0.29.2 no T8410C had used that branch here. The result of
  2026-10-16 below reports live view on two type 31 cameras under a T8030.
- T8410C firmware is on the 3.3.x line and plain T8410 firmware on the 2.3.x
  line, as in [eufy-security-ws#486][ws-486] and [#489][ws-489]. The reporter's
  firmware 3.3.4.4 fits T8410C.

Limits of this evidence:

- At 0.29.2 it was not verified that the reporter's rows carry exactly
  `T8410C`. On 2026-10-16 both appeared on 0.29.2, which admits type 31 only as
  exactly `T8410` or `T8410C`. `T8410` was already admitted when the rows were
  rejected, so their appearance points to exactly `T8410C`. No received value
  shows it.
- The inventory and firmware sources above (the Mega log and the bropat
  reports) come from other clients. That they read the same inventory field as
  this client is not verified.
- Only the exact pair is added. `T8410-C`, `T8410P`, lower case, trailing
  spaces and other types stay `unsupported_device`. No prefix or type-only
  admission exists.
- An empty or self parent keeps `standalone_transport_unverified` in 0.29.2,
  also with `experimentalStandalone`. 0.30.0 opens the experimental standalone
  route of the [standalone T8410](#experimental-standalone-t8410-0291) to the
  T8410C, as described [below](#experimental-standalone-t8410c-0300).
- Under a HomeBase the vendored live start selects the type 31 branch by device
  type and HomeBase control, so T8410C sends the T8410 envelope below. Branch
  selection does not read the camera serial, and the P2P session's serial-prefix
  checks read the HomeBase serial.

The [Indoor tests](../test/indoor.test.mjs), the
[media profile](../test/fixtures/indoor-media.mjs) and a focused
[profile test](../test/device-profiles.test.mjs) cover the exact pair under a
T8030 with the `IndoorCamera` adapter, state and events, rejected variants, the
owner and firmware gates, empty and self parents with and without the opt-in,
the H.264 and H.265 start envelopes, stop, recordings and cancellation. No
physical T8410C was used for the change.

On 2026-10-16 the reporter of ha-eufy-cam#149 [reported][149-result] that after
updating to integration 0.8.45 and bridge 0.8.36 with client 0.29.2 all
devices, both type 31 cameras included, appeared right away and work with
snapshots, live view, recordings and events. The comment names no device,
firmware or event type separately. Audio, confirmed stop and cancellation were
not reported. This is a reported result, not independently reproduced, as
recorded in the [model matrix](MODEL_MATRIX.md#reported-issue-149-0292). The
standalone result of 2026-10-16 is in
[Experimental standalone T8410C, 0.30.0](#experimental-standalone-t8410c-0300).

[149-report]: https://github.com/keesmod/ha-eufy-cam/issues/149
[149-result]: https://github.com/keesmod/ha-eufy-cam/issues/149#issuecomment-6214980737
[HB-guide-EU]: https://service.eufy.com/eu/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide
[Indoor]: https://service.eufy.com/article-description/Differences-Between-eufy-Indoor-Cams
[Mega-7]: https://github.com/mscodemonkey/eufy-mega-security/issues/7
[bropat-722]: https://github.com/bropat/eufy-security-client/issues/722
[ws-486]: https://github.com/bropat/eufy-security-ws/issues/486
[ws-489]: https://github.com/bropat/eufy-security-ws/issues/489

## Experimental standalone T8410C, 0.30.0

[ha-eufy-cam#168][168-report] reports a camera received as exactly `T8410C` with
type 31 on firmware 3.3.4.4, from the reporter of ha-eufy-cam#152. On 2026-10-15
they ran integration 0.8.47-beta.1, bridge 0.8.38-beta.1 and client
0.30.0-beta.1 on HA OS with `experimental_standalone` on. The camera is a
standalone camera without a HomeBase, on the same LAN as their two
[standalone T8410](#experimental-standalone-t8410-0291) cameras. Discovery
passed with a complete descriptor. Snapshot, live and recordings stayed
`standalone_transport_unverified` and no local session was attempted, because
the T8410C profile did not allow the opt-in route.

With the client option `experimentalStandalone`, 0.30.0 admits exactly
T8410C/type 31 with an empty or self parent as its own local owner, as described
in [API.md](API.md#experimental-standalone-cameras). Admitting the T8410C
changes only its profile flag. The camera then uses the same local lookup, LAN-derived
command key from its own serial and P2P device ID, type 31 station and device
tables and generic Indoor live branch as the standalone T8410. The vendored code
selects the tables and the live branch by device type, and the camera's own
station is not a HomeBase. On this route the P2P session's serial-prefix checks,
which decide whether the codec and key frames are read from the packet header or
from the video data, read the camera's own serial. A serial that starts with
`T8410` takes the T8410 path there. Whether every T8410C serial does is not
verified.

The T8410 results on firmware 2.3.2.4 and 2.3.1.6 do not transfer to the T8410C,
whose firmware is on the 3.3.x line. Before the 2026-10-16 report it was unknown
whether a standalone T8410C accepts the LAN-derived key, answers the gateway
information request and accepts the `CMD_DOORBELL_SET_PAYLOAD` start. The
reported live video on firmware 3.3.4.4 implies that this firmware does all
three. For other firmware it remains unknown. Whether it serves snapshot covers
from its own storage is still unknown. Without a microSD card it answered the
recording query with database result -1100 and no rows. On 2026-10-19 and
2026-10-23 it was reported to answer the 10017 probe the same way, not
independently reproduced, see the [probe results](MODEL_MATRIX.md#reported-standalone-recording-probe-results-2026-10-23). Since 0.30.1 its
recordings report `standalone_recordings_unverified` on this route, as for the
[T8410](#experimental-standalone-t8410-0291), and a download with a cipher ID is
refused first with `recording_cipher_unavailable`. Guard mode and events stay
off, and since 0.30.1 its pushes are counted but refused. Pan and tilt and talkback are outside this change.

The [standalone tests](../test/standalone-experimental.test.mjs) run the T8410
cases for the T8410C too, with synthetic rows, a stubbed station and a real
vendor Station and `IndoorCamera` without a socket. The HomeBase T8410C cases in
the [Indoor tests](../test/indoor.test.mjs) are unchanged. Without the option a
standalone T8410C keeps `standalone_transport_unverified`. Under a HomeBase it
keeps its H3 relationship, media and HomeBase-controlled type 31 live branch,
also with the option. At 0.30.0 no physical standalone T8410C had used the
route. On 2026-10-16 the reporter of ha-eufy-cam#152
[reported][standalone-results] one on firmware 3.3.4.4 working for live view and
snapshot, and its recording list rejected with database result -1100 without a
microSD card, as recorded in the
[model matrix](MODEL_MATRIX.md#reported-standalone-t8410-and-t8410c-results-2026-10-16).
This is reported, not independently reproduced. The result belongs to
[ha-eufy-cam#168](https://github.com/keesmod/ha-eufy-cam/issues/168) and
[#142](https://github.com/keesmod/eufy-mega-client/issues/142). Standalone
recordings moved to
[ha-eufy-cam#175](https://github.com/keesmod/ha-eufy-cam/issues/175) and are
reported unavailable since 0.30.1.

[168-report]: https://github.com/keesmod/ha-eufy-cam/issues/168#issuecomment-6189829101
[standalone-results]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6208097780
[continuous]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6195646642

## Remaining obligations

[#143](https://github.com/keesmod/eufy-mega-client/issues/143) tracks other HomeBase
owners, including the HomeBase Mini for the C31, and [#142](https://github.com/keesmod/eufy-mega-client/issues/142) standalone
transport. [#57](https://github.com/keesmod/eufy-mega-client/issues/57) held
hardware confirmation and unresolved model observations until it was closed as
not planned on 2026-09-16. The [model matrix](MODEL_MATRIX.md) records hardware
evidence status per tuple. Keep evidence per model, firmware, topology and
feature. PTZ, talkback and settings are outside this slice. No physical
movement, live test, consumer upgrade or publication is performed.
Voluntary reports use the [community process](COMMUNITY_VALIDATION.md)
and missing hardware reports alone do not block ordinary upgrades.

## H3 media profile

The added media admission requires one of the exact pairs above, an actual
matching T8030/type 18 inventory parent with a T8030 serial prefix, LAN-derived
credentials and numeric four-part owner firmware at or above 2.0.9.7. This is
the conservative additional-H3 profile already used by the client, not a newly
observed Indoor firmware minimum. Camera firmware 1.2.3 and owner 3.8.6.0 in
the other fixtures are synthetic. The T8410C fixture uses camera firmware 3.3.4.4
and owner firmware 3.8.7.4 from the ha-eufy-cam#149 type 31 rows, whose model is
unconfirmed. Admission is also checked at 2.0.9.7. Unknown, malformed
or earlier owner firmware returns `camera_media_unverified` before media starts.

The existing attributed `vendor/src/http/station.ts` at commit
`34863d81eb3bc50dbc095ff537fe156640f7042e` supplies all commands. No vendor source
or protocol was changed for the nine original models. The C31 joins the second
branch through the 0.28.0 addition described above. T8410C has type 31 and
selects the second branch like T8410, without a vendor change.

| Models                            | Existing live branch                | Full envelope distinction                                                                                                                                             |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8400, T8417                      | HomeBase-controlled Indoor base/E30 | `CMD_DOORBELL_SET_PAYLOAD`, `commandType=1000`, `accountId`, `camera_type=0`, `entrytype=0`, public `encryptkey`, codec 0/1                                           |
| T8410, T8410C, T8416, T817L       | HomeBase-controlled type 31/S350    | `CMD_SET_PAYLOAD`, `CMD_START_REALTIME_MEDIA`, actual `mChannel`, `mValue3`, `ClientOS`, both account fields, `camera_type=0`, `entrytype=0`, public `key`, codec 1/2 |
| T8401, T8411, T8441, T8442, T8414 | Existing generic Indoor branch      | `CMD_DOORBELL_SET_PAYLOAD`, `commandType=1000`, `account_id`, public `encryptkey`, codec 0/1                                                                          |

The vendor predicate `isIndoorCamC24` in the second branch means protocol type
31, T8410 and T8410C in this matrix. It does not mean marketing-name C24, T8441/type45.
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
acceptance and final package evidence were tracked in #63, which closed on
2026-09-11. #57 held the separate hardware obligation until it was closed as
not planned on 2026-09-16. Version 0.12.0 needs no session-store migration.
Retain the preceding package, lockfile and private store for rollback.
