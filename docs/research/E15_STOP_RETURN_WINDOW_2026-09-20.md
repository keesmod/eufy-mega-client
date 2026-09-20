# E15 stop and return window, 2026-09-20

Evidence for [#173](https://github.com/keesmod/eufy-mega-client/issues/173).
One bounded owner-operated hardware window sent the library's opt-in `stop`
class to the owned E15 for the first time and `return` through DP 3
`switch_charge` from the stopped task, the state in which the official app
offers Charge. `stop` over DP 1 `switch_go` false ended `reflected`, but the
device did not stop in place: it reported `returning` 0.28 seconds after the
write, drove to the dock by itself and reported the map-saving payload at dock
arrival 29.8 seconds after the write. `return` from the stopped task, which the
app's Stop with Clear Progress had reached, ended `timed_out` after 60 seconds
without a report or a physical effect, as it had from `paused` in the
[command window](E15_COMMAND_WINDOW_2026-09-19.md) the day before. The app's
Charge then returned the mower while the library kept listening on the same
session. Firmware 6.9.28 does not honour DP 3 in either state, so the library
has no DP 3 return route, and `stop` is the library route that brings the mower
home.

## Boundary

Before any command the owner confirmed in chat that the lawn was clear and the
owner stood at the mower, that the mower was docked at 100 percent with rain
and child protection on as shown by the app and by Home Assistant, that the
stop route was known (Pause, then Stop with Clear Progress and Charge in the
official app, or the physical stop button) and that temporary unavailability of
the Home Assistant mower entities was accepted. The owner gave an explicit
opt-in per command class for `start`, `stop` and `return`, and allowed the
agent to operate the app's Stop, Clear Progress and Charge controls on the
owner's own Mac. Every command waited for the owner's physical confirmation in
chat before the next one was sent. After the first cycle showed that a library
`stop` returns the mower to the dock, the owner agreed in chat to a second
cycle: `start` through the library, the app's Stop with Clear Progress pressed
by the agent to reach the stopped task on the lawn, `return` through the
library from that state, and the app's Charge as the fallback.

One container ran per command, four in total. Each invocation constructed a
client with `mowers.commands` enabled and the stop route named, connected,
discovered, matched the exact device binding, opened one local session, sent
exactly one `session.sendCommand({ kind })` and closed the session. The `stop`
helper kept receiving reports for 60 seconds after its read-back, the second
`start` helper for up to 300 seconds until the operator's stop marker ended it
after the default payload, and the `return` helper for up to 240 seconds.
Nothing retried, replayed, reconnected or retried at dependency level. The
library wrote only the declared booleans DP 1 and DP 3. Rain and child
protection were never read for a decision and never written. Dock arrival was
never inferred.

Raw outcomes and reports stay on the owning Home Assistant host. This receipt
publishes data point numbers, decoded fields, values, sequence numbers, receipt
times, displayed app text and the owner's confirmations only. No credential,
device identifier, key, address, lawn geometry, schedule detail or map image
accompanies it. Credentials and the LAN host were read from the owner's private
environment at run time and were removed after the window. The unlicensed
mower fork and the existing Home Assistant integration's interpreted states
were not used as evidence.

## Versions and setup

| Item     | Value                                                                                                                                                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device   | E15/T2880, firmware 6.9.28 as read from the cloud device record during the [reproduction window](E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md) of the previous day. The helpers of this window did not log the cloud record                                                                                                                                      |
| App      | The same Anker eufy app installation as the [command window](E15_COMMAND_WINDOW_2026-09-19.md), 6.1.00 as recorded there and not re-read, running on macOS through iOS app support. Independent reference for every command and the operator of the stop route. An enabled app mowing schedule did not cover the day of the window                              |
| Library  | `main` at `192e57e`, release 0.17.0. Compiled `dist/mowers/local/session.js` SHA-256 `152b3d01510baaabe7b23562f10f9ec668b9a833568036d20fbbfa54db0a91d4`, `dist/mowers/local/commands.js` SHA-256 `65c3911a1e073249160d5e842f159df63c4961c32f997a27bd9ddd61bf7c46ed`, `dist/index.js` SHA-256 `2fe6183b514adecc72824eefc627ecc8445c838e1cdb00e42ebc05855a39c371` |
| Runtime  | Isolated Node 24.21.0 Linux container per command on the existing Home Assistant host, host networking, read-only root, no capabilities, direct LAN Tuya 3.5. Every container was removed after its log was saved                                                                                                                                               |
| Options  | `commands: { enabled: true, stopRoute, readBackMs }` with `readBackMs` 45000 for start and stop and 60000 for return. Session `timeoutMs` 60000. Observe phases of 60 seconds after stop, up to 300 seconds after the second start and up to 240 seconds after return                                                                                           |
| Consumer | Home Assistant 2026.9.2 with the existing mower integration 0.7.0 on its local backend in observe-only mode as read from its configuration entry, tracked as a second observer. Its planning automations act only while automatic mowing or an own session is enabled, both were off. The mower bridge is not installed                                         |
| Timezone | Europe/Amsterdam, UTC+2 on this date. All times below are UTC receipt times of complete frames                                                                                                                                                                                                                                                                  |

## Commands

The fresh status query before each write, the write, the frame reply, every
fresh report received in the read-back and the independent confirmations.
Sequence numbers are the device's report sequence.

### start, DP 1 `switch_go` true, first cycle

| Time         | Event                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10:56:46.212 | Fresh query after about fourteen hours docked: DP 8 100, DP 109 72, DP 118 0, DP 134 `Wifi`, no DP 1, DP 2, DP 3 or DP 107. Frame written 10:56:46.213 |
| 10:56:46.217 | Frame reply, return code zero, not rejected                                                                                                            |
| 10:56:46.843 | Report 55265, DP 107 field 1 = 2, transitional payload                                                                                                 |
| 10:56:47.174 | Report 55266, DP 1 true and DP 2 false in one report, stage `acknowledged` through the written point                                                   |
| 10:56:47.373 | Report 55267, DP 107 fields 1 = 2 and 3 = 1, `mowing`, stage `reflected`, end `reflected`                                                              |

App: `Defogging…` with Stop for about half a minute, then `Mowing…` with Stop
and Pause. Home Assistant: `mowing` at 10:56:54. Owner: left the dock and
mowing.

### stop, DP 1 `switch_go` false, from mowing

| Time         | Event                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10:57:48.445 | Fresh query: DP 1 true, DP 2 false, DP 8 100, DP 109 72, DP 118 0. Frame written 10:57:48.446                                                               |
| 10:57:48.448 | Frame reply, return code zero, not rejected                                                                                                                 |
| 10:57:48.723 | Report 47715, DP 113 raw point                                                                                                                              |
| 10:57:48.725 | Report 47716, DP 107 fields 1 = 1 and 3 = 1, `returning`, which is not a reflection of `stop`                                                               |
| 10:57:49.008 | Report 47717, DP 1 false, stage `acknowledged` through the written point                                                                                    |
| 10:58:13.408 | Report 47720, DP 108 fields 2 = 1 and 3 = 1, then fields 1 = 1, 2 = 1 and 3 = 1 at 10:58:16.618                                                             |
| 10:58:17.758 | Report 47722, DP 113                                                                                                                                        |
| 10:58:18.036 | Report 47723, DP 1 true                                                                                                                                     |
| 10:58:18.236 | Report 47724, DP 107 fields 2 = 5 and 3 = 1, the map-saving payload reported in `payload`, stage `reflected`, end `reflected`, 29.8 seconds after the write |

The helper then received 23 reports in 60 seconds on the same session: DP 118
19 times, DP 107 twice, DP 1 and DP 158 once each.

| Time         | Event                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| 10:58:18.537 | DP 118 1, rising through 19 steps                                      |
| 10:58:35.069 | DP 118 100                                                             |
| 10:58:36.623 | DP 1 false, then DP 107 field 6 = 1 at 10:58:36.823                    |
| 10:58:50.660 | DP 107 default payload. App: Charge disabled and Start, 0.0 m² and 0 s |
| 10:59:18.240 | Observe bound, `request_aborted`, `closed: 'aborted'`, client shutdown |

App: `Returning…` with Stop and Pause from about 10:57:55, the idle controls
with Start after the default payload, no Continue. Home Assistant: `docked` at
10:57:54 from its own reading of DP 1 false, `returning` at 10:58:24, `docked`
at 10:58:44. Owner: drives back to the dock, then in the dock.

### start, DP 1 `switch_go` true, second cycle

| Time         | Event                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| 10:59:57.408 | Fresh query: DP 1 false, DP 2 false, DP 8 100, DP 109 72, DP 118 100. Frame written 10:59:57.408 |
| 10:59:57.411 | Frame reply, return code zero, not rejected                                                      |
| 10:59:57.454 | Report 44744, DP 107 field 1 = 2, transitional payload                                           |
| 10:59:57.758 | Report 44745, DP 1 true, stage `acknowledged`                                                    |
| 10:59:57.956 | Report 44746, DP 107 fields 1 = 2 and 3 = 1, `mowing`, stage `reflected`, end `reflected`        |

The helper kept the session open and received 44 reports before the
operator's stop marker: DP 118 20 times, DP 107 nine, DP 152 four, DP 109
three, DP 108 two, and DP 1, DP 104, DP 113, DP 124, DP 126 and DP 158 once
each. Before the app's Stop: DP 152 three times from 10:59:58.960, DP 107
fields 1 = 2, 2 = 9 and 3 = 1 at 11:00:01.014 while the app showed
`Defogging…`, DP 152 at 11:00:30.476, DP 107 fields 1 = 2 and 3 = 1 at
11:00:30.976 and 11:00:34.385, DP 108 fields 2 = 1 and 3 = 1 at 11:00:39.604,
DP 107 fields 1 = 2, 2 = 3 and 3 = 1 at 11:00:39.995, DP 108 field 3 = 1 at
11:00:40.308, DP 107 fields 1 = 2 and 3 = 1 at 11:00:51.072 with the app at
`Mowing…`, DP 109 67 at 11:00:59.948 and 62 at 11:01:29.990. Home Assistant:
`mowing` at 11:00:04, `unavailable` from 11:00:14 to 11:00:34 while the helper
held the session, then `mowing`. Owner: left the dock and mowing on the lawn.

### The app's Stop with Clear Progress while the library listened

The agent pressed Stop at 11:01:25 and Clear Progress at 11:01:36 on the
owner's Mac at the owner's request. The dialog read `Stop Task`, `Stop the
task, the robot will stay in current place. Do you want to clear the current
task progress?` with Keep Progress, Clear Progress and Cancel.

| Time         | Event                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11:01:38.843 | Report 44770, DP 113, then within 2 ms DP 118 0, DP 107 fields 2 = 5 and 3 = 1 and DP 104 field 1 = 8348                                             |
| 11:01:39.012 | DP 118 1, DP 107 map-saving payload again at 11:01:39.104, DP 118 rising through 19 steps. App: `Saving the map: 71%` at 11:01:44, `99%` at 11:01:53 |
| 11:01:54.445 | DP 118 100                                                                                                                                           |
| 11:01:56.299 | DP 1 false, then DP 107 field 6 = 1 at 11:01:56.498. App: `Loading…` with Charge disabled and Start                                                  |
| 11:02:00.020 | DP 109 50, DP 124 at 11:02:01.812, DP 158 at 11:02:02.907                                                                                            |
| 11:02:11.188 | DP 107 default payload, DP 126 at 11:02:12.696. App: Charge enabled and Start, 0.0 m² and 0 s. The mower stood on the lawn                           |
| 11:02:37.214 | Operator's stop marker, `request_aborted`, `closed: 'aborted'`, client shutdown                                                                      |

Home Assistant read `returning` at 11:01:44, `mowing` at 11:01:54 and `docked`
at 11:02:04 from its own interpretation while the mower stood still on the
lawn. This repeats the app-operated Stop sequence of the earlier receipts with
the same field values and one more distinct DP 104 value.

### return, DP 3 `switch_charge` true, from the stopped task

| Time         | Event                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 11:02:38.141 | Fresh query: DP 1 false, DP 2 false, DP 8 100, DP 109 50, DP 118 100, DP 3 absent. No refusal. Frame written 11:02:38.142 |
| 11:02:38.144 | Frame reply, return code zero, not rejected                                                                               |
| 11:03:38.14  | Read-back bound of 60 seconds passed without a single report. Stage `sent`, end `timed_out`                               |

App: Charge enabled and Start, unchanged at 11:02:50 and 11:03:45. Owner:
stands still, no reaction. The library resolved the outcome without a throw,
did not retry and kept the session open for the observe phase.

### The app's Charge while the library listened

The agent pressed Charge at 11:03:55. The helper received 33 reports: DP 118
18 times, DP 107 seven, DP 1, DP 108 and DP 109 twice each, DP 103 and DP 158
once each.

| Time         | Event                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11:03:56.214 | Report 2525, DP 103 field 1 = 2774, then DP 107 fields 1 = 1 and 3 = 1 at 11:03:56.215 and 11:03:56.706, `returning`. App: `Returning…` with Stop and Pause |
| 11:04:04.074 | DP 107 fields 1 = 1, 2 = 1 and 3 = 1. App: `Positioning…` at 11:04:32                                                                                       |
| 11:04:30.224 | DP 109 61, DP 107 fields 1 = 1 and 3 = 1 at 11:04:43.976, DP 109 68 at 11:05:00.256. App: `Returning…`                                                      |
| 11:05:21.342 | DP 108 fields 2 = 1 and 3 = 1, then fields 1 = 1, 2 = 1 and 3 = 1 at 11:05:24.501                                                                           |
| 11:05:25.529 | DP 118 0, DP 1 true at 11:05:25.830, DP 107 fields 2 = 5 and 3 = 1 at 11:05:26.031. Dock arrival anchors. App: `Saving the map: 10%`                        |
| 11:05:41.108 | DP 118 100 after 17 steps, DP 1 false 11:05:42.462, DP 107 field 6 = 1 11:05:42.662                                                                         |
| 11:05:57.611 | DP 107 default payload, DP 158 at 11:06:11.361. App: Charge disabled and Start. Owner: the mower stands in the dock                                         |
| 11:07:11.364 | Session hard deadline, `request_timeout`, `closed: 'timeout'`, client shutdown                                                                              |

Home Assistant: `returning` at 11:05:34, `docked` at 11:05:44.

### What the window establishes

- A plain DP 1 `switch_go` false on firmware 6.9.28 ends the task and returns
  the mower to the dock. The device reported `returning` 0.28 seconds after
  the write, the echo of DP 1 false followed 0.56 seconds after it, and the
  mower drove home without any further write. It did not stay in place with or
  without its progress. After the dock arrival the app offered Start, not
  Continue, and the task counters read 0.0 m² and 0 s. The app's Stop dialog,
  which keeps the robot in place and asks about the progress, is therefore not
  a DP 1 false write, which matches the DP 104 write the app has always
  reported before its stop sequence.
- The `stop` class ended `reflected` because the map-saving payload it treats
  as its reflection is also the dock arrival payload. On this firmware the
  `payload` of a `stop` outcome marks the dock arrival about 30 seconds after
  the write, with DP 118 reset to 0 and DP 1 true in the same second, and the
  earlier `returning` report is the first evidence of the effect. A consumer
  that wants the mower home can use `stop`. A consumer that wants the mower
  stopped in place has no library route.
- `return` through DP 3 `switch_charge` is not honoured from the stopped task
  either. The fresh query carried DP 1 false and DP 118 100, the app offered
  Charge, the frame reply arrived within 2 milliseconds, and no report or
  movement followed in 60 seconds. Together with the `paused` result of the
  previous day, DP 3 has now been ignored in both states the library can send
  it from. DP 3 remained absent from every fresh query and every report of all
  windows. The library has no DP 3 return route on this firmware.
- The app's Charge from the stopped task produced DP 103 field 1 = 2774 and
  `returning` within 2 milliseconds, and the dock arrival, map save, DP 1
  false, field 6 = 1 and default payload followed as in every earlier cycle.
  The app's Stop with Clear Progress produced DP 104 field 1 = 8348. Both
  values are again distinct from every earlier value and stay uninterpreted.
- None of the library's three writes that had an effect produced a DP 103,
  104, 105 or 106 report, and the ignored DP 3 write produced nothing. The
  written point echoed 0.35 to 0.96 seconds after the write and was the
  acknowledgement anchor of every completed command.
- After about fourteen hours docked the fresh query carried no DP 1, DP 2 or
  DP 3 and reported DP 118 0. `start` has no precondition on those points and
  ran. A `return` sent in that state is refused with
  `mower_command_task_active`, because an absent DP 1 is not `false`. After
  the first activity every query carried DP 1, DP 2 and DP 118 100.
- Two DP 107 field 2 values appeared that no earlier receipt recorded: fields
  1 = 2, 2 = 9 and 3 = 1 while the app showed `Defogging…` after the second
  start, and fields 1 = 2, 2 = 3 and 3 = 1 together with DP 108 while the
  mower left the dock. Both are app-correlated observations only and remain
  undecoded.

## Home Assistant, protections and cleanup

The Home Assistant lawn mower entity tracked `mowing`, `docked`, `returning`
and `docked` again for the first cycle, `mowing` with 20 seconds of
`unavailable` for the second start, `returning`, `mowing` and `docked` for the
app's Stop while the mower stood on the lawn, and `returning` at 11:05:34 and
`docked` at 11:05:44 for the app's Charge, all through its own local backend
and its own interpretation. Battery read 100 before and after. Rain stop and
child protection read `on` before and after the window and were never written.
The app's task counters ended at 0.0 m² and 0 s.

Four containers ran, one per command, each removed after its sanitized log was
saved. The credential copy, the session file and the stop marker were removed.
The four outcome files, the three raw report files and the sanitized logs
remain on the host in a private directory. No repository, fixture, test or log
received a credential, identifier, key or geometry.

## Software

The command path of release 0.17.0 ran unchanged from `main` at `192e57e`.
The full suite of 1185 synthetic tests, including
`test/mower-commands.test.mjs`, passed on the same source with this receipt.
No code changed for this receipt.

## Exact remaining limits

- `return` through DP 3 `switch_charge` is not honoured by firmware 6.9.28
  from `paused` or from the stopped task. The command stays declared and
  documented with its precondition, a consumer must treat a `timed_out` return
  as no effect, and the library has no DP 3 return route. No library write of
  the raw control points DP 103 or DP 104 is established, because the meaning
  of their field 1 value is unknown.
- `stop` was sent once, from mowing about a minute after a start and close to
  the dock. `stop` from `paused`, from a task far from the dock or after a
  long run, `stop` while returning, and whether the firmware ever keeps the
  mower in place on DP 1 false were not exercised. The library cannot stop the
  mower in place.
- One window and one cycle per class: two starts from docked, one stop from
  mowing, one return from the stopped task. Start after the app's Stop with
  the mower kept in place, pause while returning, commands during a map save,
  and refusals by low battery, rain or the child lock were not exercised.
- There is still no docked, charging, idle or error activity payload. Dock
  arrival remains an anchor (DP 118 reset to 0 with DP 1 true and the
  map-saving payload) outside every command lifecycle, and after a `stop` it
  coincides with the reflection.
- The fresh query after a long docked idle omits DP 1, DP 2 and DP 3 and
  reports DP 118 0, so a `return` sent then is refused before any write. Which
  idle duration causes this is unknown.
