# E15 spontaneous LAN reports, 2026-09-16

Evidence for [#150](https://github.com/keesmod/eufy-mega-client/issues/150).
The client adds a bounded report read. The local session receive buffer is
refactored to retain complete-frame arrival times. Existing query and telemetry
shapes and the confirmed battery/network definitions are preserved.

## Authorization and boundary

On 2026-09-16 the owner explicitly authorized starting, pausing/stopping and
returning the mower for the controlled tests needed by this issue. This
supersedes #149's read-only test restriction. The library API remains read-only.
Physical tests use the existing official app or Home Assistant consumer and
preserve rain, child and other protections. No physical action is inferred from
an acknowledgement or an inactive task.

No mower-fork code, constants, schema, fixture or test was consulted or copied.
The received product declarations and device reports stay separate from the
existing integration's interpretation. Credentials, full identifiers, raw
reports and geometry remain on the owning host.

## Acquisition contract and freshness

The source is the protocol owner's Apache-2.0
[TuyaOpen implementation](https://github.com/tuya/TuyaOpen/blob/4e3147b3241ae15a171f284c3d812b20a26fe398/src/tuya_cloud_service/lan/tuya_lan.c).
The pinned file has SHA-256
`2e44b0b51c6a78c396a4fef4a9e0d46328788115ef6c77ff5b5c0d12bed10d17`.

- `tuya_lan_dp_report`, lines 698 to 736, broadcasts command-8 reports to
  authenticated LAN sessions. The device report sequence can be zero.
- Commands 10 and 16 return cached object data points through
  `tuya_iot_dp_obj_dump`. A newly received query reply is not a new measurement.
- Command 9 maintains the session with an empty transport heartbeat. The
  reference device expires sessions after 30 seconds without incoming traffic.
- `tuya_iot_dp_raw_report` in the same revision's
  [schema/tuya_iot_dp.c](https://github.com/tuya/TuyaOpen/blob/4e3147b3241ae15a171f284c3d812b20a26fe398/src/tuya_cloud_service/schema/tuya_iot_dp.c)
  encodes raw data points as base64 and calls the same LAN report path. This
  establishes the generic transport shape, not an E15 binary field definition.

`receiveReport()` accepts authenticated command-8 frames only and checks a
reported device ID against the session binding. It labels the result
`kind: 'device-report'`. `observedAt` is the full-frame arrival time. Reading a
buffered report later does not advance that timestamp. No prior data points or
cloud state are merged into a report.

This establishes when the client received a report. It does not establish the
device's measurement time or the meaning of an undocumented field. Consumers
must check receipt age and confirm field meaning independently.

Each read has a deadline and cancellation. Only a pending read maintains a
transport heartbeat, timed from the previous outgoing frame so frequent
incoming reports cannot postpone it indefinitely. There is no DP refresh,
arbitrary frame API, write, retry or reconnect. Input is bounded to 32 complete
frames and 128 KiB including partial input. Overflow closes the owner.

## Initial owned-device observation

- E15/T2880, owner-reported firmware 6.9.28 and iOS Anker eufy 6.1.00, as
  recorded in the [preceding receipt](E15_TELEMETRY_OBSERVATION_2026-09-16.md).
- Isolated Node 24 Linux process on the existing Home Assistant host, direct
  LAN Tuya 3.5. Base library commit
  `7117b9381aa7b3df879e11271e5d5e6cb9a116d2`, unpublished 0.13.0 candidate.
- Discovery independently matched the existing device and local-key binding
  in memory and returned 100 product schema entries. Neither secret left the
  owning host.
- The official app displayed 100% and the existing Start and Charge controls.
  Home Assistant reported docked. Rain and child protection were on, irrigation
  was off and the existing map entity was available.

One 45-second report window received a command-8 report at
**16:30:33.671 UTC**, sequence 19086, containing only DP 125. The device declares
this as `base_station_used_time`. No DP 5, 107 or 108 arrived in this window.
The read API sent no status query, DP write or refresh. Transport heartbeats
maintained its connection. The result is an observed spontaneous LAN report,
not a confirmed activity or progress definition.

At the window deadline the caller aborted the pending read. The session
reported `closed: 'aborted'`, `connected: false`, followed by client shutdown.
The temporary container exited and was removed. No physical movement occurred
in this window. The existing integration and Android map source were not
modified, paused or reloaded.

A recovery read at **16:33:06 UTC** reported docked and 100%. Rain and child
protection remained on. The map entity remained available. These are recovery
observations from the existing consumer, not new library field definitions.

A second 45-second window exercised the final heartbeat implementation on Node
24.21.0. It received no command-8 report and ended through the same bounded
cancellation and shutdown path. No activity or progress definition is inferred
from that silence. The host's compiled session matched the local build with
SHA-256 `cf170b21d60b6f0fe314205f88273432d1148e40230b1e57653db93632827b75`.

After both windows, the temporary credential and cloud-session copies were
removed and the test container was absent. The original installation's
credentials and private observation records were retained. At **16:41:39 UTC**
the existing integration again reported docked and 100%, and the map remained
available. No start, pause or return command was sent in either window.

## Owner-operated transition observation

The owner confirmed the area was clear and performed all physical controls in
the official app. The client only received reports and maintained transport
heartbeats. The agent's physical start attempts were blocked before execution,
so the agent sent no start, pause or return command. The temporary pause
watchdog was cancelled before the owner-operated test and issued no command.

The same owned device and previously recorded firmware/app tuple apply. The
official Mac app supplied an additional live view of the displayed state. Its
app version was not separately recorded. The host ran the unchanged compiled
implementation merged in PR #152, Node 24.21.0, with the session hash recorded
above.

| Window                              | Bound                                                | First and last report, UTC   | Authenticated reports | DP 107 reports | DP 108 reports | Exit                                                                  |
| ----------------------------------- | ---------------------------------------------------- | ---------------------------- | --------------------- | -------------- | -------------- | --------------------------------------------------------------------- |
| Start, pause and return preparation | 240 seconds                                          | 17:11:46.338 to 17:15:23.424 | 63                    | 17             | 2              | Caller deadline, aborted and disconnected                             |
| Return and dock observation         | At most 180 seconds, each receive at most 60 seconds | 17:16:20.276 to 17:17:31.488 | 30                    | 3              | 2              | No further report within receive deadline, timed out and disconnected |

Both windows independently matched the owned binding during discovery and used
`receiveReport()`. They sent no status query, subscription, DP write or refresh.
Each ended with `connected: false`, client shutdown and removal of its temporary
container. The second window was a separately opened observation session, not
an automatic reconnect or a replay of a physical command.

The owner reported this sequence:

1. After Start, the app showed Defogging, followed by Mowing.
2. After Pause, the owner confirmed the mower physically stood still. The Mac
   app displayed `Mowing Paused, 0%`.
3. Stopping the session displayed map saving. After Return, the app displayed
   Positioning and then Returning. These states were also visible in the Mac
   app.
4. The owner confirmed physical arrival at the dock while the app showed map
   saving. Dock arrival is based on that observation, not on inactivity or an
   acknowledgement.

DP 107 `robot_status` arrived in 20 reports across the two windows. DP 108
`battery_status` arrived four times. The device declares both as `raw` without
their internal field layout or enum definitions. The short DP 107 payloads
change during the control sequence, but the reports alone do not establish
which field describes a job, an action or a substate. For example, the start
sequence included both Defogging and Mowing. One pause and return cycle does
not establish three independent reproductions of each proposed meaning.

DP 5 was absent from all 93 reports. The Mac app displayed 0% mowing progress
during this short run, so the observations do not identify a changing
mowing-progress value. DP 118 arrived 41 times across the separate map-saving
phases, reaching 100. The app independently displayed `Saving the map: 71%`
during one of those phases. This supports keeping map-save progress separate
from mowing progress. It does not add a new mowing-progress definition.

During the first window, the existing HA mower entities became unavailable.
The map entity continued to update. After both observation sessions closed,
the existing mower integration recovered without a configuration change,
reload or restart. At **17:19:50 UTC**, HA reported docked with fresh telemetry
from **17:19:42 UTC**. A recovery read also found the map available, rain and
child protection on, and irrigation off. Concurrent operation of the existing
LAN consumer and this standalone observer is not established as reliable.

The temporary credential and cloud-session copies were removed again after the
second window. The test container was absent. The original installation and
Android map source were retained, together with the private raw reports on the
owning host. No credentials, raw captures, identifiers or geometry accompany
this receipt.

## Software evidence and remaining acceptance

The report tests use invented device identities and data. They cover command
correlation, partial reports, original arrival time across deferred consumption,
foreign device IDs, invalid JSON and authentication tags, missing reports,
exclusive ownership, cancellation, shutdown, bounded buffering and transport
heartbeat lifecycle. A separate regression covers frequent reports that would
otherwise keep postponing the heartbeat.

The acquisition implementation was merged in
[PR #152](https://github.com/keesmod/eufy-mega-client/pull/152). Its 1,139 client
tests, 44 release-tool tests, format, model-matrix and workflow checks, dependency
audit and clean-consumer package validation passed. The main-branch
[validation run](https://github.com/keesmod/eufy-mega-client/actions/runs/35123932117)
also passed.

The bounded transition windows establish fresh receipt of the declared raw
activity and battery reports. Activity and mowing progress remain
`unconfirmed`. The exact remaining limits are the undocumented binary meaning
of DP 107, insufficient repeated app correlation for each proposed definition,
and the unidentified source of changing mowing progress. DP 118 remains
map-save progress. DP 108 has no new binary definition either.

The immediate next implementation step is
[#153](https://github.com/keesmod/eufy-mega-client/issues/153), deriving the DP 107
field contract and adding evidence-gated activity decoding. Hardware definition
acceptance remains in the model matrix. No next issue is started by this run.

The candidate is staged in a private test directory only. It does not replace
the existing mower integration and does not publish version 0.13.0.
