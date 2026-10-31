# Camera model, topology and feature evidence

Reviewed 2026-09-10 for [story #15][Story]. This is an evidence inventory for the
[programme][Programme], not a list of supported products. Product implementation
belonged to [E2] and hardware acceptance to [E6] until both closed on 2026-09-16.
Where this matrix still names them, they mark where an obligation was recorded.
This matrix holds hardware evidence status. Current work status lives in
individual GitHub issues.

The generated [device-profile policy](DEVICE_PROFILES.md) lists current runtime
recognition, topology and separate media admission from one typed source. Dated
hardware observations and unresolved feature evidence remain in this matrix.

The camera bridge and integration belong in `ha-eufy-cam`. The separate mower
bridge and integration belong in `eufy-robomow-ha`. Both consume this library
independently, as described in [PROGRAMME.md](PROGRAMME.md).

## E15 local telemetry, 2026-09-16

The [owned E15 receipt](research/E15_TELEMETRY_OBSERVATION_2026-09-16.md)
records T2880 firmware 6.9.28, iOS Anker eufy 6.1.00 and Node 24.21.0 on Linux
over direct LAN Tuya 3.5. This is separate from the camera catalogue below.

| Feature                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Remaining limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery, schema and local query lifecycle | Confirmed in bounded owned-device sessions with disconnect and shutdown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Other firmware and installations remain untested                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Battery                                     | Confirmed DP 8, repeated 100% readings and independent app comparison                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Other battery levels have synthetic range coverage only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Network kind and signal                     | Confirmed DP 134 `Wifi` and DP 109's declared percentage, repeated 68% readings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Cellular/None unobserved, no dBm conversion or RF calibration established                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Spontaneous LAN report acquisition          | Two owner-operated transition windows received 93 authenticated reports, including 20 DP 107 reports and four DP 108 reports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Receipt age is known, device measurement time is not. HA recovered after temporary unavailability during observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Activity                                    | DP 107 envelope established as wire records in fields 1, 2, 3 and 6 plus a default payload. `mowing`, `paused` and `returning` confirmed through four owner-operated cycles on 2026-09-16 and 2026-09-19, at least four app-correlated transitions each, shipped as confirmed definitions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Defogging shares the `mowing` payload. Since 0.22.0 the app's mission status decoder reads DP 107 by its fields: every mowing mission, the Box task included, reports `mowing` or `paused`, and a message without a mission, the default payload and hibernation included, reports `idle`. The map save and the first frame of a start stay withheld. No payload identifies docked, charging or error                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Cloud activity for display                  | Library 0.25.1 supplied typed cloud DP 107 activity for HA display and automatic map-stream selection during the supervised 2026-09-26 E15 run, with source and receipt age explicit, see [receipt](research/E15_NATIVE_MAP_WINDOW_2026-09-26.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Cloud receipt is not a fresh local report, physical dock confirmation, command confirmation or verified session-history evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Charger contact                             | Library 0.27.0 reads DP 108 field 2 from the cloud record, the charger connection of the official app's own battery status decoder. One owner-requested window on 2026-09-29 read it connected in every sample of four rests at the station and not connected in every sample of three stops of about twenty minutes on the lawn, with three departures and three arrivals and the app's display as correlation, see [receipt](research/E15_CHARGER_CONTACT_2026-09-29.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Cloud receipt, not a fresh local report or command confirmation. Nobody watched the mower in person. A mower lifted off the station, a station without power and LAN reports of DP 108 were not tested                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Mowing progress                             | Unconfirmed, app displayed 0% and once 1% during the short mowing cycles, no data point changed alongside it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Identify a fresh source and reproduce changing app-correlated values. DP 118 is map-save progress                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Commands                                    | Opt-in `start`, `pause` and `resume` over DP 1 and DP 2 confirmed in two owner-operated windows on 2026-09-19 and 2026-09-20: the written point echoed within a second, the confirmed DP 107 activity followed, and the app and the owner agreed on every step. `stop` over DP 1 false confirmed on 2026-09-20: it ended the task and the mower returned to the dock by itself, `returning` 0.3 seconds after the write, DP 1 false 0.6 seconds after it and the map-saving payload at dock arrival 30 seconds later. Library 0.25.2 through mower bridge 0.13.1 repeated `start` from the station and from charging, `pause`, `resume` and `stop` through Home Assistant on 2026-09-27, each confirmed by a fresh report, see [receipt](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5857986097). `return` over DP 3 `switch_charge` ended `timed_out` without any report or effect from `paused` and from the stopped task                                                                 | Three windows. The 2026-09-19 and 2026-09-20 windows ran one cycle per class from docked, mowing and paused plus one `stop` from mowing and one `return` from the stopped task. The 2026-09-27 window added, through Home Assistant, `start` from docked and from charging, `pause` from mowing, `resume` from paused and `stop` from mowing through Home Assistant's Dock, with no `return`. `return` is not honoured by firmware 6.9.28 from `paused` or from the stopped task, so the library has no DP 3 return route. The library route that brings the mower home is `stop`, which does not leave the task stopped on the lawn. The app's Stop with Clear Progress keeps the mower in place, and its Charge from that state returns it over raw control points with uninterpreted values that the library does not write                                 |
| Settings                                    | Declared points of mow height, volume, smart no-go zones, sparse lawn optimization, rain auto return, child lock and bird-view capture read on the owned E15 in a read-only readout on 2026-09-25 and matched to the official app's product script. Typed reading of all seven and opt-in writes of the first four with fresh-report read-back. Each of the four changed and restored on the owned E15 on 2026-09-25 through Home Assistant and the mower bridge, the mow height also at its bounds of 25 and 75 mm, each value read back by the library and a later fresh query, and every mow height shown by the app's Grass Height. Since 0.23.0 the DP 155 work parameters are read from the cloud record and decoded with the app's numbering, and the mow speed and blade speed are written as one partial message behind the same opt-in, each changed and restored on the owned E15 on 2026-09-25 through Home Assistant and the mower bridge with a fresh-report read-back and matching cloud readings | No write ran while mowing or during a map save. Rain and child protection and the bird-view capture are read only. The low speeds were not written on hardware and the app's display of the speeds was not read. Edge distance, mow spacing and the direction are read only until a permitted source gives their bounds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Map geometry                                | Fresh docked downloads decoded end to end on 2026-09-25 with library 0.24.0 and bridge 0.12.1. On 2026-09-26, library 0.25.1 and bridge 0.13.0 supplied 56 fresh HA cache versions during a bounded mowing window. Consumer replay confirmed changing tracking positions and paths, see [receipt](research/E15_NATIVE_MAP_WINDOW_2026-09-26.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Six successive native geometry changes occurred with the same map identity, so geometry was not unchanged during mowing. Their native meaning remains unconfirmed. The [2026-09-29 app source check](research/E15_MAP_SEMANTICS_2026-09-29.md) establishes milliradians for Pose.theta and the app's location/pose use of navPath.bin.stream. The [#215 availability check and owner decision](research/E15_COORDINATE_ASSUMPTION_2026-09-29.md) adopt millimetres for coordinate and pose positions and millimetres per grid cell for resolution as an explicit assumption. No primary unit source or physical measurement confirms it. The coordinate frame, heading reference, totalArea unit and physical accuracy remain unconfirmed. Geometry stays display only and raw API integers are unchanged. Longer daily use and other hardware remain untested |
| Native map lifecycle and migration          | The 2026-09-25 source switch, real bridge outage, automatic native recovery and rollback passed with the last-good image retained. Android was then retired after verified recovery archives. Library 0.25.1 passed 30-second deadline and 10-second abort streams on 2026-09-26 with confirmed cancellation and cleanup, see [receipt](research/E15_NATIVE_MAP_WINDOW_2026-09-26.md). Library 0.25.2 in mower bridge 0.13.1 renewed the Home session before the near-expiry refusal on 2026-09-27, once between idle demands ([receipt](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5857287766)) and once during a running stream demand that ended normally ([receipt](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5857986097)). The bridge also recovered from a host reboot with its restored session, see [receipt](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5857986097)                                                                  | Migration/outage evidence used library 0.24.0. Longer daily use and running the archived Android restoration remain untested. At the weakest Wi-Fi signal three of 87 stream demands ended with `connection_failed`, with cleanup confirmed but cancellation unconfirmed because the connection was already gone, and the bridge resumed after its retry interval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cleaning-path history                       | Library-owned accumulator merges successive decoded paths of one map identity and generation into one ordered history with the acquisition revision and receipt time per segment, synthetic fixtures, and the retained captures of 2026-09-10 replayed locally: the empty realtime placeholder changed nothing, a repeated history path merged unchanged, a stale replay was rejected and a changed grid started a new history without mixing, software evidence only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Growth of one path across acquisitions has synthetic coverage only, non-empty `realtime` paths were never observed on this transport and are handled structurally, and the merged history has not been compared with the app's displayed path on the owned device, recorded on [#178](https://github.com/keesmod/eufy-mega-client/issues/178). The 2026-09-26 moving-map replay exercised the separate HA accumulator and does not validate this library history API                                                                                                                                                                                                                                                                                                                                                                                           |

The library leaves unconfirmed fields withheld and exposes raw snapshots
unchanged. Library cleaning-path history and HA display accumulation are separate
implementations. The dated map receipt identifies which was exercised. Map decoding is recorded in
[Decoded mower map geometry](MAP_GEOMETRY.md) from
[#51](https://github.com/keesmod/eufy-mega-client/issues/51).
[#149](https://github.com/keesmod/eufy-mega-client/issues/149) tracked the
telemetry definition work until it closed on 2026-09-16.
The opt-in [private map provisioning producer](research/E15_MAP_PROVISIONING.md)
supplied the fresh docked downloads and the later bounded moving-map streams.
The [2026-09-25 migration receipt](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5839090826)
confirms source switching, outage recovery, rollback and subsequent Android
retirement with verified archives. The
[2026-09-26 map receipt](research/E15_NATIVE_MAP_WINDOW_2026-09-26.md) adds
confirmed stream cancellation, mowing updates and owner-confirmed dock return.
The 0.16.1 display fix was validated by recorded-data replay and a docked
installation readback before any mowing run with 0.16.1. The 2026-09-27 receipt
does not assess it. On 2026-09-27 the lasting
installation used integration 0.16.1, bridge/app 0.13.1 and library 0.25.2 in
control mode with settings writes disabled. The [2026-09-27 receipt](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5857986097) adds commands
through Home Assistant, the session renewal during a running stream demand and
host-reboot recovery. The [daily-use receipt](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5864644965)
adds about 13 hours overnight with the mower at its station, a healthy map and
14 session renewals without error. The mower entity was unavailable eleven
times, each for up to a minute at one of 30 LAN state-query timeouts. The
receipt left the timeout cause as a separate follow-up.
[Mower acceptance #8](https://github.com/keesmod/eufy-robomow-ha/issues/8) was
closed as completed on 2026-09-28. The versions installed since then are
recorded in `docs/release-candidates.md` of the
[mower repository](https://github.com/keesmod/eufy-robomow-ha).
The app-operated run of 2026-09-26 adds no command or settings acceptance to the earlier rows.
The report acquisition work was
[#150](https://github.com/keesmod/eufy-mega-client/issues/150), closed on 2026-09-16.
Its [report-acquisition receipt](research/E15_ACTIVITY_REPORTS_2026-09-16.md)
records the separate incoming report path and its current evidence limits.
The DP 107 field contract and evidence-gated activity decoder of
[#153](https://github.com/keesmod/eufy-mega-client/issues/153) are recorded in
the [contract receipt](research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md). The
owner-operated reproduction window of
[#156](https://github.com/keesmod/eufy-mega-client/issues/156) is recorded in
the [reproduction receipt](research/E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md)
with firmware 6.9.28 and app 6.1.00, three cycles, HA recovery and cleanup.
The opt-in command path of
[#169](https://github.com/keesmod/eufy-mega-client/issues/169) is recorded in
the [control-point receipt](research/E15_CONTROL_POINTS_2026-09-19.md),
[Opt-in mower commands](MOWER_COMMANDS.md) and the
[command window receipt](research/E15_COMMAND_WINDOW_2026-09-19.md): `start`,
`pause` and `resume` are confirmed on the owned device and `return` over DP 3
from `paused` is not honoured. The opt-in `stop` class and the stopped-task
precondition of `return` from
[#173](https://github.com/keesmod/eufy-mega-client/issues/173) are recorded in
the [stop and return receipt](research/E15_STOP_RETURN_WINDOW_2026-09-20.md):
`stop` over DP 1 false is confirmed and returns the mower to the dock by
itself, and `return` over DP 3 from the stopped task is not honoured either,
so the library has no DP 3 return route on firmware 6.9.28. The opt-in
settings of 0.20.0 for the settings workstream of
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8)
are recorded in [Opt-in mower settings](MOWER_SETTINGS.md) and the
[settings schema receipt](research/E15_SETTINGS_SCHEMA_2026-09-25.md), and the
supervised changes and restores of every writable setting and of the two
work parameter speeds of [Mower work parameters](MOWER_WORK_PARAMETERS.md) in
the [settings window receipt](research/E15_SETTINGS_WINDOW_2026-09-25.md). Remaining
hardware work is the mowing-progress source and any error payload. Since 0.22.0 DP 107 is read
as the app's mission status, see the
[mission status receipt](research/E15_MISSION_STATUS_SCHEMA_2026-09-25.md). Since 0.27.0 the cloud
reading carries the DP 108 charger contact, see the
[charger contact receipt](research/E15_CHARGER_CONTACT_2026-09-29.md).

## Community evidence, 2026-09-11

The [community policy](COMMUNITY_VALIDATION.md) separates ordinary upgrades from
the evidence below. A model without a maintainer test is not an upgrade exclusion.
Runtime protocol limitations remain. Share results through the
[compatibility form](https://github.com/keesmod/ha-eufy-cam/issues/new?template=compatibility.yml)
or the original issue for an existing defect.

The historical codes remain unchanged: X is unconfirmed implementation, P is
reported working, H is a dated hardware observation, F is a known reported problem,
and U is unknown. B1/U and B2/U describe historical implementation barriers at
their pinned commit. They do not label all newer releases unsupported. Later
software and evidence sections supersede only their stated combinations.
Not implemented requires an identified missing code path. Confirmed behavior
requires the exact combination and reproducible feature evidence described in the
policy. Community evidence can meet that standard without maintainer ownership.

### T8134 follow-up observations

This table supplements the historical R0-R3 rows and type 63 cells. It preserves
the original failures. Known hardware from R0 is T8134 firmware 3.3.6.0 with T8030
firmware 3.8.5.2. Later comments do not independently reconfirm those versions.

| Date and source  | Feature and outcome                                                                                                                                                 | Versions, route and limits                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-10, [R1] | Reported working: discovery, stored snapshots, battery, person events and recording video/audio after reinstall. Reported problems: live view and session recovery. | R0 hardware. Client, bridge and integration versions of the test are unconfirmed. No complete stop/reopen or recovery proof.                                         |
| 2026-09-11, [R4] | Known reported problem: remote live visualization still fails.                                                                                                      | Reporter identifies Cloudflare Tunnel. A 0.6.4 diagnostic test was requested, but the installed component versions are not explicitly confirmed in the comment.      |
| 2026-09-11, [R5] | Reported working: live video in the iOS app. Known reported problem: live audio is absent.                                                                          | Attempt was the previous night. Exact app/component versions and that attempt's route are unspecified. This cannot establish success on every local or remote route. |
| 2026-09-11, [R6] | Reporter confirms sound was enabled. Audio remains a known reported problem.                                                                                        | No cause or fix is established by this comment.                                                                                                                      |
| 2026-09-11, [R7] | Software delivery: bridge/integration 0.7.1 adds video-only JPEG fallback and diagnostics. Reporter retest requested.                                               | No subsequent T8134 result at this review. JPEG fallback carries no audio. Local-audio diagnostics and session recovery remain separate obligations.                 |

Unknown component versions stay unknown. These observations do not upgrade any
feature to confirmed behavior. [Camera-10] retains the reporter investigation.
At this review, [#21], [#22] and [#56] held the software and validation
obligations. Keep successful and failed route observations together when
processing a new report.

## Discovery relationship evidence, 0.5.0

[Story #17][#17] adds [typed discovery and per-device errors](DISCOVERY.md).
This supersedes the historical C0 whole-inventory rejection behavior below.
Exact recognized model/type pairs retain their identities when a parent is
unsupported. T8134 with an empty or self parent has a private standalone owner
and an explicit `standalone_transport_unverified` operation error. It creates
no HomeBase entity. Unknown pairs remain unadmitted with `unsupported_device`.
[Regression tests](../test/discovery.test.mjs) prove this software boundary.
The dated feature rows and hardware claims below remain unchanged. Other owner
protocols and standalone authentication remained with [#35] and [#36] at 0.5.0.

## eufyCam software evidence, 0.6.0

[Story #19][#19] adds exact discovery, state and event coverage for all twelve
catalogued eufyCam model/type pairs on the existing T8030 owner profile.
[Per-model feature evidence](EUFYCAM.md) and [regressions](../test/eufycam.test.mjs)
supersede the historical unimplemented discovery/state/event cells for those
exact tuples only. This is software evidence. No hardware cell changes.
T8111/T8112 availability remains unknown and wired T8600 battery is not applicable.
The original 0.6.0 media guard is superseded only by the profile below. Older owners,
unresolved suffixes and hardware acceptance remained with [#35], [#55], [E2] and
[E6] at 0.6.0.

## eufyCam media evidence, 0.7.0

[Story #20][#20] adds [exact per-model media evidence](EUFYCAM.md#h3-core-media-070)
for the twelve eufyCam tuples above on the H3 local LAN-derived profile. The
new model guard also requires the documented owner firmware branch. Generic,
T8600 professional and T8172 outdoor pan/tilt live envelopes are separately
asserted. Snapshot, live video/audio forwarding, recordings and confirmed
stop/cancel have software fixtures. This supersedes the historical media B1/U
cells only for that exact profile. It assigns no new hardware evidence.
Unsupported firmware, models and topologies remain explicit. [#55], [#35],
[#36], [E2] and [E6] held the remaining obligations at 0.7.0.

## Exact T8213 hardware evidence, 2026-09-11

[Story #58][#58] records [dated hardware evidence][H58] for T8213 firmware
0.2.1.8 behind its actual T8030 firmware 3.8.6.0 on client 0.10.0 and
bridge/integration 0.7.1. Discovery, own reported state and battery, stored
snapshot, decoded live video/audio, confirmed stop, recording playback/seek,
in-flight cancellation, a real ring event and restart recovery are measured
separately. Other battery doorbell models retain the open obligations linked
from their rows. No firmware or owner variant inherits this acceptance.

## Battery doorbell software evidence, 0.8.0

[Story #25][#25] adds exact T8214/94, T8224/95 and T8223/96 discovery behind the
existing T8030 H3 owner. T8213/91 retains its existing route. All four select the
private battery doorbell adapter. [Per-model evidence](BATTERY_DOORBELLS.md) and
[regressions](../test/battery-doorbell.test.mjs) supersede the historical B1/U
state, battery, discovery and motion/person/ring cells for these exact H3 tuples
only. Available values are observations, never synthesized from connection state.
No hardware cell changes. The media profile below supersedes the 0.8.0 guard. Candidate
model/type 7/16 associations remain unadmitted. [#58], [#35], [#36] and [E2]
held those evidence and owner obligations at 0.8.0.

## Battery doorbell media evidence, 0.9.0

[Story #26][#26] adds [exact H3 media evidence](BATTERY_DOORBELLS.md#h3-core-media-090)
for T8214/94, T8224/95 and T8223/96 with the documented numeric T8030 owner
firmware branch. T8213/91 retains its existing route and gains regression coverage.
Separate E340 and generic C30/C31 live envelopes, stored snapshots, video/audio
forwarding, recording operations and acknowledged stop/cancel have software tests.
This supersedes historical B1/U media cells only for that exact profile. No H
cells change. [#58], [#35], [#36], [E2] and [E6] held hardware, other owners,
standalone and candidate inventory obligations at 0.9.0.

## Reported C30 type 96, 0.18.1

A reporter's bounded discovery report on
[ha-eufy-cam#40](https://github.com/keesmod/ha-eufy-cam/issues/40#issuecomment-5801839459),
posted on 2026-09-23 with bridge 0.8.25 and client 0.14.0, shows a C30 received as
T8224 with type 96, camera firmware 3.4.9.2, under a T8030 owner on firmware
3.8.5.2. Type 96 is the catalogue's C31 row below, and that row is unchanged.
[#183](https://github.com/keesmod/eufy-mega-client/issues/183) admits exactly this
received pair with the T8224/95 policy, as described in
[BATTERY_DOORBELLS.md](BATTERY_DOORBELLS.md#reported-c30-type-96-0181). This is a
reported inventory tuple, not a hardware observation. No H or P cell changes.

## Public T8210 and T8210C type 7 evidence, 0.30.1

[198-report] reports a Video Doorbell T8210 under a HomeBase 3 that the
integration does not list, without its received model, type or firmware. 0.30.1
admits exactly T8210/7 and T8210C/7 with the T8224/95 H3 policy on public
evidence from other clients, as described in
[BATTERY_DOORBELLS.md](BATTERY_DOORBELLS.md#public-t8210-and-t8210c-type-7-evidence-0301).
[HB3] lists T8210 as compatible with HomeBase 3. [T8210-legacy] is a 2023
inventory with T8210/7 on firmware 5.7.5 under a T8030. [Mega-134] is a Mega
inventory row with T8210/7 and category `eufy_security` under a HomeBase 2.
[T8210C-107] holds diagnostics with a received `device_model` of T8210C, type 7
and firmware 3.0.8.6 under a HomeBase 2. [T8210C-763] and [T8210C-302] describe
a T8210C under a T8030 without its received model or type. The [T8210-legacy]
property metadata maps its model to `device_model`, and the [T8210C-107] client
documents its field as the inventory entry's own `device_model`. This is not
shown for [Mega-134]. The received model of the reported row is not verified. Its
owner's T8210 label does not decide between the two codes. The type 7 rows
below record both codes as an experimental H3 software path. T8212 stays a B1/U
candidate. No H or P cell changes.

[198-report]: https://github.com/keesmod/ha-eufy-cam/issues/198
[T8210-legacy]: https://github.com/fuatakgun/eufy_security/issues/958#issuecomment-1799501814
[Mega-134]: https://github.com/mscodemonkey/eufy-mega-security/issues/134
[T8210C-107]: https://github.com/alaraun/homeassistant-eufy-home-security/issues/107
[T8210C-763]: https://github.com/bropat/eufy-security-client/pull/763
[T8210C-302]: https://github.com/mega-yfue/eufy-sdk/issues/302

## Reported T8113-Z and T8424, 0.26.0

A reporter on [ha-eufy-cam#129](https://github.com/keesmod/ha-eufy-cam/issues/129),
on 2026-09-25 and 2026-09-27 with bridge 0.8.28 and client 0.21.0, received three
eufyCam 2C cameras as `T8113-Z` with type 8, firmware 3.3.8, under a T8030 owner on
firmware 3.8.7.4, and a Floodlight Cam 2K as `T8424` with type 39, firmware
2.1.1.5, as its own station. With `T8113-Z` added locally as a copy of the T8113
profile, discovery accepted the three cameras and the reporter saw snapshots, live
view and HomeBase recordings working. With `T8424` added locally, discovery
reported the floodlight as `standalone_transport_unverified`, also after it was
assigned to the HomeBase 3 in the Eufy app. 0.26.0 admits exactly `T8113-Z`/8 with
the T8113 policy and recognizes `T8424`/39 as a standalone floodlight descriptor
without media, as in [FLOODLIGHT.md](FLOODLIGHT.md). These are reported inventory
tuples and a reported result, not independently reproduced. The catalogue rows
below and their H and P cells are unchanged.

## Reported issue #66 update, 0.28.2

On 2026-10-09 the [reporter of ha-eufy-cam#66][66-update] ran integration
0.8.41, bridge 0.8.32/client 0.28.0, HA OS with Core 2026.10 and a T8030 on
firmware 3.8.7.4. They reported snapshots, live and recordings working on
T8213 firmware 0.2.1.8 and T8161 firmware 3.4.3.0. This resolves the original
reported HomeBase connection failure for that environment. Audio, events,
confirmed stop/cancel and other features were not separately reported, so no
full hardware acceptance or new H/P cells are claimed.

The same update reports T8113-V/type 8 firmware 3.0.7.8 under that HomeBase,
rejected as `unsupported_device` and absent from HA. 0.28.2 admits exactly this
pair with the T8113 Camera adapter, H3 topology and media policy. Synthetic
fixtures cover discovery, state/events and snapshot/live/recording lifecycle.

On 2026-10-10 the reporter [ran integration 0.8.42][66-result] and bridge
0.8.33/client 0.28.2 on the same T8113-V firmware 3.0.7.8 under the T8030 on
firmware 3.8.7.4. They reported discovery as its own camera in HA, a snapshot,
live view, recording playback and motion events working. Audio, confirmed
stop/cancel and other event types were not reported separately. This is a
reported result, not independently reproduced. The T8113 feature row and its
cells are unchanged.

Standalone T84A1 firmware 1.1.0.4 is discovered, but snapshot/live/recordings
remain `standalone_transport_unverified`. The 2026-10-09 update supplies no
device type, authentication handshake or command lifecycle for this camera. Its
catalogue pair T84A1/151 and the blocked [standalone route #142][142] stay
unchanged. A route result followed on 2026-10-17, see
[Reported standalone T84A1 result, 2026-10-17](#reported-standalone-t84a1-result-2026-10-17).
T8920/type 20 and T87B0/type 157 are non-camera sensor/tracker products in the
pinned catalogue and remain outside camera discovery.

[66-update]: https://github.com/keesmod/ha-eufy-cam/issues/66#issuecomment-6083775017
[66-result]: https://github.com/keesmod/ha-eufy-cam/issues/66#issuecomment-6098838866
[142]: https://github.com/keesmod/eufy-mega-client/issues/142

## Experimental standalone T84A1, 0.29.0

For [#142][142] and the issue #66 reporter's offer to test, 0.29.0 adds the
opt-in client option `experimentalStandalone`. With it, a standalone T84A1/151
becomes its own local owner with experimental snapshot, live and recordings, as
described in [API.md](API.md#experimental-standalone-cameras) and
[WALLLIGHT.md](WALLLIGHT.md#experimental-standalone-s100-0290). Without it, the
standalone T84A1 keeps `standalone_transport_unverified`. Every standalone
relationship now reports which connection fields its row has, as presence
booleans. This is software evidence with synthetic rows. At 0.29.0 no standalone camera
had used the route and no T84A1 result on it was recorded. The first one is in
[Reported standalone T84A1 result, 2026-10-17](#reported-standalone-t84a1-result-2026-10-17).
The T84A1 row and its cells below are unchanged.

## Reported standalone T8410 and experimental route, 0.29.1

A reporter on [ha-eufy-cam#152][T8410-report], on 2026-10-10 with integration
0.8.43, bridge 0.8.34 and client 0.29.0 on HA OS amd64, has two T8410/type 31
cameras, which the reporter calls Indoor Cam Pan & Tilt, on firmware 2.3.2.4
and 2.3.1.6. Both are
standalone Wi-Fi cameras without a HomeBase, on the same subnet as the bridge.
With `experimental_standalone` enabled, discovery passed with both cameras
standalone and a complete descriptor: P2P device ID, license, administrator user
and LAN address present. Snapshot, live and recordings stayed
`standalone_transport_unverified` and no local session was attempted, because
0.29.0 admitted only the T84A1 profile to the opt-in route. This is a reported
inventory tuple and descriptor, not a media result, and not independently
reproduced. The report's diagnostic excerpt is empty. The exact pair therefore
rests on the descriptor, which discovery only creates for an exact profile match.

0.29.1 admits exactly T8410/31 with an empty or self parent to that route, as
described in [API.md](API.md#experimental-standalone-cameras) and
[INDOOR.md](INDOOR.md#experimental-standalone-t8410-0291). Without the option a
standalone T8410 keeps `standalone_transport_unverified`, and under a HomeBase it
keeps its H3 relationship and media. This is software evidence with synthetic
rows only. At 0.29.1 no standalone T8410 had used the route. The type 31 rows and their
cells below cover an H3 owner only and are unchanged.

[T8410-report]: https://github.com/keesmod/ha-eufy-cam/issues/152

## Reported standalone T8410 result, 2026-10-13

On 2026-10-13 the [same reporter][T8410-result] tried the experimental route on
both standalone T8410/31 cameras, mounted side by side on the same Wi-Fi, subnet
and bridge, with `experimental_standalone` on. The comment repeats the earlier
versions, integration 0.8.43, bridge 0.8.34 and client 0.29.0, with HA 2026.9.4
on HA OS amd64. Those versions do not admit a T8410 to the route, which needs
client 0.29.1 from bridge 0.8.35. The installed versions are therefore
unconfirmed.

- The camera on firmware 2.3.2.4 reached the `experimental` transport. A
  snapshot, live video and WebRTC playback were reported working, with 242
  frames through the software encoder in one session. Whether the snapshot was
  a stored cover or the last live frame was not reported. Live audio,
  recordings, events and the stop result were not reported. This client sends live START
  only after the camera's own session has set the LAN-derived command key. So
  this firmware answered the gateway information request and accepted that key
  and the `CMD_DOORBELL_SET_PAYLOAD` start described in
  [INDOOR.md](INDOOR.md#experimental-standalone-t8410-0291).
- The camera on firmware 2.3.1.6 failed live video on every attempt, also after
  restarts of the camera and the bridge. Its live pipeline ended with
  `fallback_startup_timeout`, 0 frames and 0 input bytes, and the event log had
  `device_request_timeout` for its reference. On a standalone owner, that code
  with a camera reference comes only from the bridge's discovery connection. It
  points to a connection that set no command key within the 20-second connect
  bound, so START was most likely never sent on the live attempts either. The
  connection stage followed in the report below.

These are reported results, not independently reproduced. The reporter sees the
firmware as the only difference. Nothing on this route branches on the firmware,
so a firmware cause is unproven. The type 31 rows below gain no H or P cells.

A [follow-up on the same day][T8410-lookup] gave the installed versions:
integration 0.8.46 and bridge 0.8.37 with client 0.29.2, on HA OS amd64 with
Node 24.21.0. In a fresh run with the Eufy app closed and no other client
connected, camera B's discovery connection ended at stage `lookup` with
`inventory_address: true`, so no lookup reply with its own DID was accepted.
Camera A connected in the same run. B's live attempt failed before its session
was ready. The Eufy app's own live view of B works, B is on and out of privacy
mode, both cameras use the same access point, and the app offers B no
firmware update. That download cannot show whether no reply arrived at all, a
reply with another or differently formatted DID was dropped, or the inventory
address belongs to another device. Client 0.30.0-beta.1 records that, as
described in the
[station lookup observation](API.md#station-lookup-observation-0300).

A [beta run on 2026-10-14][T8410-beta], reported with integration 0.8.47-beta.1
and bridge 0.8.38-beta.1 with client 0.30.0-beta.1, gave the same result.
Camera B's discovery connection again ended at stage `lookup` with
`device_request_timeout` and `inventory_address: true`, and camera A connected.
The reported record has none of the `lookup_*` fields that this bridge adds to a
connect that failed at `lookup`, and the reported `assessment` was `{}`, a shape
that no integration version produces. So the versions behind that download are
unconfirmed, and the lookup observation is still missing. The reporter also
corrected the topology. Both cameras connect over 2.4 GHz Wi-Fi to the same
FRITZ!Repeater 3000 mesh node, not to the router directly, and the HA host is
wired to the router. Every lookup round sends a direct request to the inventory
address, and camera A answers through the same repeater. A repeater that drops
broadcasts therefore does not explain B's result on its own.

On 2026-10-15 the [reporter confirmed][T8410-both] that those downloads came from
the stable bridge, which still held the bridge port. With the stable app stopped,
the beta app running and a new integration entry, the reported versions were
integration 0.8.47-beta.1 and bridge 0.8.38-beta.1 with client 0.30.0-beta.1.
Both standalone T8410/31 cameras then streamed live video. Camera B on firmware
2.3.1.6 also received a fresh snapshot, and both cameras report snapshot, live
and recordings as available and experimental. Recording playback was not
reported. B's live video implies that firmware 2.3.1.6 also answers the gateway
information request and accepts the LAN-derived key and the start command.

The same comment gives the lookup fields of an earlier beta run in which B failed
at `lookup`: 20 rounds with broadcasts enabled, 3 broadcast targets and no send
errors, and 38 datagrams, all lookup replies with the DID of another device in
the account. B sent no reply with its own DID, nothing answered from its
inventory address, and that address was on the bridge's subnet and not shared.
So the broadcasts reached other devices in the account, and no reply from B
reached the bridge in that run, neither to its direct requests nor to the
broadcasts. The beta changes no lookup target, timing, retry or DID check, so
B's later connection is not a beta fix. Why no reply from B arrived in that run
is unknown. On 2026-10-16 B showed the same pattern while it was unpowered, as
recorded [below](#reported-standalone-t8410-and-t8410c-results-2026-10-16).
Whether it was unpowered in that run is not known. The type 31 table row covers
an H3 owner only and is unchanged.

Also on 2026-10-15, the [same reporter][T8410-recordings] opened the recordings
of camera A, the standalone T8410/31 on firmware 2.3.2.4, which streams live
video like camera B, with bridge 0.8.38-beta.1 and client 0.30.0-beta.1. "Show recordings"
failed with the bridge code `recording_unavailable`, which the card showed as
"The HomeBase connection is unavailable. Try again shortly." The bridge maps
almost every client error of a recording operation to that code and records
none of them, so that report does not show the cause. The camera may not answer the database
query 10006, refuse it in its command result, send a reply the vendored session
cannot dispatch, reject the query, drop the session, or the operation may have
been refused before the query or failed to connect. Live video uses another
command, so it does not show whether the camera answers 10006. That query is
verified only on a HomeBase 3 so far. In the public analog
[bropat/eufy-security-client#963][bropat-963], a standalone E30 never
answered 10006. Client 0.30.1 adds the
[recording operation observation](API.md#recording-operation-observation-0301),
which tells these cases apart and counts returned rows with a cipher ID, whose
download a standalone owner refuses. Recording playback on the standalone route
was unconfirmed at that point, and the type 31 table row is unchanged. With that
observation both T8410 cameras acknowledged the query on 2026-10-16 but never
answered it, so recording playback on the standalone T8410 route does not work
with the current request, as recorded
[below](#reported-standalone-t8410-and-t8410c-results-2026-10-16).

[bropat-963]: https://github.com/bropat/eufy-security-client/issues/963
[T8410-result]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6140901994
[T8410-lookup]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6152282566
[T8410-beta]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6175148530
[T8410-both]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6188704752
[T8410-recordings]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6195646642

## Reported issue #149, 0.29.2

On 2026-10-09 the [reporter of ha-eufy-cam#149][149-report] ran HA 2026.10.0,
integration 0.8.42 and bridge 0.8.33/client 0.28.2 with a T8030 on firmware
3.8.7.4. They reported discovery, available state, battery and stored snapshots
working on three T8160 on firmware 3.4.3.0 and hardware 0.2.2.6, and live video
on one of them through the card on the LAN. A T8213 on firmware 0.2.1.8 was
discovered with state, battery and snapshots working. Other features were not
tested. These are reported results, not independently reproduced, and they add
no H or P cells.

The same report lists three rows rejected as `unsupported_device`, each with
parent status `present` and a T8030 parent on firmware 3.8.7.4:

- Row 4 is `T8160-C` with type 19, firmware 1.5.8.6 and hardware 0.0.3.7. The
  Eufy app shows it as a regular eufyCam 3.
- Rows 6 and 7 have type 31 and firmware 3.3.4.4, with model `unavailable`. The
  reporter labels them Indoor Cam Pan&Tilt 2K T8410.

0.29.2 admits exactly `T8160-C`/19 with the T8160 type and Camera adapter but
the additional-H3 media policy, not the established T8160 route, as described in
[EUFYCAM.md](EUFYCAM.md#reported-t8160-c-0292). Its firmware line differs from
the T8160 cameras, so the T8160 H cells below do not apply to it.

Rows 6 and 7 could not show their model on 0.28.2, because the received string
failed the diagnostic model bound of that version. T8410/31 was already
admitted, so the string was not exactly `T8410`. 0.29.2 admits exactly
`T8410C`/31 with the T8410 H3 policy without the experimental standalone flag,
as described in [INDOOR.md](INDOOR.md#indoor-cam-pantilt-2k-t8410c-0292). T8410C
is the evidence-based candidate for these rows. [HB-guide-EU] lists it as Indoor
Cam Pan&Tilt 2K on HomeBase 3. The numeric type comes from public inventory, not
from Eufy's pages. [bropat-722] reports a T8410C/31 on camera firmware 3.3.3.2
under a T8030, in a live start failure that upstream has since fixed. A public
Mega inventory log, [Mega-7], shows T8410C/31 with a parent next to a T8030/18
and a separate T8410/31. Both come from other clients. That they read the same
inventory field as this client is not verified. Plain T8410 firmware is on the
2.3.x line, as on the two ha-eufy-cam#152 cameras above. The reporter's firmware
3.3.4.4 fits T8410C. Their product name and their T8410 label do not decide it.
The rows cannot carry exactly `T8410`, and the [Mega-7] owner uses Indoor Cam
Pan&Tilt for both a T8410/31 and a T8410C/31. T8410C is not a confirmed received
value for these rows. 0.29.2 also widens the diagnostic model bound to unhyphenated codes such
as `T8410C`, as described in [DIAGNOSTICS.md](DIAGNOSTICS.md#missing-devices).
If these rows had carried another catalogue-shaped code of at most eight
characters, the next report would have shown it, provided the bridge and
integration applied the same bound. A value of another shape is still omitted.

On 2026-10-16 the reporter [reported][149-result] that after updating to
integration 0.8.45 and bridge 0.8.36/client 0.29.2 all devices appeared right
away and work with snapshots, live view, recordings and events. This includes
the T8160-C and rows 6 and 7, although the comment names no device, firmware or
event type separately. Audio, confirmed stop/cancel and restart recovery were
not reported. This is a reported result, not independently reproduced. The
type 19 and type 31 feature rows below gain no H or P cells.

The comment shows no received model for rows 6 and 7. Client 0.29.2 admits type
31 only as exactly `T8410` or `T8410C`, and 0.28.2 already admitted `T8410` when
it rejected these rows. Their appearance on 0.29.2 therefore points to exactly
`T8410C`, provided their inventory rows did not change in between.

The reporter also sees snapshots that are often out of date and live start
times that vary a lot, on all devices, and finds the Eufy app similar but a bit
more stable. A stored snapshot in this client is a previously stored image, not
a new exposure, as defined for the feature table below. The cause of the varying
start times is not established.

[149-report]: https://github.com/keesmod/ha-eufy-cam/issues/149
[149-result]: https://github.com/keesmod/ha-eufy-cam/issues/149#issuecomment-6214980737
[Mega-7]: https://github.com/mscodemonkey/eufy-mega-security/issues/7
[bropat-722]: https://github.com/bropat/eufy-security-client/issues/722

## Reported standalone T8410C and experimental route, 0.30.0

On 2026-10-15 the reporter of ha-eufy-cam#152 [reported][T8410C-report] a third
standalone camera, received as exactly `T8410C` with type 31 on firmware 3.3.4.4,
without a HomeBase and on the same LAN as their two standalone T8410/31 above.
They ran integration 0.8.47-beta.1, bridge 0.8.38-beta.1 and client
0.30.0-beta.1 with `experimental_standalone` on. Discovery made it standalone
with a complete descriptor: P2P device ID, license, administrator user and LAN
address present. Snapshot, live and recordings stayed
`standalone_transport_unverified` and no local session was attempted, because
the T8410C profile did not allow the opt-in route. Discovery only creates a
descriptor for an exact profile match, so the row is the exact pair `T8410C`/31.
This is a reported inventory tuple and descriptor, not a media result, and not
independently reproduced. It does not show which model rows 6 and 7 of the
[#149 report][149-report] carry. The #149 result of 2026-10-16
[above](#reported-issue-149-0292) points to `T8410C` for them.

0.30.0 admits exactly T8410C/31 with an empty or self parent to that route, as
described in [API.md](API.md#experimental-standalone-cameras) and
[INDOOR.md](INDOOR.md#experimental-standalone-t8410c-0300). Without the option a
standalone T8410C keeps `standalone_transport_unverified`, and under a HomeBase
it keeps its H3 relationship and media. For the standalone T8410C these states
stay separate:

- Recognition: the exact pair since 0.29.2, now also received from a standalone
  row.
- Experimental software coverage: the standalone route since 0.30.0, with
  synthetic rows only.
- Confirmed hardware support: none. At 0.30.0 no standalone T8410C had used the
  route, and the reporter's result was pending. Their result of 2026-10-16, live
  view and snapshot working on firmware 3.3.4.4, is recorded
  [below](#reported-standalone-t8410-and-t8410c-results-2026-10-16).

The T8410 results above come from firmware 2.3.2.4 and 2.3.1.6. T8410C firmware
is on the 3.3.x line, so they do not transfer to it. A failed connection is also
a valid result for this record. The type 31 rows below cover an H3 owner only
and gain no H or P cells.

[T8410C-report]: https://github.com/keesmod/ha-eufy-cam/issues/168#issuecomment-6189829101

## Reported standalone T8410 and T8410C results, 2026-10-16

On 2026-10-16 the reporter of ha-eufy-cam#152 [reported][standalone-results] on
all three standalone cameras above, with integration 0.8.48-beta.1, bridge 0.8.39-beta.1 and client 0.30.1-beta.1, with `experimental_standalone` on. All
live views were closed before each recordings test. The evidence is app log
lines from the bridge start on 2026-10-15 at 21:00 UTC to the recordings tests
on 2026-10-16, shortened to the relevant fields with values unchanged. There is
no diagnostics download. These are reported results, not independently
reproduced.

T8410C/31 on firmware 3.3.4.4, without a microSD card:

- At bridge start it connected after one lookup round with a reply with its own
  DID. Its device row had the `experimental` transport with its own owner
  connected.
- Live view worked. The snapshot worked, and the HA camera image returned a
  current frame.
- Both recording lists ended with `history_rejected` at stage `validate` after about 1
  second. The camera acknowledged the query with command result 0
  and answered it with database result -1100 and 0 rows. The Eufy app shows no
  recordings for this camera. The reporter suspects that the missing
  storage causes -1100. The vendored code names database result -1100
  [`ERROR_DB_NOT_READY`][DB-codes], which fits that reading but does not prove
  it. In [bropat-963] a standalone C37 with storage answered -1100 to the
  vendored 10017 query with non-default filter parameters, so -1100 does not
  only follow missing storage. For the 10017 listing the app declaration in
  [alaraun] names -118 for no card and -1008 for removed storage. The cause of
  -1100 here stays unproven. On 2026-10-23 a T8410 with a microSD card was
  reported to answer the 10017 probe with -1100 too, not independently
  reproduced, see the
  [probe results](#reported-standalone-recording-probe-results-2026-10-23).

T8410/31 camera A on firmware 2.3.2.4, with a microSD card and continuous
recording:

- Both recording lists ended with `device_request_timeout` at stage `query`
  after about 16 seconds, once on an open session and once after a new
  connection. The camera acknowledged the query with command result 0 and never
  answered it. No database reply that the session could not dispatch arrived.

T8410/31 camera B on firmware 2.3.1.6, with a microSD card and continuous
recording, which the reporter gave for both cameras [on 2026-10-15][T8410-recordings]:

- B was unpowered at bridge start and during its first recordings test. Both
  connections ended at stage `lookup` with `device_request_timeout` after 20
  rounds, with no reply with its own DID, 38 and 37 replies with the DID of
  another device in the account and no reply from its inventory address. That
  is the pattern of B's failed beta run in the
  [2026-10-13 record](#reported-standalone-t8410-result-2026-10-13), which that
  record leaves unexplained. Whether B was unpowered in that beta run is not
  known.
- After power was restored, live view worked. Both recording lists behaved as on
  camera A: command result 0, no answer and `device_request_timeout` at stage
  `query` after about 15.6 seconds, without unhandled database replies.

In the Eufy app both T8410 cameras show only a continuous timeline, without
separate event clips. Neither T8410 answered a recording list, so recording
playback on the standalone T8410 route does not work with the current request.

Readings, not proven causes:

- On firmware 2.3.x a standalone T8410 accepts the `CMD_DATABASE` query 10006 on
  `history_record_info` but does not answer it. That is consistent with the
  public analog [bropat-963], where a standalone E30 never answered 10006, and
  with recording that is continuous only. Which request the camera answers for its continuous timeline is unknown.
- The standalone T8410C on firmware 3.3.4.4 answers 10006 and rejects it with
  -1100 without a card. Whether it returns rows with a microSD card is unknown.

For these standalone cameras the states stay separate:

- Recognition: the exact pairs `T8410`/31 and `T8410C`/31, received from
  standalone rows with a complete descriptor.
- Experimental software coverage: the standalone route since 0.29.1 for the
  T8410 and since 0.30.0 for the T8410C, and the
  [recording operation observation](API.md#recording-operation-observation-0301)
  since 0.30.1, with synthetic rows only.
- Reported hardware results: live view on all three cameras, a snapshot on the
  T8410C here and on both T8410 cameras in the reports above, and no working
  recording list on any of them.

This gives ha-eufy-cam#168 its hardware result: the standalone T8410C route
was reported working for live view and snapshot on firmware 3.3.4.4. For ha-eufy-cam#152 the
standalone T8410 route was reported working for live view and snapshot on
firmware 2.3.2.4 and 2.3.1.6. Standalone
recordings moved to [ha-eufy-cam#175][175], with the outcome below. The type 31
rows below cover an H3 owner only and gain no H or P cells.

### Standalone recordings outcome, 0.30.1

For [ha-eufy-cam#175][175] no request has enough evidence to list and play
recordings on a standalone T84xx camera. Client 0.30.1 therefore reports
recordings as unavailable for every experimental standalone owner, the T84A1,
T8410 and T8410C, with `{ available: false, status: 'unsupported', reason:
'standalone_recordings_unverified' }`, as described in
[API.md](API.md#experimental-standalone-cameras). A thumbnail or download is
refused at stage `admission` before any connection. Snapshot and live stay
experimental. That decision leaves HomeBase owners, their payloads and code
paths as they are and sends no new device request. The library list and
calendar calls stay without that gate and still send 10006 or 10008 on a
standalone owner, as with 0.30.0. Both report the
[recording operation observation](API.md#recording-operation-observation-0301),
also new in 0.30.1. The opt-in probe of candidate 1 below reuses the observation.
This is a software decision on the reports above and the public sources below,
not a new hardware result. The type 31 and 151 rows gain no cells.

The candidates were ranked as follows. Each source is marked with its kind of
claim: a reported hardware result, a hardware claim in code, an app declaration
from decompiled app data, or a protocol name without a body. None covers a T84xx
camera.

1. The app-shaped `CMD_DATABASE_QUERY_LOCAL` 10017 on `history_record_info`:
   level-1 command 1350 with inner 1306, `mChannel` 0, frame channel 0, one page
   of 20 rows for one day, `start_time` `"0"` as the first-page cursor and no
   `device_info`.
   - Reported hardware result, public report only: [peakwell] captured the
     iPhone app on a standalone T86P2 and got rows for this query, while the
     same camera acknowledged 10006 with 0 and never answered it
     (`docs/RECORDINGS_RESEARCH.md` section 2 and
     `docs/fixtures/recordings-local-observations.json` at `4c21849`). That
     repository has no licence. It is cited as a report, and nothing from it is
     copied.
   - Hardware claim in code, MIT: [mega-security] limits a variant with
     `device_info` naming the camera and level-2 encryption to the standalone
     T8171 and T817L as a verified route (`first-party-ppcs.ts` lines 2283 to
     2296 at `603e668`).
   - App declaration, MIT, not hardware: [alaraun] reads that the app sends
     10017 for every model whose thing description lacks
     `query_event_list_cmd`, and its T8410 description lacks it while the T8030
     one has it (`docs/protocol/commands.md` at `a729675`).
   - Reported hardware result: in [bropat-963] a standalone E30 answered the
     vendored 10017 query with return code 0 and empty data while it never
     answered 10006. That is the vendored shape, which the client's vendored
     builder also sends, so a probe needs its own payload.
   - Against it at 0.30.1: no T84xx result, and the reporter's T8410 cameras
     keep no event clips, so the realistic answer was an empty page. Nothing
     shows that continuous footage is stored in `history_record_info`. A
     standalone owner also has no playback path, see below. The first T84xx
     results, with one listed record on a T8410, were reported on 2026-10-23,
     not independently reproduced, see the
     [probe results](#reported-standalone-recording-probe-results-2026-10-23).
   - Verdict: the next request to probe, read-only and bounded to one page and
     15 seconds, but not enough for list and play now. Since 0.30.1 the
     client can send it, see the
     [standalone recording probe](#standalone-recording-probe-ha-eufy-cam178).
2. `CMD_DATABASE_COUNT_BY_DATE` 10008 through the existing calendar. Reported
   hardware result, public report only: [peakwell] got a day index from the
   standalone T86P2 whose dates ignored the requested range. A HomeBase 3
   answers it too. Diagnostic only, because it lists nothing and cannot play.
3. `CMD_DATABASE_QUERY_LATEST_INFO` 10013, which the vendored Station already
   sends at every connect. Reported hardware results on a standalone E30 and C37
   in [bropat-963] and on a standalone S340, a T8170, in [ws-545] and [alaraun].
   Diagnostic only, one crop path and an event count per device. Not shown on
   the T8410, because the reported snapshots may be live frames.
4. The continuous range query, outer command 1700 with `commandType` 6000 and
   the camera serial and a time range, answered on 1351, then 6001 for playback.
   Reported hardware result only on a HomeBase 3 T8030 with a T8600, validated
   on 2026-09-10 in [ferryhe] (MIT, `capabilities/recordings/CONTINUOUS_PLAYBACK.md`).
   It fits the reporter's continuous timeline, but nothing covers a standalone
   or T84xx camera, the meaning of 6000 there is unknown and the client has no
   parser for its 1351 reply. Not now.
5. Variants of 10006: `device_info` with the camera's own serial, channel 255,
   or the extra fields `start_id`, `end_id`, `need_ai`, `update_time` and
   `alarm_id`. Every source concerns a HomeBase. The channel 255 default in
   [eufy-sdk] (`p2p-session.ts` line 1732 at `7d1f016`) is a code claim with
   HomeBase provenance. The fields are what [alaraun] reports for 10000 on a
   HomeBase 3. In a HomeBase 2 matrix in [ha-eufy-sdk-120] neither channel 0 nor
   255 got an answer to the direct read 10000. 10006 stays silent on the
   standalone T86P2 and E30, and the observation cannot tell the variants apart.
   Low expected yield.
6. `CMD_RECORDDATE_SEARCH` 1041, `CMD_RECORDLIST_SEARCH` 1042,
   `CMD_RECORD_VIEW` 1025 and `CMD_RECORD_PLAY_CTRL` 1026. Protocol names
   without a body: only the [vendored enum names][Record-commands] exist, with
   no public request body, reply or capture. Their neighbours are destructive,
   1027 deletes a record, 1029 formats the card and 1057 repairs it. Rejected,
   because they fail both the evidence and the safety bar.

Playback has no client path on a standalone owner. The client refuses a
download of a record with any cipher ID, also 0. The vendored decrypt of
encrypted recording frames needs an RSA private key, and the client has none
for a standalone owner. A public report in [peakwell] describes another derived
key, from an unlicensed source, so it is not used. In [eufy-sdk-385] the keyframes of a standalone
SoloCam S220 recording could not be decoded.

Open at 0.30.1: whether a standalone T8410 on firmware 2.3.x answers the
app-shaped 10017 at all, with an empty page, a database error such as -1100,
-118 or -1008, or silence. On 2026-10-23 the reporter of ha-eufy-cam#152
reported that both T8410 cameras, on 2.3.2.4 and 2.3.1.6, answered it, one with
an empty page and one with -1100. These are reported results, not independently
reproduced, recorded in the
[probe results of 2026-10-23](#reported-standalone-recording-probe-results-2026-10-23).
The probe below sends it. It is best run on a standalone camera with event
recordings. On the current reporter's cameras it is diagnostic only. A
reply under another outer command, such as 1351, or as a DATA frame would not
show in the observation. A dropped or unaligned 1306 CONTROL reply is ruled out,
because it would count as an unhandled reply. A probe does not count one that
names the latest-info query 10013.

#### Standalone recording probe (ha-eufy-cam#178)

For [ha-eufy-cam#178][178], client 0.30.1 adds `probeStandaloneRecordings`. It sends candidate 1 once to an experimental standalone T84A1, T8410 or T8410C: command
1350 with inner 1306 and 10017 on `history_record_info`, `mChannel` 0 and frame
channel 0, at most 20 records of the process's local day, `start_time` `"0"`, no
`device_info` and no `res_unzip`. The exact request, its bounds and its codes
are in [API.md](API.md#standalone-recording-probe-0301). Only channel 0 is
sent. The channel 255 of candidate 5 has HomeBase provenance only. The probe is
read-only, creates no recording ID and leaves the recordings capability
unavailable. The probe leaves HomeBase owners and their payloads as they are.
A bridge sends
it only on an explicit opt-in.

The first results, for the T8410 and the T8410C, are recorded in
[the probe results of 2026-10-23](#reported-standalone-recording-probe-results-2026-10-23).
No T84A1 result has been reported. Each model's result, a failure included, is
recorded with model, firmware,
microSD and recording mode where known, bridge and client versions and the
observation's code, stage, `ackCode`, `resultCode`, `rows`, `rowClasses` and
unhandled replies. Readings for this matrix: an answer with database result 0
shows that the model answers 10017 on this route, and `rows` with
`rowClasses.own` above 0 shows that it lists records there. An empty page proves
only the answer, not that no footage exists, because the probe asks for one day
and nothing shows that continuous footage is stored in `history_record_info`.
`history_rejected` carries the database result, for example -1100, which is
[`ERROR_DB_NOT_READY`][DB-codes] by its vendored name. Silence with `ackCode` 0
and no unhandled reply reads as for 10006 above: the camera accepts the request
and does not answer it. A 10017 reply the session cannot parse counts as an
unhandled reply with `parse_error`. None of these opens recordings for a model.
That stays a separate decision, and a standalone owner still has no playback
path.

[standalone-results]: https://github.com/keesmod/ha-eufy-cam/issues/152#issuecomment-6208097780
[175]: https://github.com/keesmod/ha-eufy-cam/issues/175
[178]: https://github.com/keesmod/ha-eufy-cam/issues/178
[DB-codes]: https://github.com/keesmod/eufy-mega-client/blob/497aed8a2ca40f3ff62727aea85ed2e0e1c92b75/vendor/src/p2p/types.ts#L1054-L1056
[Record-commands]: https://github.com/keesmod/eufy-mega-client/blob/497aed8a2ca40f3ff62727aea85ed2e0e1c92b75/vendor/src/p2p/types.ts#L253-L259
[peakwell]: https://github.com/peakwellnv/eufy-bridge/tree/4c2184930d4019203f21c61eb9b08746c236cc30
[mega-security]: https://github.com/mscodemonkey/eufy-mega-security/tree/603e66830cb57a4ff2394134e3ac89482f9bb54d
[alaraun]: https://github.com/alaraun/python-eufy-home-security/tree/a729675dfb20153822422bd6c4b893723bce9093
[ferryhe]: https://github.com/ferryhe/eufy-agent-hub
[eufy-sdk]: https://github.com/mega-yfue/eufy-sdk/tree/7d1f016362465b0747405c5dc83124c86b2c630b
[eufy-sdk-385]: https://github.com/mega-yfue/eufy-sdk/issues/385
[ha-eufy-sdk-120]: https://github.com/mega-yfue/ha-eufy-sdk/issues/120
[ws-545]: https://github.com/bropat/eufy-security-ws/issues/545

## Reported standalone T84A1 result, 2026-10-17

On 2026-10-17 the issue #66 reporter [reported][T84A1-result] on [#142][142] the
first result of a standalone T84A1 on the experimental route. The setup was
integration 0.8.47 and bridge 0.8.38 with client 0.30.0 on HA OS amd64, with
`experimental_standalone` and `diagnostics` on and the app restarted after
enabling the option. The camera is a Wall Light Cam S100 `T84A1` on firmware
1.1.0.4 without a HomeBase. The comment mentions a diagnostics download, but
none is attached. The evidence is the field values quoted in the comment. This
is a reported result, not independently reproduced.

- Discovery gave the camera the relationship `standalone` with the
  `experimental` transport and a complete descriptor: P2P device ID, license,
  administrator user and LAN address present. Discovery creates that
  relationship only for an exact profile match, so the row is the exact pair
  `T84A1`/151.
- Its `station_connection` record of phase `connect` was `connected` after a
  lookup reply with its own DID (`lookup_own_replies` 1,
  `lookup_inventory_reply` `own`), and its inventory address was in the bridge's
  subnet.
- A snapshot worked. Whether it was a stored cover or the last live frame was
  not reported.
- Live view worked as H.264 with audio over several sessions on two days. This
  is the first standalone report that names live audio.
- Recordings were not tested. Since 0.30.1 they report
  `standalone_recordings_unverified` on this route. The stop result was not
  reported. Client 0.30.0 admits no events on the route, see
  [standalone T84A1 events](#standalone-t84a1-events-0301) below.

This client sends live START only after the camera's own session has set the
LAN-derived command key. So firmware 1.1.0.4 answered the gateway information
request and accepted that key and the Wall-light `CMD_DOORBELL_SET_PAYLOAD`
start described in [WALLLIGHT.md](WALLLIGHT.md#experimental-standalone-s100-0290).

By the same comment the camera never connected with bridge 0.8.37 and client
0.29.2. No stage or download from those runs was posted. Client 0.30.0 changes
the lookup only by observation, with counters, account DIDs and the subnet
check. Its targets, timing, retries, accepted DID, handshake and key are
unchanged. Bridge 0.8.38 releases a camera whose live start failed before START
was issued ([ha-eufy-cam#164][164]), where 0.8.37 kept it blocked until a bridge
restart. Whether that played a part is unknown. The later connection is not
shown to come from a fix, and the cause of the earlier failure is unknown.

For this camera the states stay separate:

- Recognition: the exact pair `T84A1`/151, received from a standalone row with a
  complete descriptor.
- Experimental software coverage: the standalone route since 0.29.0, with
  synthetic rows only.
- Reported hardware results: connection, snapshot and live video with audio on
  firmware 1.1.0.4. No recording, stop or event result.

The type 151 rows below cover an H3 owner only and gain no H or P cells. The
reporter stores event clips on the camera's built-in storage and offered to run
the [standalone recording probe](#standalone-recording-probe-ha-eufy-cam178).
Motion and person events for this camera are requested in
[ha-eufy-cam#185][185].

[T84A1-result]: https://github.com/keesmod/eufy-mega-client/issues/142#issuecomment-6236984885
[164]: https://github.com/keesmod/ha-eufy-cam/pull/164
[185]: https://github.com/keesmod/ha-eufy-cam/issues/185

### Standalone T84A1 events, 0.30.1

The [2026-10-17 result](#reported-standalone-t84a1-result-2026-10-17) above
showed connection, snapshot and live video with audio. It had no event result,
because the route admitted no events then. By the same comment the camera logs
motion and person events in the Eufy app with push enabled on the bridge
account. Whether Eufy delivers those pushes to the bridge account is unknown.

For [ha-eufy-cam#185][185], client 0.30.1 admits the numeric 3101 motion and
3102 person pushes of a standalone T84A1 whose type is 151 and whose device and
station serials both name the camera. Every other push and every T8410 and
T8410C push stays refused. No standalone push reaches the vendored station push
handler, loads an image, sends 10013 or opens a connection.
`standalonePushStatus` counts the pushes by outcome, source, event code and
push type, with numbers only, as described in
[API.md](API.md#standalone-events-and-push-observation-0301).

This is synthetic coverage only. No standalone T84A1 push has been captured,
so the admitted shape follows the vendored type 151 decoding. No hardware event
result is recorded yet, and the type 151 feature cells stay unchanged until the
reporter's beta result is recorded here under ha-eufy-cam#185, with the
observation counts.

## Reported standalone recording probe results, 2026-10-23

On 2026-10-23 the reporter of ha-eufy-cam#152 [reported][probe-results] on
[ha-eufy-cam#178][178] the
[standalone recording probe](#standalone-recording-probe-ha-eufy-cam178) of
the three standalone cameras recorded
[above](#reported-standalone-t8410-and-t8410c-results-2026-10-16). The run used
integration 0.8.48 and bridge 0.8.39 with client 0.30.1, in the beta app, which
then carried the stable bridge, with `experimental_standalone` and
`standalone_recording_probe` on and no other bridge app running. The comment
also quotes two probe records of an earlier run on 2026-10-19 in the beta app.
Those records carry no version. The newest beta then was bridge 0.8.39-beta.5
with client 0.30.1-beta.4. The evidence is the bridge's `recording_query`
records with `query=probe` and its `connection` and `summary` records of
2026-10-23, quoted verbatim, the reporter's statement of versions and app setup
and of model, firmware and microSD card per camera, and the reporter's summary
of one failed connection, for which no record is quoted. These are reported
results, not independently reproduced.

Every quoted probe was answered within 400 ms on the session of the login
discovery, with one page of at most 20 records and no unhandled reply.

On 2026-10-23:

- T8410C/31 on firmware 3.3.4.4, without a microSD card: `history_rejected` at
  `validate` after 155 ms, with `ackCode` 0, database result -1100 and 0 rows,
  as for its 10006 list on 2026-10-16.
- T8410/31 camera A on firmware 2.3.2.4, with a microSD card: answered after
  362 ms with database result 0 and an empty page, with `ackCode` null.
- T8410/31 camera B on firmware 2.3.1.6, with a microSD card:
  `history_rejected` at `validate` after 396 ms, with `ackCode` null, database
  result -1100 and 0 rows.

By the reporter's summary, with no `station_connection` record quoted, camera
B's connection ended once at stage `lookup` at the first start after the beta
app updated to bridge 0.8.39, before the probe run and with the probe off. It
timed out with `device_request_timeout` after 20 rounds, with no reply with its
own DID and 37 replies with the DID of another device in the account. The
comment gives no date for that start. Camera B connected at the next start, and all three
cameras connected in the probe run. Its power state at the failed start was not
reported.

On 2026-10-19:

- The T8410C: `history_rejected` with `ackCode` 0, database result -1100 and 0
  rows, as on 2026-10-23.
- One T8410: answered after 249 ms with database result 0 and one record, with
  `ackCode` 0. `rowClasses` counts it as `own`, with a valid start on the
  requested day, a valid end time and a cipher ID field. Which of the two T8410
  cameras it was is not known, because `device_ref` follows the inventory order
  of each report and that order changed between the runs. The comment has no
  record of the third camera from that run.

Readings, not proven causes:

- Both T8410 cameras and the T8410C answer the app-shaped 10017 on this route.
  Neither T8410 answered the 10006 list on 2026-10-16, so 10017 is the first
  recording list a standalone T8410 is known to have answered.
- A standalone T8410 lists records through 10017: one of its own on
  2026-10-19. That is the first record listed on the standalone T84xx route,
  against the empty page that
  [candidate 1](#standalone-recordings-outcome-0301) expected for cameras
  without event clips. Whether the record is an event clip or part of the
  continuous recording is not known.
- Camera A's empty page shows only that it answered. By the reporter
  [on 2026-10-15][T8410-recordings] both T8410 cameras record continuously to
  their own storage, so the one-day bound alone does not explain the empty page. Nothing shows that 10017 lists continuous footage from
  `history_record_info`.
- Camera B answered -1100 with a microSD card, so on this route -1100 does not
  follow only from missing storage. Its vendored name is
  [`ERROR_DB_NOT_READY`][DB-codes], and its cause stays unproven.
- `ackCode` null on an answered probe says only that the session reported no
  command result before the answer. The command result and the database answer
  arrive as separate messages in no fixed order, and the observation ends with
  the answer. It shows neither a refusal nor silence.

Recordings stay unavailable with `standalone_recordings_unverified` on the
T8410 and the T8410C. ha-eufy-cam#178 left opening them for a model whose
10017 lists rows to a separate decision. This record does not support opening
them:

- The recordings capability means the complete media workflow, see
  [CAMERA_CAPABILITIES.md](CAMERA_CAPABILITIES.md), and a standalone owner has
  no playback path, see the
  [recordings outcome](#standalone-recordings-outcome-0301). A download of a
  record with a cipher ID would need a cloud cipher, which the client does not
  fetch, and the listed record's history row carries a cipher ID field.
- One record in three quoted T8410 probes over two runs, each limited to the
  day of its run, with an empty page and a rejection in the others, is too
  little evidence to open recordings.

Opening recordings on this route would first need a playback path for
standalone records, which was outside ha-eufy-cam#178. No T84A1 probe result
has been reported. The type 31 rows below cover an H3 owner only and gain no H
or P cells.

[probe-results]: https://github.com/keesmod/ha-eufy-cam/issues/178#issuecomment-6372936541

## Reported standalone T8424 attempt, 2026-10-24

On 2026-10-24 the [ha-eufy-cam#129][129] reporter [reported][T8424-result] on
[#142][142] a standalone Floodlight Cam 2K `T8424`/39 on firmware 2.1.1.5, mains
powered, on the experimental route. The setup was integration 0.8.48 and bridge
0.8.39 with client 0.30.1 in Docker with host networking, with
`EUFY_EXPERIMENTAL_STANDALONE` and `EUFY_DIAGNOSTICS` on. The same bridge serves
the reporter's HomeBase 3 on firmware 3.8.7.4 with three `T8113-Z`, which kept
working. Client 0.30.1 does not admit `T8424` on the route. The reporter added
the pair locally with the floodlight profile and `experimentalStandalone`. The
evidence is the field values quoted in the comment, without a download. This is
a reported result, not independently reproduced.

- Discovery gave the camera the relationship `standalone` with the
  `experimental` transport and a complete descriptor. Its parent status was
  `self`. Whether the camera was assigned to the HomeBase 3 as its storage
  target during this test was not stated.
- The lookup got one reply with the camera's own DID from its inventory
  address, which was in the bridge's subnet, without send errors.
- The startup `station_connection` record of phase `connect` was `error` with
  `device_request_timeout` at stage `session_open`, about 20 seconds after the
  lookup. The bridge made no further attempt, and no snapshot or live view was
  tried.

So the camera completed the handshake, and the attempt ran out the 20-second
connection deadline without the command key. The T84A1, T8410 and T8410C on this
route answered the same gateway information request and accepted the LAN-derived
key. A credential failure after an answer would have ended with
`device_disconnected`. The bridge 0.8.39 record does not carry the time of the
`session_open` stage, which the stage's `elapsedMs` provides, so a handshake late
in the deadline is not ruled out. Client 0.30.1 also cannot tell a request the
camera never acknowledged from one it acknowledged without an answer. The
[key setup observation](API.md#station-key-setup-observation-0302) in 0.30.2
separates those two for the next attempt.

On 2026-10-25 the reporter [repeated][T8424-key-setup] the attempt with bridge
0.8.40-beta.1 and client 0.30.2-beta.1, integration 0.8.48, the same local
profile entry and settings. The camera was assigned to the HomeBase 3 as its
storage target, and the Eufy app was closed. The evidence is one quoted
`station_connection` record of counts and booleans.

- The attempt again ended with `device_request_timeout` at stage
  `session_open`. The session opened 10 ms after the attempt started.
- The camera acknowledged the key request, which was sent twice, and sent no
  key answer. The 5-second answer wait did not expire.
- Before the deadline the session received 32 DATA datagrams, 5 complete
  messages that were not a key answer and 22 heartbeats. The camera did not end
  the session.

While the session stays open, only a command result on the DATA channel with
the key request's command and sequence stops that answer wait in this client
without a key. A test shows that such a result produces this combination of an
acknowledged request, no answer and no expired wait. This is a reading of the
code, not a decoded message. Its return code and the commands of the other messages are not
in the 0.30.2-beta.1 observation. The [key setup
observation](API.md#station-key-setup-observation-0302) of 0.30.2-beta.2 adds
them.

On 2026-10-25 the reporter [repeated][T8424-result-code] the attempt with bridge
0.8.40-beta.2 and client 0.30.2-beta.2 under the same conditions. The attempt
again ended with `device_request_timeout` at `session_open`. The session opened
12 ms after the attempt started.

- The camera answered the key request with one unencrypted command result with
  return code 0 and sent no key answer.
- The first three distinct commands of the other messages were that result,
  1350 (`CMD_SET_PAYLOAD`) and 1306 (`CMD_DATABASE`). Two of the five other
  messages arrived on the CONTROL channel. No media datagram arrived, and one
  DATA datagram was a resend.

So the camera accepts the key request and offers no key or cipher. For type 39
the station queues a database query, 1350 around 1306, when it connects. The
result released that query before any key, so it left unencrypted. The 1350 and
1306 messages are most likely the camera's answer to it. That is a reading of
the code, not a decoded message. Two explanations remain. The camera may expect
the LAN-derived key, which does not depend on the answer in that mode, or it may
work without command encryption, as an upstream session without a key answer
keeps doing. 0.30.2-beta.3 let an experimental standalone camera set the
LAN-derived key itself after such a result and held its queued commands until
then.

On 2026-10-26 the reporter [tested][T8424-beta3] bridge 0.8.40-beta.3 with client
0.30.2-beta.3 under the same conditions.

- The T8424 connected. `keyWithoutAnswer` was true and `signedMessages` 0, so
  none of the camera's messages before the key was encrypted.
- Two live view attempts got return code -100 (`ERROR_NULL_POINT`) for the
  encrypted live start within 24 to 39 ms, and no video. Each ended after about
  20 seconds.
- No snapshot arrived. The database query left encrypted this time. The same
  query sent unencrypted in beta.2 was most likely answered.

So the T8424 on firmware 2.1.1.5 most likely does not use command encryption.
The maintainer decided on 2026-10-26 that such a camera goes on without a command
key. 0.30.2-beta.4 does that for an experimental standalone camera after a
successful result without a key answer, see
[the key setup observation](API.md#station-key-setup-observation-0302).

On 2026-10-26 the reporter [tested][T8424-beta4] bridge 0.8.40-beta.4 with client
0.30.2-beta.4 under the same conditions, built without the Docker layer cache.

- The T8424 connected without a command key, with `keyWithoutAnswer` true.
- A snapshot arrived in Home Assistant.
- A 40-second live view from the viewer card started with return code 0, gave
  H.264 metadata after 180 ms and 561 frames without drops, with audio input. One
  decode error appeared after about 5 seconds and the video kept running.
- The HomeBase 3 cameras on the same bridge kept working.

On 2026-10-27 the reporter [confirmed][T8424-stable] the stable release with
bridge 0.8.40, client 0.30.2 and integration 0.8.49, built without the Docker
layer cache, without the local profile entry and with
`EUFY_EXPERIMENTAL_STANDALONE=true`.

- The T8424 connected on the experimental route.
- A snapshot arrived.
- Live view started with return code 0 and gave 220 frames in about 16 seconds
  without drops, with audio.
- The HomeBase 3 cameras on the same bridge kept working.

0.30.2 admits exactly `T8424`/39 with an empty or self parent to the
experimental route, as described in
[API.md](API.md#experimental-standalone-cameras) and
[FLOODLIGHT.md](FLOODLIGHT.md#experimental-standalone-t8424-0302). Without the
option it keeps `standalone_transport_unverified`, and an H3 parent still returns
`unsupported_station`. For this camera the states stay separate:

- Recognition: the exact pair `T8424`/39 as a standalone floodlight descriptor
  since 0.26.0.
- Experimental software coverage: the standalone route since 0.30.2, with
  synthetic rows only, and commands without encryption after a successful key
  request result without a key.
- Confirmed hardware support: none. Reported: snapshot and live view with audio
  on firmware 2.1.1.5 with client 0.30.2 without a local profile entry, not
  independently reproduced. No recording or event result. Other firmware is
  unknown.

[129]: https://github.com/keesmod/ha-eufy-cam/issues/129
[T8424-result]: https://github.com/keesmod/eufy-mega-client/issues/142#issuecomment-6385997225
[T8424-key-setup]: https://github.com/keesmod/eufy-mega-client/issues/142#issuecomment-6397104597
[T8424-result-code]: https://github.com/keesmod/eufy-mega-client/issues/142#issuecomment-6400175091
[T8424-beta3]: https://github.com/keesmod/eufy-mega-client/issues/142#issuecomment-6410128247
[T8424-beta4]: https://github.com/keesmod/eufy-mega-client/issues/142#issuecomment-6422927610
[T8424-stable]: https://github.com/keesmod/eufy-mega-client/issues/142#issuecomment-6436025222

## Reported T8142-Z, 0.30.3

On 2026-10-31 the [reporter of ha-eufy-cam#236][236-report] ran HA 2026.10.4,
integration 0.8.49 and bridge 0.8.40/client 0.30.2 with a T8030 on firmware
3.8.7.4. Three cameras that the reporter names eufyCam 2C Pro were rejected as
`unsupported_device` with parent status `present`. Each was received as
`T8142-Z` with type 15 and firmware 3.3.8. 0.30.3 admits exactly `T8142-Z`/15
with the T8142 type and Camera adapter but the additional-H3 media policy, not
the established T8142 route, as described in
[EUFYCAM.md](EUFYCAM.md#reported-t8142-z-0303). This is a reported inventory
tuple, not independently reproduced. No result with the admission is reported
yet, and the type 15 rows below gain no H or P cells.

[236-report]: https://github.com/keesmod/ha-eufy-cam/issues/236

## Reported T817L Wired Cam C31, 0.28.0

A reporter on [ha-eufy-cam#136][C31-report], on 2026-10-04 with bridge 0.8.29 and
client 0.26.0, receives a Wired Cam C31 as `T817L` with type 10031, firmware
2.1.0.3, under a T8030 owner on firmware 3.8.5.2. The pair was not in the profile
allowlist, so discovery reported `unsupported_device`. Type 10031 was also absent
from the pinned catalogue. 0.28.0 adds
`WIRED_CAM_C31` to the vendored catalogue and admits exactly `T817L`/10031 in the
indoor family with the additional-H3 media policy, as described in
[INDOOR.md](INDOOR.md#wired-cam-c31-0280). [C31] names the product, its
detections and its HomeBase 3 and HomeBase Mini compatibility. [C31-standalone]
shows the same pair as its own station. A separate MIT project records live view
and snapshots through a T8030, linked from INDOOR.md. These are a reported
inventory tuple and third-party results, not observations through this client.
The new rows below are software evidence only.

On 2026-10-05 the same reporter ran bridge 0.8.30 with client 0.28.0 and
integration 0.8.38 on that tuple and reported [C31-result] discovery under the
HomeBase 3, a snapshot, live video and audio, a confirmed live stop, recording lists and
playback, and a person event working. Motion, pet, vehicle, sound and crying
events were not reported. This is a reported result, not independently
reproduced. The feature row and its cells are unchanged.

## SoloCam software evidence, 0.11.0

[Story #21][#21] adds [exact SoloCam discovery/state/event evidence](SOLOCAM.md)
for ten model/type pairs on the existing T8030 owner. The SoloCamera adapter,
observed values, correct owner/channel, native push decoding and duplicate
suppression have [per-model regressions](../test/solocam.test.mjs). T8134 retains
its existing media admission and dated community evidence. Other SoloCam media
remained guarded in 0.11.0. The 0.12.0 profile below supersedes that guard for its
exact connection scope. No hardware claim changes.

The updated SoloCam rows below evaluate H3 only. Standalone descriptors identify
the camera as owner but remain `standalone_transport_unverified`, without a
station or operation path. At 0.11.0, [#36] held transport research, [#35]
other owners and [#56] hardware and unresolved model variants. T8124V/R remain
unadmitted. [Camera-10] retains the original reporter investigation and
requested retest.

## SoloCam media evidence, 0.12.0

[Story #22][#22] extends the existing H3 media admission to the nine additional
exact SoloCam pairs in [Solo-software]. T8134 retains its established path.
Existing SoloCam and pan/tilt command envelopes, snapshots, separate video/audio
streams, recordings and confirmed stop/cancel have per-model software coverage.
No new adapter or wire implementation is added. The added profiles use the same
conservative numeric owner firmware admission as other additional-H3 cameras.

This supersedes the 0.11.0 media restriction only for that exact H3 profile.
The nine updated rows mark software evidence, not hardware confirmation.
T8134 reporter cells and dated follow-up observations are preserved. At 0.12.0,
[#56], [Camera-10], [#35] and [#36] held hardware, recovery, other-owner and
standalone obligations. Software audio forwarding is not proof that the
reporter's missing audio is resolved.

## SoloCam S340 preset moves, 0.30.3

[Camera-229] adds a move to one of the four presets saved in the app for the
exact T8170/type 48 under an admitted HomeBase 3, see
[preset moves](API.md#preset-moves-0303). It reuses the unchanged vendored
preset command. This is a software path only. No hardware has shown that a
HomeBase 3 answers the move for a T8170, or that app preset n is wire index
n-1. The feature table has no preset column, so the type 48 row lists
[Camera-229] as remaining work until a reporter result is recorded. Other
pan/tilt models and the standalone route have no preset move.

## Integrated camera software evidence, 0.12.0

[Issue #39][#39] adds [integrated camera software evidence](INTEGRATED_CAMERAS.md)
for exact T8530/55, T8790/90 and T85V0/203 pairs on their actual T8030 H3 parent.
The existing private camera classes and three distinct native live envelopes are
covered by software tests. Snapshot, separate video/audio forwarding, recordings
and acknowledged stop/cancel reuse the established H3 route. No lock, lid, parcel
mechanism or user-management control is exposed. Non-camera pushes are excluded.

The remaining-catalogue audit also adds exact T8110/type 10035 eufyCam C35
coverage using the generic Camera class and existing Solo live envelope.
It remains an eufyCam. At 0.12.0, its other-owner and hardware obligations were
in [#39].

These four feature rows supersede their historical B1/U software cells only for
this exact H3 profile. No hardware cells change. T8531/189 lacks camera metadata
and media commands in the pinned source. Types 101/102 have no model or operation
mapping. Those gaps, E85V0 variants and hardware acceptance remained with
[#39], [E2] and [E6] at 0.12.0. Standalone and other owners remained with [#36]
and [#35].

## Source boundary and reading rules

The catalogue is `DeviceType` in [vendor/src/http/types.ts][Catalogue] at client
commit `e69624d79cd43e810a216602cc39eff70a27d046`, plus `WIRED_CAM_C31` with its
label, property map and commands added in 0.28.0. The complete file SHA-256
including that addition is
`9d8711575e3c545d6838e783ced4f6034ced848dfa17255ee61996b32c4f76bf`.
Its attributed upstream is bropat/eufy-security-client 4.1.1-1,
commit `d75e7996d4cbce3839a6075bed95b752ccc3ee43`, under MIT, as recorded in
[NOTICE.md](../NOTICE.md). Protocol types are numeric Eufy identifiers, not network
transport versions. Do not infer wire compatibility from a shared product name.

All 97 enum entries are accounted for below. Camera rows include integrated
products and unresolved candidates. The owner and exclusion tables account for
the rest. The check compares exact names and numeric values, not just a count.
`Device.isCamera()` alone is insufficient. In this revision it omits
`LOCK_8530`, `LOCK_8531`, `CAMERA_GUN`, `CAMERA_SNAIL` and
`INDOOR_PT_CAMERA_C220_V3`. The first two are camera-bearing products in Eufy's
primary documentation. The other three stay unresolved rather than disappearing.

The original four recognized camera models, the twelve exact eufyCam pairs
and the three additional battery doorbell pairs listed above have discovery software evidence. Other model/type associations
remain catalogue associations for investigation. New fixture admission is not an
observation from a Mega hardware inventory. Eufy's
pages establish product names and possible product topologies, not numeric
protocol types or this client's implementation. A candidate, regional suffix or
bundle code must be resolved with sanitized inventory before enabling it.
Unknown marketing names remain unknown. Family names here assign engineering
ownership. Outdoor wired cameras follow the existing indoor protocol family.

## Topology inventory

| Code           | Product topology and current client boundary                                                                                                   | Evidence and obligation                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H3             | Camera paired with T8030 HomeBase 3, S380. Only the local LAN-derived credential path is implemented. Host networking was observed.            | [C0], [H0]. Other network/encryption profiles remain open, first recorded under [#17], [#18], [E2], [E6].                                                                              |
| H1/E/2         | HomeBase 1, HomeBase E or HomeBase 2 as the connection owner. Model and firmware matter.                                                       | [HB-old], [HB-guide]. Not admitted by the current client. Tracked in [#143], first recorded under [#35], [#17], [E2], [E6].                                                            |
| HM             | HomeBase Mini, T8025, as a possible owner. This is not MiniBase Chime T8023.                                                                   | [Catalogue], [Display], [HB-guide]. Conflicting regional tables and exact revisions need owner evidence, tracked in [#143]. All features remain open, first recorded under [E2], [E6]. |
| W              | Standalone Wi-Fi camera with its own transport/storage owner. Optional HomeBase storage does not prove HomeBase command ownership.             | Product sources per row. A T8134 standalone descriptor is implemented. Transport is unverified. Tracked in [#142], first recorded under [#36], [#17], [E2], [E6].                      |
| L              | Cellular connection. T86P2 also has a distinct Wi-Fi mode. Do not project Wi-Fi evidence onto LTE.                                             | [HB3], [HB-guide]. Route, credentials and media remain unknown. Tracked in [#142], first recorded under [#37], [E2], [E6].                                                             |
| N              | PoE camera connected directly or through a PoE switch to an NVR.                                                                               | [NVR-setup]. [NVR-HB] explicitly excludes HomeBase 2/3. Tracked in [#144], first recorded under [#38], [E2], [E6].                                                                     |
| Chime / bridge | A Wi-Fi Chime, MiniBase Chime or Wi-Fi bridge may own a device connection. A chime used only for sound is not necessarily its transport owner. | [HB-old], [Lock-setup]. Exact relationships remain open, first recorded under [#35], [#36], [#17], [E2], [E6].                                                                         |
| Unknown        | Neither the model association nor connection owner is established.                                                                             | Preserve the row and its family/research obligation as open, first recorded under [E2], [E6].                                                                                          |

H3 product compatibility can mean storage only. [HB3] separates storage from AI.
It does not prove the Mega command route. It excludes original T8420 but lists a
T8420X variant. Keep that distinction without publishing device identifiers.
[Eufy's SoloCam comparison][Solo] still says several SoloCams cannot use H3,
while [HB3] lists them. [Solo-FAQ] says T8134 supports only H3, whereas
[HB-guide] also lists H2 and HM. [HB-old] excludes older HomeBases for T8160 and
T8161, while [HB-guide] lists H2. The English and [German guide][HB-DE] disagree
on Mini support for C210/C220. [Indoor] names T8410 "Indoor Cam 2K Pan & Tilt"
and lists no T8410C, while [HB-guide] and [HB-guide-EU] name T8410 "Indoor Cam
E220" and T8410C "Indoor Cam Pan&Tilt 2K". These are source conflicts, not
client failures. H2/HM claims in those rows remain candidates pending
model/firmware evidence.

The primary [HomeBase Professional S1 list][HB-Pro] also names T9000, an owner
absent from the pinned enum. Its possible camera relationships are retained as
an explicit owner-discovery and hardware obligation, first recorded under
[#17], [E2] and [E6]. Do not map it to `STATION` or H3 without evidence. The
optional NVR Wi-Fi module is described as forthcoming by [NVR-WiFi]. Its
availability, owner and transport remain unknown, and [#38] closed on 2026-09-16
without resolving them. Neither case enlarges this story into protocol
implementation.

## Wired inventory recognition, 0.12.0

The four exact wired pairs in [Wired-software] now retain received inventory
state and standalone identity. H3 and foreign owners are rejected. Live state,
event routing, authentication and media remain open in [#142], which
consolidates [#27], [#28] and the open part of [#36]. No wired transport or
hardware support is claimed.

## Catalogue rows

`R` means the public client recognizes the exact unsuffixed model through its
allowlist, with [S1] or [H0] evidence. `C` means catalogue-only recognition.
Neither is a hardware claim. Firmware is unknown unless listed in the dated
evidence section. Every row also has a separate feature row below.

| Protocol type | Enum                                   | Model number or unresolved association       | Primary marketing names                                                       | Family     | Possible topology                           | Identity/topology sources                                   | Recognition |
| ------------- | -------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- | ---------- | ------------------------------------------- | ----------------------------------------------------------- | ----------- |
| 1             | `CAMERA`                               | T8111                                        | eufyCam                                                                       | cam        | H3, H1/E/2                                  | [Display], [HB-old]                                         | C           |
| 3             | `FLOODLIGHT`                           | T8420 / T8420X                               | Floodlight Cam 1080p                                                          | flood      | W, H3 only for X variant                    | [Flood], [HB3]                                              | C           |
| 4             | `CAMERA_E`                             | T8112                                        | eufyCam E                                                                     | cam        | H3, H1/E/2                                  | [Cam], [HB-old]                                             | C           |
| 5             | `DOORBELL`                             | T8200 / T8201 / T8202                        | Video Doorbell 2K / 1080p / 2K Pro, wired                                     | wired      | W. H3 excluded                              | [HB3]                                                       | C           |
| 7             | `BATTERY_DOORBELL`                     | T8210 / T8210C admitted. T8212 candidate     | Video Doorbell 2K / S220 / S210                                               | battery    | H3, H1/E/2, chime variant unresolved        | [HB3], [HB-old], [HB-guide], [T8210-legacy], [T8210C-107]   | R           |
| 8             | `CAMERA2C`                             | T8113                                        | eufyCam 2C                                                                    | cam        | H3, H1/E/2, HM candidate                    | [Cam], [HB-old], [HB-guide]                                 | C           |
| 9             | `CAMERA2`                              | T8114                                        | eufyCam 2                                                                     | cam        | H3, H1/E/2                                  | [Cam], [HB-old]                                             | C           |
| 14            | `CAMERA2_PRO`                          | T8140                                        | eufyCam 2 Pro                                                                 | cam        | H3, H1/E/2, HM candidate                    | [Cam], [HB-old], [HB-guide]                                 | C           |
| 15            | `CAMERA2C_PRO`                         | T8142. T8142-Z in 0.30.3. T8142R unresolved  | eufyCam 2C Pro / eufyCam S220                                                 | cam        | H3, H1/E/2. HM for R candidate              | [Cam], [S220-Cam], [HB-guide], [236-report]                 | R           |
| 16            | `BATTERY_DOORBELL_2`                   | T8220 / T8221 / T8222 candidates             | Video Doorbell Slim / 2E / C210, 1080p                                        | battery    | H3, H1/E/2, chime variant unresolved        | [HB3], [HB-old], [HB-guide]                                 | C           |
| 19            | `CAMERA3`                              | T8160. T8160-C admitted in 0.29.2            | eufyCam 3 / S330                                                              | cam        | H3. HM, H2 disputed                         | [Cam], [Tracking], [HB-guide], [149-report]                 | R           |
| 23            | `CAMERA3C`                             | T8161                                        | eufyCam 3C / S300                                                             | cam        | H3. H2 disputed                             | [Cam], [Tracking], [HB-guide]                               | C           |
| 24            | `PROFESSIONAL_247`                     | T8600                                        | eufyCam E330 Professional                                                     | cam        | H3, HM candidate. W is not established here | [Display], [HB-guide]                                       | C           |
| 26            | `CAMERA3_PRO`                          | T8162                                        | eufyCam S3 Pro                                                                | cam        | H3, HM/H2 candidates                        | [Display], [HB-guide]                                       | C           |
| 30            | `INDOOR_CAMERA`                        | T8400                                        | Indoor Cam 2K / C120                                                          | indoor     | W, H3                                       | [Indoor], [HB-guide]                                        | R           |
| 31            | `INDOOR_PT_CAMERA`                     | T8410. T8410C admitted in 0.29.2             | Indoor Cam E220 / 2K Pan & Tilt (T8410). Indoor Cam Pan&Tilt 2K (T8410C)      | indoor     | W, H3                                       | [Indoor], [HB-guide], [HB-guide-EU], [Mega-7], [bropat-722] | R           |
| 32            | `SOLO_CAMERA`                          | T8130                                        | SoloCam E20                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                                   | C           |
| 33            | `SOLO_CAMERA_PRO`                      | T8131                                        | SoloCam E40                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                                   | C           |
| 34            | `INDOOR_CAMERA_1080`                   | T8401                                        | Indoor Cam 1080p                                                              | indoor     | W, H3                                       | [Indoor], [HB3]                                             | R           |
| 35            | `INDOOR_PT_CAMERA_1080`                | T8411                                        | Indoor Cam 1080p Pan & Tilt / E210                                            | indoor     | W, H3                                       | [Indoor], [HB-guide]                                        | R           |
| 37            | `FLOODLIGHT_CAMERA_8422`               | T8422                                        | Floodlight Cam E 2K / E220                                                    | flood      | W, H3 storage only in HB3 source            | [Flood], [Display], [HB3]                                   | C           |
| 38            | `FLOODLIGHT_CAMERA_8423`               | T8423                                        | Floodlight Cam 2 Pro / 2K Pro / S330                                          | flood      | W, H3                                       | [Flood], [Display], [HB3]                                   | C           |
| 39            | `FLOODLIGHT_CAMERA_8424`               | T8424                                        | Floodlight Cam 2K / E221                                                      | flood      | W, H3 storage only in HB3 source            | [Flood], [Display], [HB3]                                   | C           |
| 44            | `INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT` | T8440 candidate                              | OutdoorCam E                                                                  | indoor     | W. H3 unresolved for this variant           | [Display], [Predicates]                                     | C           |
| 45            | `INDOOR_OUTDOOR_CAMERA_2K`             | T8441                                        | Outdoor Cam Pro / C24                                                         | indoor     | W, H3, HM candidate                         | [Display], [HB-guide]                                       | R           |
| 46            | `INDOOR_OUTDOOR_CAMERA_1080P`          | T8442                                        | Outdoor Cam / C22                                                             | indoor     | W, H3, HM candidate                         | [Display], [HB-guide]                                       | R           |
| 47            | `FLOODLIGHT_CAMERA_8425`               | T8425                                        | Floodlight Cam E340                                                           | flood      | W, H3, HM candidate                         | [HB3], [HB-guide]                                           | C           |
| 48            | `OUTDOOR_PT_CAMERA`                    | T8170                                        | SoloCam S340                                                                  | solo       | W, H3. H2/HM candidates                     | [Display], [HB-guide]                                       | C           |
| 49            | `CAMERA_E40`                           | T8144                                        | eufyCam E40                                                                   | cam        | H3, H2, HM candidates                       | [Catalogue], [Display], [HB-guide]                          | C           |
| 55            | `LOCK_8530`                            | T8530                                        | Video Smart Lock S330                                                         | integrated | Wi-Fi bridge, H3                            | [Lock-S330], [Lock-setup], [HB-guide]                       | C           |
| 60            | `SOLO_CAMERA_SPOTLIGHT_1080`           | T8122                                        | SoloCam L20                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                                   | C           |
| 61            | `SOLO_CAMERA_SPOTLIGHT_2K`             | T8123                                        | SoloCam L40                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                                   | C           |
| 62            | `SOLO_CAMERA_SPOTLIGHT_SOLAR`          | T8124, T8124V/R variants unresolved          | SoloCam S40 / S230                                                            | solo       | W, H3. HM candidate                         | [Solo], [HB3], [Display], [HB-guide]                        | C           |
| 63            | `SOLO_CAMERA_SOLAR`                    | T8134                                        | SoloCam S220                                                                  | solo       | W, H3. H2/HM disputed                       | [S220-Solo], [Solo-FAQ], [HB-guide]                         | R           |
| 64            | `SOLO_CAMERA_C210`                     | T8B00                                        | SoloCam C210                                                                  | solo       | W candidate, H3, HM candidate               | [Display], [HB-guide]                                       | C           |
| 87            | `FLOODLIGHT_CAMERA_8426`               | T8426                                        | Floodlight Cam E30                                                            | flood      | W candidate, H3, HM candidate               | [Catalogue], [HB3], [HB-guide]                              | C           |
| 88            | `SOLO_CAMERA_E30`                      | T8171                                        | SoloCam E30                                                                   | solo       | W candidate, H3, H2, HM candidate           | [Catalogue], [HB-old], [HB-guide]                           | C           |
| 89            | `CAMERA_S4`                            | T8172                                        | eufyCam S4                                                                    | cam        | H3                                          | [S4], [HB-guide]                                            | C           |
| 90            | `SMART_DROP`                           | T8790                                        | SmartDrop, parcel box with camera                                             | integrated | W candidate, H3. H2/HM candidates           | [Display], [HB3], [HB-guide]                                | C           |
| 91            | `BATTERY_DOORBELL_PLUS`                | T8213                                        | Video Doorbell Dual / S330, battery                                           | battery    | H3, H1/E/2, HM candidate                    | [HB-old], [HB-guide]                                        | R           |
| 93            | `DOORBELL_SOLO`                        | T8203                                        | Video Doorbell Dual / S330, wired                                             | wired      | W. H3 excluded                              | [HB3], [HB-guide]                                           | C           |
| 94            | `BATTERY_DOORBELL_PLUS_E340`           | T8214                                        | Video Doorbell E340                                                           | battery    | W candidate, H3, H2/HM candidates           | [HB3], [HB-guide]                                           | C           |
| 95            | `BATTERY_DOORBELL_C30`                 | T8224                                        | Video Doorbell C30                                                            | battery    | W candidate, H3, H2/HM candidates           | [HB3], [HB-guide]                                           | C           |
| 96            | `BATTERY_DOORBELL_C31`                 | T8223                                        | Video Doorbell C31                                                            | battery    | W candidate, H3, H2/HM candidates           | [HB3], [HB-guide]                                           | C           |
| 98            | `SOLOCAM_E42`                          | T8173                                        | SoloCam E42                                                                   | solo       | W candidate, H3, H2 candidate               | [Catalogue], [Display], [HB-guide]                          | C           |
| 100           | `INDOOR_COST_DOWN_CAMERA`              | T8414                                        | Indoor Cam Mini 2K / Solo IndoorCam P44                                       | indoor     | W, H3. HM candidate                         | [Indoor], [Display], [HB-guide]                             | R           |
| 101           | `CAMERA_GUN`                           | Unknown                                      | Unresolved catalogue label. No verified marketing name                        | unresolved | Unknown                                     | [Catalogue]                                                 | C           |
| 102           | `CAMERA_SNAIL`                         | Unknown                                      | Unresolved catalogue label. No verified marketing name                        | unresolved | Unknown                                     | [Catalogue]                                                 | C           |
| 104           | `INDOOR_PT_CAMERA_S350`                | T8416                                        | Indoor Cam S350                                                               | indoor     | W candidate, H3, HM candidate               | [Display], [HB-guide]                                       | R           |
| 105           | `INDOOR_PT_CAMERA_E30`                 | T8417                                        | Indoor Cam E30                                                                | indoor     | W candidate, H3, HM candidate               | [Display], [HB-guide]                                       | R           |
| 110           | `CAMERA_FG`                            | T8150. T8151/2/3 regional mapping unresolved | 4G Starlight Cam / S230. T8153 name unverified                                | lte        | L. H3 excluded for LTE-only models          | [Catalogue], [Predicates], [HB3], [HB-guide]                | C           |
| 111           | `CAMERA_4G_S330`                       | T86P2                                        | 4G LTE Cam S330 / 4G & Wi-Fi Spotlight Cam                                    | lte        | L, W, H3 in Wi-Fi mode. HM candidate        | [Catalogue], [HB3], [HB-guide]                              | C           |
| 131           | `CAMERA_GARAGE_T8453_COMMON`           | T8453 candidate                              | Garage-Control Cam Plus / Solo Garage Cam C24. Common-type mapping unresolved | garage     | W candidate. H3 under evaluation            | [Catalogue], [Display], [HB3]                               | C           |
| 132           | `CAMERA_GARAGE_T8452`                  | T8452                                        | Garage-Control Cam / Solo Garage Cam C22                                      | garage     | W candidate. H3 under evaluation            | [Catalogue], [Display], [HB3]                               | C           |
| 133           | `CAMERA_GARAGE_T8453`                  | T8453                                        | Garage-Control Cam Plus / Solo Garage Cam C24                                 | garage     | W candidate. H3 under evaluation            | [Catalogue], [Display], [HB3]                               | C           |
| 151           | `WALL_LIGHT_CAM`                       | T84A1                                        | Wired Wall Light Cam S100                                                     | wall       | W candidate, H3 storage. AI unresolved      | [Display], [HB3], [HB-guide]                                | C           |
| 189           | `LOCK_8531`                            | T8531                                        | Video Smart Lock E330                                                         | integrated | W candidate, H3, HM candidate               | [HB-guide]                                                  | C           |
| 203           | `LOCK_85V0`                            | T85V0. E85V0 bundle mapping unresolved       | FamiLock S3 Max / S3                                                          | integrated | W candidate, H3, HM variant candidate       | [HB-guide], [Display]                                       | C           |
| 301           | `CAMERA_POE_S4`                        | T8E00                                        | PoE Cam S4 / Bullet-PTZ Cam                                                   | nvr        | N. H2/H3 excluded                           | [NVR-setup], [NVR-HB], [Display]                            | C           |
| 10005         | `WALL_LIGHT_CAM_81A0`                  | T81A0                                        | Solar Wall Light Cam S120                                                     | wall       | W candidate, H3, HM candidate               | [Catalogue], [Display], [HB-guide]                          | C           |
| 10008         | `INDOOR_PT_CAMERA_C220`                | T8W11C candidate                             | Indoor Cam C220. Subtype mapping unresolved                                   | indoor     | W candidate, H3. HM disputed                | [Catalogue], [Display], [HB-guide], [HB-DE]                 | C           |
| 10009         | `INDOOR_PT_CAMERA_C210`                | T8419 / T8W11P candidate                     | Indoor Cam C210. T8W11P alias unverified                                      | indoor     | W candidate, H3. HM disputed                | [Catalogue], [Display], [HB-guide], [HB-DE]                 | C           |
| 10010         | `INDOOR_PT_CAMERA_C220_V2`             | T8W11C candidate                             | Indoor Cam C220. V2 mapping unresolved                                        | indoor     | W candidate, H3. HM disputed                | [Catalogue], [Display], [HB-guide], [HB-DE]                 | C           |
| 10011         | `INDOOR_PT_CAMERA_C220_V3`             | T8419N per catalogue only                    | Unresolved C220 V3 label. No primary model-name confirmation                  | indoor     | Unknown. Do not inherit C210/C220 topology  | [Catalogue]                                                 | C           |
| 10031         | `WIRED_CAM_C31`                        | T817L                                        | Wired Cam C31                                                                 | indoor     | W, H3, HM. Not H2                           | [C31], [C31-report], [C31-standalone]                       | R           |
| 10035         | `CAMERA_C35`                           | T8110                                        | eufyCam C35                                                                   | cam        | H3, HM candidate. W unresolved              | [Catalogue], [Display], [HB-guide]                          | C           |

The C210/C220 subtypes deliberately remain separate. Eufy's display list and
HomeBase guide confirm product names, but not the enum's variant numbering.
The catalogue comment for 10011 says T8419N, while the primary guide lists
T8418N under C220. There is no basis here to correct the enum or merge the rows.
`CAMERA_GARAGE_T8453_COMMON` likewise is not proof of a separate retail model.
T8212 type 7 and T8220/T8221/T8222 type 16 remain candidate associations to the
two generic enum branches. Their exact inventory types remain a matrix
obligation, first recorded in [#25]. 0.30.1 admits T8210/7 and T8210C/7 on public
evidence, as described in [BATTERY_DOORBELLS.md](BATTERY_DOORBELLS.md#public-t8210-and-t8210c-type-7-evidence-0301).

## Core features by protocol type

Each cell describes this client on the row's stated topology, not what the Eufy
app can do. Non-H3 topologies never inherit the H3 result. The eight feature columns
are independent. Stored snapshots are previously stored cover images, not a
new exposure or event-specific image.

| Code | Meaning                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H    | Historical hardware observation in [H0] on the exact tuple below. It does not establish current health, every firmware or every event type.                                                                                                      |
| P    | Partial reporter success in [R1], on [R0]'s tuple. Installed versions and full lifecycle checks remain unconfirmed.                                                                                                                              |
| X    | Experimental software path only, including the exact H3 rows in [Solo-software]. [C0] and [Adapter] expose the function. [Discovery-tests] checks S220 discovery. [S1] checks its live command selection. No full per-model hardware acceptance. |
| F    | Reported failure in [R1]. [R2] separately reports reproduced consumer defects. The cause of the hardware black screen is not yet confirmed by retest.                                                                                            |
| B1/U | Proven client entry barrier: model absent from the allowlist in [C0]. Underlying feature behavior is unknown, not proven impossible.                                                                                                             |
| B2/U | Proven client owner barrier: a recognized camera requires a discovered T8030 parent in [C0]. Behavior on other owners is unknown.                                                                                                                |
| U    | Unknown or no sufficiently specific observation. An enum or generic test cannot turn U into H.                                                                                                                                                   |
| N/A  | No camera function on an owner-only device. This does not exclude its station status or recording ownership.                                                                                                                                     |

For R rows, H3 results apply only to the exact model stated in the evidence
column. Unadmitted candidate suffixes remain B1/U. For C rows, B1/U applies to
every listed topology. State covers available identity, firmware and
availability. Battery is shown separately. Discovery initially returns battery
null. The adapter reads a valid observed percentage or leaves it null. No
battery lifetime claim is made.

| Type  | Model / evaluated topology                           | Discovery | Available state     | Battery   | Stored snapshot | Live video | Live audio | Events          | Recordings    | Evidence                                            | Remaining work                                  |
| ----- | ---------------------------------------------------- | --------- | ------------------- | --------- | --------------- | ---------- | ---------- | --------------- | ------------- | --------------------------------------------------- | ----------------------------------------------- |
| 1     | T8111 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#96]                                           |
| 3     | T8420 / T8420X / listed topologies                   | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]                       |
| 4     | T8112 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#97]                                           |
| 5     | T8200 / T8201 / T8202 / standalone inventory only    | X         | X inventory         | N/A       | B2/U            | B2/U       | B2/U       | B2/U            | B2/U          | [Wired-software], [Catalogue]                       | [#27], [#28], [#36], [#59]                      |
| 7     | T8210 / T8210C / actual H3 owner only. T8212 B1/U    | X         | X                   | X         | X               | X          | X          | X               | X             | [Battery-software], [T8210-legacy], [T8210C-107]    | [198-report], [#108], [#109]                    |
| 8     | T8113 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#98]                                           |
| 9     | T8114 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#99]                                           |
| 14    | T8140 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#100]                                          |
| 15    | T8142 and T8142-Z / H3 only                          | X         | X                   | X         | X               | X          | X          | X               | X             | [S1], [C0]                                          | [#101], [236-report]                            |
| 16    | T8220 / T8221 / T8222 candidates / listed topologies | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#110], [#111], [#112]                          |
| 19    | T8160 / H3 only. T8160-C reported, no H              | H         | H                   | H         | H               | H          | H          | H person        | H             | [H55], [H0], [C0]                                   | [#19], [#20], [#55], [149-report]               |
| 23    | T8161 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#102]                                          |
| 24    | T8600 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#103]                                          |
| 26    | T8162 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#104]                                          |
| 30    | T8400 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 31    | T8410 / T8410C / actual H3 owner only                | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57], [149-report] |
| 32    | T8130 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 33    | T8131 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 34    | T8401 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 35    | T8411 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 37    | T8422 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]                       |
| 38    | T8423 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]                       |
| 39    | T8424 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]                       |
| 44    | T8440 candidate / listed topologies                  | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]                             |
| 45    | T8441 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 46    | T8442 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 47    | T8425 / H3 only                                      | X         | X                   | N/A       | X               | X          | X          | X               | X             | [Floodlight-software], [Catalogue]                  | [#29], [#30], [#60]                             |
| 48    | T8170 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56], [Camera-229]               |
| 49    | T8144 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#105]                                          |
| 55    | T8530 / exact H3 profile                             | X         | X                   | X         | X               | X          | X          | X               | X             | [Integrated-software]                               | [#39], [#35], [#36], [E2], [E6]                 |
| 60    | T8122 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 61    | T8123 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 62    | T8124 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 63    | T8134 / H3 only                                      | P         | P identity          | P reading | P               | F          | U          | P person        | P video/audio | [R0], [R1], [R2], [R3], [S1], [C0], [Solo-software] | [#35], [#36], [#56], [Camera-10]                |
| 64    | T8B00 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 87    | T8426 / H3 only                                      | X         | X                   | N/A       | X               | X          | X          | X               | X             | [Floodlight-software], [Catalogue]                  | [#29], [#30], [#60]                             |
| 88    | T8171 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 89    | T8172 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#106]                                          |
| 90    | T8790 / exact H3 profile                             | X         | U                   | X         | X               | X          | X          | X               | X             | [Integrated-software]                               | [#39], [#35], [#36], [E2], [E6]                 |
| 91    | T8213 / H3 only                                      | H         | H                   | H         | H               | H          | H          | H ring          | H             | [H58], [H0], [C0]                                   | [#25], [#26], [#58]                             |
| 93    | T8203 / standalone inventory only                    | X         | X inventory         | N/A       | B2/U            | B2/U       | B2/U       | B2/U            | B2/U          | [Wired-software], [Catalogue]                       | [#27], [#28], [#36], [#59]                      |
| 94    | T8214 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#113]                                          |
| 95    | T8224 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#114]                                          |
| 96    | T8223 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#115]                                          |
| 98    | T8173 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]                             |
| 100   | T8414 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 101   | Unknown / listed topologies                          | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue], [Integrated-software]            | [#39], [E2], [E6]                               |
| 102   | Unknown / listed topologies                          | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue], [Integrated-software]            | [#39], [E2], [E6]                               |
| 104   | T8416 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 105   | T8417 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57]               |
| 110   | T8150 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#37], [E2], [E6]                               |
| 111   | T86P2 / actual H3 parent in Wi-Fi mode only          | X         | X                   | X         | X               | X          | X          | X               | X             | [LTE0], [Catalogue], [HB3]                          | [#37], [#36], [#35], [E2], [E6]                 |
| 131   | T8453 candidate / listed topologies                  | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#33], [#34], [#62]                             |
| 132   | T8452 / listed topologies                            | X         | X descriptor        | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [Garage-software], [Catalogue]                      | [#33], [#34], [#36], [#62]                      |
| 133   | T8453 / listed topologies                            | X         | X descriptor        | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [Garage-software], [Catalogue]                      | [#33], [#34], [#36], [#62]                      |
| 151   | T84A1 / H3 state and events, W descriptor            | X         | X                   | U         | U               | U          | U          | X               | U             | [Wall-software], [Catalogue]                        | [#32], [#35], [#36], [#61]                      |
| 189   | T8531 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue], [Integrated-software]            | [#39], [E2], [E6]                               |
| 203   | T85V0 / exact H3 profile                             | X         | X                   | X         | X               | X          | X          | X               | X             | [Integrated-software]                               | [#39], [#35], [#36], [E2], [E6]                 |
| 301   | T8E00 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue], [NVR-research]                   | [#38], [E2], [E6]                               |
| 10005 | T81A0 / H3 media, W descriptor                       | X         | X                   | X         | X               | X          | X          | X               | X             | [Wall-software], [Catalogue]                        | [#32], [#35], [#36], [#61]                      |
| 10008 | T8W11C candidate / listed topologies                 | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]                             |
| 10009 | T8419 / T8W11P candidate / listed topologies         | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]                             |
| 10010 | T8W11C candidate / listed topologies                 | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]                             |
| 10011 | T8419N per catalogue only / listed topologies        | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]                             |
| 10031 | T817L / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [C31-report]                     | [C31-report], [#35], [#36], [#57]               |
| 10035 | T8110 / exact H3 profile                             | X         | X                   | X         | X               | X          | X          | X               | X             | [Integrated-software], [Catalogue]                  | [#39], [#35], [#36], [E2], [E6]                 |

For the four R rows, evaluate every listed non-H3 topology as B2/U for each of
discovery, state, battery, snapshot, live video, live audio, events and recordings.
Their separate owner obligations were first recorded under [#17], [#35], [#36]
and [E6]. The H3 implementation explicitly uses local-only P2P and LAN-derived
credentials. Routed LAN/VLAN, remote relay, stronger cipher modes and
legacy-cloud credential retrieval are not established by H. [C0] rejects
unavailable credential paths.
These are implementation boundaries, not proof that a product cannot use them.

For T8142 and T8142-Z, X in the media/state/event columns denotes reachable shared code,
not eight passing model-specific fixture suites. [Discovery-tests] proves the
allowlist/parent rules. [S1] checks the existing live command choice. T8142 and
T8142-Z use `CMD_SET_PAYLOAD`, T8134 uses `CMD_DOORBELL_SET_PAYLOAD` in that test.
Since 0.11.0 the adapter instantiates `SoloCamera` for T8134. It instantiates
generic `Camera` for T8142 and T8142-Z and `BatteryDoorbellCamera` for T8213, T85V0/203,
T8210/7, T8210C/7 and the exact pairs in the 0.8.0 and 0.18.1 sections. [#21] added that SoloCam
selection and closed on 2026-09-11.

For excluded models, available vendor predicates, properties or command tables
are protocol leads only. They are not experimental public-client coverage.
Battery-less products also say B1/U because their current client status route is
unreachable. Do not read that as a claim that a mains-powered product has a battery.

For T8425/47 and T8426/87, [Floodlight-software] defines the exact experimental
H3 profile. Available state covers identity and observed firmware. Battery is
not applicable, and availability remains unknown because the attributed model
properties have no such field. Standalone recognition retains an explicit
transport blocker and does not inherit H3 media or event coverage. Other owners
remain blocked. T8420/X, T8422 and T8423 retain their entry barriers. T8424 keeps
them under a HomeBase and as its own station without the experimental option.
H3 storage compatibility alone does not establish command ownership. That model
work remains open in this matrix after scoped software acceptance of [#29]/[#30].

## Dated device evidence and failures

| Evidence                   | Date, software and hardware tuple                                                                                                                                                                                                  | Positive observations                                                                                                                                                                                                                                                                                           | Limits and owner                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0 baseline                | 2026-09-09 to 2026-09-10. Client 0.1.0-dev.8 on isolated HA, then 0.1.0 with audio timing fix on production. T8030 firmware 3.8.6.0, three T8160 firmware 3.4.3.0, one T8213 firmware 0.2.1.8. H3 local LAN, exclusive controller. | Authentication/discovery, available state, stored snapshots, live video/audio and confirmed STOP. Recording history, playback, seek and cancel. Real person and doorbell events. A short battery observation exists, but the summary does not assign it to each model. Per-model battery proof remains unknown. | [H0] records the acceptance. Overnight idle evidence preceded the active-stream timing fix and covered 11h26m, not 24h. Event counts are installation-wide. Non-person motion was disabled. [#55], [#58], [E6] retain untested variants. |
| H55 exact T8160 validation | 2026-09-11. Client 0.10.0, bridge/integration 0.7.1, HA 2026.9.1. One T8160 firmware 3.4.3.0 behind its actual T8030 firmware 3.8.6.0. H3 local LAN, exclusive controller.                                                         | Discovery, reported online state and battery 75 percent, stored snapshot, decoded live video/audio, stop, recording playback/seek, real HA person event, UI cancellation after 4109027 bytes with confirmed device stop, and restart recovery.                                                                  | [H55] provides separate measured results and test limits. Existing identities and configuration preserved. Other models, firmware and owners remain tracked. No family-wide or speaker-listening claim.                                  |
| H1 upgrade observation     | 2026-09-10. Client 0.1.1 and bridge/integration 0.6.2 on the existing T8030/T8160/T8213 installation.                                                                                                                              | Identity preservation, HomeBase/push recovery, stored snapshots and live JPEG frames for all four cameras, clean stream shutdown.                                                                                                                                                                               | [H1] is the public dated summary. Private deployment notes confirm audio and recordings were not physically repeated in this upgrade. H1 does not extend H0's audio/recording acceptance to a fresh 0.1.1 hardware test.                 |
| R0 reporter tuple          | 2026-09-10 10:38 UTC. Four T8134 firmware 3.3.6.0 paired with T8030 firmware 3.8.5.2.                                                                                                                                              | Exact model and parent supplied by reporter.                                                                                                                                                                                                                                                                    | [R0]. Exact installed client, bridge and integration versions for the later test remain unconfirmed. Do not infer local-only transport from pairing alone.                                                                               |
| R1 partial successes       | 2026-09-10 13:07 UTC, reporter's R0 installation after reinstallation.                                                                                                                                                             | Discovery/import, last stored snapshot, displayed battery, person event, recording playback with video and audio.                                                                                                                                                                                               | [R1]. Restart persistence, all-camera coverage, battery updates, recording seek/cancel and live stop/reopen not individually confirmed. Original [camera issue #10][Camera-10] owns remaining investigation and validation.              |
| R1 live failure            | Same report and tuple.                                                                                                                                                                                                             | None for live viewing. Black view followed by automatic closure.                                                                                                                                                                                                                                                | [R1]. Internal go2rtc codec warning is not proof of the camera's native RTSP support or a confirmed root cause. Live audio is U, not a passed test and not independently diagnosed as absent.                                            |
| R1 recovery failure        | Same report, after an unspecified settings change.                                                                                                                                                                                 | Reinstallation recovered discovery.                                                                                                                                                                                                                                                                             | [R1]. Repeating session restore failure reported. Setting, client platform and exact versions are still requested. This is separate from live video.                                                                                     |
| R2 maintainer reproduction | 2026-09-10 13:52 UTC, software report in the original issue.                                                                                                                                                                       | Maintainer reports reproducing audio conversion requested for video-only streams and restore retries blocking corrected login. Reports 60 bridge and 80 HA tests passing on prepared local fixes.                                                                                                               | [R2]. Fixes were described as unreleased in that comment. This is software evidence, not a successful T8134 retest. [R3] records subsequent delivery. This matrix story changes neither defect.                                          |
| R3 delivered fixes         | 2026-09-10 14:13 UTC, maintainer update. Bridge/integration 0.6.3.                                                                                                                                                                 | [R3] announces the fixes and reports T8160/T8213 stored snapshots, live frames, audio metadata, stream cleanup and preserved entities.                                                                                                                                                                          | Audio metadata is not audible playback. No T8134 retest result was posted at this review. Live and recovery validation remain owned by [camera issue #10][Camera-10].                                                                    |
| R2 event semantics         | Same maintainer response.                                                                                                                                                                                                          | The HA event entity retains the last event.                                                                                                                                                                                                                                                                     | [R2] explains why it does not reset to Idle like a motion sensor. The reporter's request is not a proven regression. No inference about event duration or a binary motion state.                                                         |

H cells preserve documented baseline observations. A stored frame, command enum,
mock response, HTTP success or sent STOP alone cannot establish live media or
physical completion. Generic [live tests][Live-tests], [recording tests][Recording-tests],
[event tests][Event-tests] and [protocol lifecycle tests][Lifecycle-tests] cover
software contracts, not another model/firmware/topology tuple.

## Synthetic family regression evidence

[Family fixtures](FAMILY_FIXTURES.md), delivered by [#18], cover each recorded
family at its existing admission boundary. They distinguish public discovery
and H3 lifecycle checks from isolated vendor command selection and unsupported
model rejection. Synthetic firmware cases exercise the existing command branch.
They do not upgrade any feature cell or establish hardware support. Per-row
implementation and hardware obligations below remain unchanged.

## Connection owners in the catalogue

These types remain visible in the accounting even though they are not camera
rows. Station status and media ownership remain in scope where applicable.

| Protocol type | Enum             | Owner model / primary name                                                              | Current evidence and remaining obligation                                                                                                                                                                                                       |
| ------------- | ---------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0             | `STATION`        | T8001 HomeBase, T8002 HomeBase E, T8010 HomeBase 2 candidates                           | [Display], [HB-old], [Catalogue]. Recognition is catalogue-only. All client functions B1/U. Tracked in [#143], first recorded under [#35], [#17], [E2], [E6].                                                                                   |
| 18            | `HB3`            | T8030 HomeBase 3 / S380                                                                 | [HB-guide], [H0], [H1], [C0]. Discovery and station availability historically observed. Battery and own camera media N/A. It owns the proven child-camera routes. Other firmware/network profiles remain open, first recorded under [E2], [E6]. |
| 25            | `MINIBASE_CHIME` | T8023 MiniBase Chime candidate                                                          | [Display], [Catalogue]. Catalogue-only. All client functions B1/U. Tracked in [#143], first recorded under [#35], [#17], [E2], [E6].                                                                                                            |
| 28            | `HOMEBASE_MINI`  | T8025 HomeBase Mini                                                                     | [Catalogue], [Display], [HB-guide]. Catalogue-only. All client functions B1/U. Tracked in [#143], first recorded under [#35], [#17], [E2], [E6].                                                                                                |
| 300           | `NVR_S4_MAX`     | T8N00 NVR, catalogue S4 Max label. E8P10 is a system code, not an assumed device_model. | [Catalogue], [NVR-setup]. Catalogue-only. All client functions B1/U. Tracked in [#144], first recorded under [#38], [#17], [E2], [E6].                                                                                                          |

T8020 Wi-Fi Chime and T8021 Wi-Fi Bridge appear in [Display] but have no dedicated
enum name here. Preserve their exact inventory-type question, first recorded in
[#35]/[#17]. Do not fabricate a HomeBase entity for a standalone device or
sound-only chime.

The [standalone and older-owner investigation](research/CAMERA_TRANSPORTS_2026-09-11.md)
records the pinned Mega and P2P evidence, an offline descriptor inspection tool
and the exact authentication/media gaps that [#143] and [#142] now track.
Descriptor field presence does not establish a working connection.

## Explicit non-camera exclusions

These are exclusions from the camera matrix, not supported-product claims.
The pinned [predicates][Predicates] and property tables classify sensors,
keypads, non-video locks, safes and trackers. Video locks 55, 189 and 203 are
explicitly retained above despite uneven camera predicates. Future camera
variants require reclassification, not inheritance from this exclusion list.

| Protocol type | Enum                       | Reason                                                                             |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| 2             | `SENSOR`                   | Sensor branch in [Predicates], not a camera.                                       |
| 10            | `MOTION_SENSOR`            | Sensor branch in [Predicates], not a camera.                                       |
| 11            | `KEYPAD`                   | Keypad in [Predicates], not a camera.                                              |
| 20            | `WATER_FREEZE_SENSOR_8920` | Sensor branch in [Predicates], not a camera.                                       |
| 50            | `LOCK_BLE`                 | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 51            | `LOCK_WIFI`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 52            | `LOCK_BLE_NO_FINGER`       | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 53            | `LOCK_WIFI_NO_FINGER`      | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 54            | `LOCK_8503`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 56            | `LOCK_85A3`                | Lock keypad branch in [Predicates], not a video lock.                              |
| 57            | `LOCK_8592`                | Lock keypad branch in [Predicates], not a video lock.                              |
| 58            | `LOCK_8504`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 123           | `SIREN_SENSOR_E20`         | Sensor branch in [Predicates], not a camera.                                       |
| 126           | `ENTRY_SENSOR_E20`         | Sensor branch in [Predicates], not a camera.                                       |
| 127           | `PIR_SENSOR_E20`           | Sensor branch in [Predicates], not a camera.                                       |
| 140           | `SMART_SAFE_7400`          | Safe branch in [Predicates], not a camera.                                         |
| 141           | `SMART_SAFE_7401`          | Safe branch in [Predicates], not a camera.                                         |
| 142           | `SMART_SAFE_7402`          | Safe branch in [Predicates], not a camera.                                         |
| 143           | `SMART_SAFE_7403`          | Safe branch in [Predicates], not a camera.                                         |
| 157           | `SMART_TRACK_LINK`         | Tracker in [Catalogue], not a camera.                                              |
| 159           | `SMART_TRACK_CARD`         | Tracker in [Catalogue], not a camera.                                              |
| 180           | `LOCK_8502`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 184           | `LOCK_8506`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 202           | `LOCK_85D0`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 201           | `LOCK_85L0`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 209           | `LOCK_85P0`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |

## Open obligations and update procedure

Every missing core feature and every missing hardware tuple remains an open
obligation in this matrix. [E2] and [E6] tracked them until both closed on
2026-09-16. Open work lives in individual GitHub issues.
The per-row family links distinguish discovery/state/events implementation from
snapshot/live/recording implementation and hardware acceptance. Family stories
covered one evidenced profile. Hardware stories #55 through #62 covered one exact
tuple each. Closing one did not close the other rows in that family. The
eufy-mega-client issues in the Remaining work column mark where each obligation
was first recorded. All of them closed by 2026-09-16. [#142], [#143] and [#144]
track the open standalone, older-owner and NVR gaps.

For LTE, PoE/NVR, integrated products and unresolved catalogue labels, [#37],
[#38] and [#39] closed their bounded research as completed on 2026-09-16. Their
follow-ups are [#142] and [#144], and unresolved integrated entries stay
recorded in this matrix. All eight feature columns stay open until delivered or
bounded by evidence. Hardware validation stays separate for each model,
firmware, topology and feature. Camera functions on locks, garages and SmartDrop
do not include unlocking, garage actuation or parcel controls.

No additional implementation story is needed for this inventory. Open issues
plus the obligations recorded in this matrix cover the gaps. If research exposes
an additional protocol, split a one- or two-day story before making it Ready.
The catalogued but unresolved labels 101, 102 and 10011 remain obligations.
New models visible in primary sources but absent from this pinned catalogue,
including PoE E40/E41 in [Display], require intake as matrix obligations and get
a scoped issue when an owner reports such a model. Do not silently add their
product names to an existing numeric type.

To maintain this document:

1. Pin the client commit and catalogue file digest. Compare every enum entry,
   camera predicate and primary camera-bearing product. Keep exclusions explicit.
2. Record product-name and topology sources with a review date. Preserve conflicts
   and unknown subtype associations until sanitized inventory resolves them.
3. Add a separate row or evidence tuple when model, firmware or topology changes.
   Record discovery, state, battery, snapshot, live video, live audio, events and
   recordings separately. Include stop/cancel and observation duration.
4. Link code/tests for software evidence. Hardware evidence needs date, model,
   camera and owner firmware, client/consumer versions, topology, scenario and
   result. Keep private identifiers, keys, captures and images out of the record.
5. Link remaining implementation and hardware obligations before closing work.
   Re-read [camera issue #10][Camera-10] for T8134 changes. Preserve that issue's
   ownership and distinguish prepared fixes, delivered fixes and hardware retests.
6. Run `python3 scripts/check_model_matrix.py`, formatting and mandatory CI.
   The offline check detects omitted/duplicate enum rows, numeric drift, omitted
   feature columns, unbound references and missing local targets. Source truth
   and hardware attribution still require review. Do not run devices for a
   documentation update.

## Source register

Primary product pages were read on 2026-09-10. [HB-guide-EU], the T8410 and
T8410C rows of [HB-guide] and the T8410 entry of [Indoor] were read on
2026-10-12. Their claims describe Eufy's own products. They do not establish
client hardware acceptance. Source conflicts are recorded above. Code and
baseline evidence links use the reviewed client commit. GitHub discussion links
retain their dated authorship.

Software evidence includes [the adapter][Adapter] and [discovery fixtures][Discovery-tests].
S1 alone is not the discovery test. Review both files for the exact assertion.

[Catalogue]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/vendor/src/http/types.ts#L14-L116
[Predicates]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/vendor/src/http/device.ts#L1880-L2632
[Cam]: https://service.eufy.com/article-description/Differences-Between-All-Add-on-eufyCams
[S220-Cam]: https://www.eufy.com/us/products/t81421d1
[S220-Solo]: https://service.eufy.com/article-description/Introducing-eufy-S220-SoloCam
[Solo-FAQ]: https://service.eufy.com/article-description/eufy-S220-SoloCam-FAQ
[Indoor]: https://service.eufy.com/article-description/Differences-Between-eufy-Indoor-Cams
[Flood]: https://service.eufy.com/article-description/Differences-Between-eufy-Floodlight-Cameras
[Solo]: https://service.eufy.com/article-description/Differences-Between-eufy-SoloCams
[Display]: https://service.eufy.com/article-description/Eufy-Smart-Display-E10-T87A0-Compatibility-List
[HB-old]: https://service.eufy.com/article-description/Compatibility-Between-eufy-Devices
[HB3]: https://service.eufy.com/article-description/S380-HomeBase-HomeBase-3-Compatibility
[HB-guide]: https://service.eufy.com/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide
[HB-guide-EU]: https://service.eufy.com/eu/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide
[HB-DE]: https://service.eufy.com/de/article-description/eufy-Security-Vollst%C3%A4ndiger-Kompatibilit%C3%A4tsleitfaden-f%C3%BCr-HomeBase
[HB-Pro]: https://service.eufy.com/article-description/What-eufy-devices-are-compatible-with-HomeBase-Professional-S1
[Tracking]: https://service.eufy.com/article-description/Cross-Camera-Tracking-Function-Compatibility
[Lock-S330]: https://service.eufy.com/product-description/a085g000004xt7kAAA/video-smart-lock-s330
[Lock-setup]: https://service.eufy.com/article-description/How-to-set-up-the-Video-Smart-Lock
[S4]: https://service.eufy.com/article-description/T8172-eufyCam-S4-EU-Declaration
[NVR-setup]: https://service.eufy.com/article-description/How-do-I-set-up-my-PoE-NVR-Security-System
[NVR-HB]: https://service.eufy.com/article-description/Does-the-PoE-NVR-Security-System-work-with-HomeBase-2-and-HomeBase-3
[NVR-WiFi]: https://service.eufy.com/article-description/Can-the-PoE-NVR-Security-System-connect-to-cameras-wirelessly
[C0]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/src/client.ts
[Adapter]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/src/device-transport.ts
[S1]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/s220.test.mjs
[Discovery-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/cloud.test.mjs
[H0]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/docs/COMPATIBILITY.md
[H1]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5617635813
[R0]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5617291132
[R1]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5619177924
[R2]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5619797793
[Camera-10]: https://github.com/keesmod/ha-eufy-cam/issues/10
[Camera-229]: https://github.com/keesmod/ha-eufy-cam/issues/229
[Live-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/live.test.mjs
[Recording-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/recordings.test.mjs
[Event-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/events.test.mjs
[Lifecycle-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/protocol-lifecycle.test.mjs
[Story]: https://github.com/keesmod/eufy-mega-client/issues/15
[Programme]: https://github.com/keesmod/eufy-mega-client/issues/7
[E2]: https://github.com/keesmod/eufy-mega-client/issues/9
[E6]: https://github.com/keesmod/eufy-mega-client/issues/13
[#17]: https://github.com/keesmod/eufy-mega-client/issues/17
[#18]: https://github.com/keesmod/eufy-mega-client/issues/18
[#19]: https://github.com/keesmod/eufy-mega-client/issues/19
[#20]: https://github.com/keesmod/eufy-mega-client/issues/20
[#21]: https://github.com/keesmod/eufy-mega-client/issues/21
[#22]: https://github.com/keesmod/eufy-mega-client/issues/22
[#23]: https://github.com/keesmod/eufy-mega-client/issues/23
[#24]: https://github.com/keesmod/eufy-mega-client/issues/24
[#25]: https://github.com/keesmod/eufy-mega-client/issues/25
[#26]: https://github.com/keesmod/eufy-mega-client/issues/26
[#27]: https://github.com/keesmod/eufy-mega-client/issues/27
[#28]: https://github.com/keesmod/eufy-mega-client/issues/28
[#29]: https://github.com/keesmod/eufy-mega-client/issues/29
[#30]: https://github.com/keesmod/eufy-mega-client/issues/30
[#31]: https://github.com/keesmod/eufy-mega-client/issues/31
[#32]: https://github.com/keesmod/eufy-mega-client/issues/32
[#33]: https://github.com/keesmod/eufy-mega-client/issues/33
[#34]: https://github.com/keesmod/eufy-mega-client/issues/34
[#35]: https://github.com/keesmod/eufy-mega-client/issues/35
[#36]: https://github.com/keesmod/eufy-mega-client/issues/36
[#37]: https://github.com/keesmod/eufy-mega-client/issues/37
[#38]: https://github.com/keesmod/eufy-mega-client/issues/38
[#39]: https://github.com/keesmod/eufy-mega-client/issues/39
[#55]: https://github.com/keesmod/eufy-mega-client/issues/55
[#56]: https://github.com/keesmod/eufy-mega-client/issues/56
[#57]: https://github.com/keesmod/eufy-mega-client/issues/57
[#58]: https://github.com/keesmod/eufy-mega-client/issues/58
[#59]: https://github.com/keesmod/eufy-mega-client/issues/59
[#60]: https://github.com/keesmod/eufy-mega-client/issues/60
[#61]: https://github.com/keesmod/eufy-mega-client/issues/61
[#62]: https://github.com/keesmod/eufy-mega-client/issues/62
[R3]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5620098054
[H55]: hardware/T8160_2026_09_11.md
[#96]: https://github.com/keesmod/eufy-mega-client/issues/96
[#97]: https://github.com/keesmod/eufy-mega-client/issues/97
[#98]: https://github.com/keesmod/eufy-mega-client/issues/98
[#99]: https://github.com/keesmod/eufy-mega-client/issues/99
[#100]: https://github.com/keesmod/eufy-mega-client/issues/100
[#101]: https://github.com/keesmod/eufy-mega-client/issues/101
[#102]: https://github.com/keesmod/eufy-mega-client/issues/102
[#103]: https://github.com/keesmod/eufy-mega-client/issues/103
[#104]: https://github.com/keesmod/eufy-mega-client/issues/104
[#105]: https://github.com/keesmod/eufy-mega-client/issues/105
[#106]: https://github.com/keesmod/eufy-mega-client/issues/106
[H58]: hardware/T8213_2026_09_11.md
[R4]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631081488
[R5]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631252411
[R6]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631339423
[R7]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631991682
[#108]: https://github.com/keesmod/eufy-mega-client/issues/108
[#109]: https://github.com/keesmod/eufy-mega-client/issues/109
[#110]: https://github.com/keesmod/eufy-mega-client/issues/110
[#111]: https://github.com/keesmod/eufy-mega-client/issues/111
[#112]: https://github.com/keesmod/eufy-mega-client/issues/112
[#113]: https://github.com/keesmod/eufy-mega-client/issues/113
[#114]: https://github.com/keesmod/eufy-mega-client/issues/114
[#115]: https://github.com/keesmod/eufy-mega-client/issues/115
[#142]: https://github.com/keesmod/eufy-mega-client/issues/142
[#143]: https://github.com/keesmod/eufy-mega-client/issues/143
[#144]: https://github.com/keesmod/eufy-mega-client/issues/144
[Solo-software]: SOLOCAM.md
[Wall-software]: WALLLIGHT.md
[Floodlight-software]: FLOODLIGHT.md
[LTE0]: LTE.md
[Indoor-software]: INDOOR.md
[Battery-software]: BATTERY_DOORBELLS.md
[C31]: https://www.eufy.com/products/t817l121
[C31-report]: https://github.com/keesmod/ha-eufy-cam/issues/136
[C31-standalone]: https://github.com/homebridge-plugins/homebridge-eufy/issues/1027
[C31-result]: https://github.com/keesmod/ha-eufy-cam/issues/136#issuecomment-5993196872
[Integrated-software]: INTEGRATED_CAMERAS.md

Garage types 132/133 have descriptor recognition only. Their firmware and identity
are visible, but public state refresh, events and media remain blocked pending
a proven owner and authentication route. See [Garage-software].

[Garage-software]: GARAGE.md
[Wired-software]: WIRED_DOORBELLS.md
[NVR-research]: research/NVR_TRANSPORT.md
