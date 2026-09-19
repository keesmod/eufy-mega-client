# E15 opt-in command window, 2026-09-19

Evidence for [#169](https://github.com/keesmod/eufy-mega-client/issues/169).
One bounded owner-operated hardware window sent the library's opt-in commands
to the owned E15 for the first time. `start`, `pause`, `resume` and a second
`pause` each ended `reflected` from fresh reports within 1.2 seconds of the
write. `return` through DP 3 `switch_charge` ended `timed_out` after 60 seconds
without a report or a physical effect. The official app's Stop, Clear Progress
and Charge controls then returned the mower to the dock while the library kept
listening on the same session.

## Boundary

Before any command the owner confirmed in chat that the lawn was clear and the
owner stood at the mower, that the mower was docked at 100 percent with rain
and child protection on as shown by the app and by Home Assistant, that the
stop route was known (Pause, then Stop with Clear Progress and Charge in the
official app, or the physical stop button) and that temporary unavailability of
the Home Assistant mower entities was accepted. The owner gave an explicit
opt-in per command class for `start`, `pause`, `resume` and `return`, and asked
the agent to operate the app's stop route on the owner's own Mac if the return
through DP 3 was not honoured. Every command waited for the owner's physical
confirmation in chat before the next one was sent.

One container ran per command. Each invocation constructed a client with
`mowers.commands` enabled and the stop route named, connected, discovered,
matched the exact device binding, opened one local session, sent exactly one
`session.sendCommand({ kind })` and closed the session. Nothing retried,
replayed, reconnected or retried at dependency level. The library wrote only
the declared booleans DP 1, DP 2 and DP 3. Rain and child protection were never
read for a decision and never written. Dock arrival was never inferred.

Raw outcomes and reports stay on the owning Home Assistant host. This receipt
publishes data point numbers, decoded fields, values, sequence numbers, receipt
times, displayed app text and the owner's confirmations only. No credential,
device identifier, key, address, lawn geometry or map image accompanies it.
Credentials and the LAN host were read from the owner's private environment at
run time and were removed after the window. The unlicensed mower fork and the
existing Home Assistant integration's interpreted states were not used as
evidence.

## Versions and setup

| Item     | Value                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device   | E15/T2880, firmware 6.9.28 as read from the cloud device record during the same-day [reproduction window](E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md). The helper of this window did not log the cloud record                                                                  |
| App      | Anker eufy iOS app 6.1.00, build 260908221344, running on macOS through iOS app support. Independent reference for every command and the operator of the stop route                                                                                                             |
| Library  | `main` at `48a80d9` (0.16.0 candidate, PR #171). Compiled `dist/mowers/local/session.js` SHA-256 `6e1ba766906dbea7506befd6571bd04662f9854542781a3c5abb3b456c344677`, `dist/mowers/local/commands.js` SHA-256 `c294de2543b97656d4fabcd881bcf1312c29bb3fa49580186c1610690a2cf1c4` |
| Runtime  | Isolated Node 24.21.0 Linux container per command on the existing Home Assistant host, host networking, read-only root, no capabilities, direct LAN Tuya 3.5. Every container was removed after its log was saved                                                               |
| Options  | `commands: { enabled: true, stopRoute, readBackMs }` with `readBackMs` 45000 for start, 20000 for pause and resume and 60000 for return. The return helper kept receiving reports for 240 seconds after the read-back. Session `timeoutMs` 60000                                |
| Consumer | Home Assistant 2026.9.2 with the existing mower integration 0.7.0 on its local backend in control mode, tracked as a second observer. Its planning automations act only while automatic mowing or an own session is enabled, both were off. The mower bridge is not installed   |
| Timezone | Europe/Amsterdam, UTC+2 on this date. All times below are UTC receipt times of complete frames                                                                                                                                                                                  |

## Commands

The fresh status query before each write, the write, the frame reply, every
fresh report received in the read-back and the independent confirmations.
Sequence numbers are the device's report sequence.

### start, DP 1 `switch_go` true

| Time         | Event                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------- |
| 16:42:38.198 | Fresh query: DP 1 false, DP 2 false, DP 8 100, DP 118 100, DP 134 `Wifi`, no DP 3, no DP 107 |
| 16:42:38.199 | Frame written                                                                                |
| 16:42:38.202 | Frame reply, return code zero, not rejected                                                  |
| 16:42:38.799 | Report 63858, DP 107 field 1 = 2, transitional payload, `invalid` for the definitions        |
| 16:42:39.150 | Report 63859, DP 1 true, stage `acknowledged` through the written point                      |
| 16:42:39.351 | Report 63860, DP 107 fields 1 = 2 and 3 = 1, `mowing`, stage `reflected`, end `reflected`    |

App: `Mowing…` with Stop and Pause. Home Assistant: `mowing` at 16:43:23. Owner:
left the dock and mowing.

### pause, DP 2 `pause` true

| Time         | Event                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| 16:44:36.98  | Fresh query: DP 1 true, DP 2 false, DP 118 100. Frame written 16:44:36.984                |
| 16:44:36.986 | Frame reply, return code zero, not rejected                                               |
| 16:44:37.335 | Report 29596, DP 2 true, stage `acknowledged`                                             |
| 16:44:37.532 | Report 29597, DP 107 fields 1 = 2 and 3 = 2, `paused`, stage `reflected`, end `reflected` |

App: `Mowing Paused` with Continue, duration 1 m 3 s. Home Assistant: `paused`
at 16:44:53. Owner: standstill.

### resume, DP 2 `pause` false

| Time         | Event                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------- |
| 16:45:05.44  | Fresh query: DP 1 true, DP 2 true, DP 118 100. Frame written 16:45:05.445                |
| 16:45:05.447 | Frame reply, return code zero, not rejected                                              |
| 16:45:05.791 | Report 5923, DP 2 false, stage `acknowledged`                                            |
| 16:45:05.992 | Report 5924, DP 107 fields 1 = 2 and 3 = 1, `mowing`, stage `reflected`, end `reflected` |

App: `Mowing…` with Stop and Pause. Home Assistant: `mowing` at 16:45:24. Owner:
mowing again.

### pause, second cycle, DP 2 `pause` true

| Time         | Event                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------- |
| 16:46:14.42  | Fresh query: DP 1 true, DP 2 false, DP 118 100. Frame written 16:46:14.422               |
| 16:46:14.425 | Frame reply, return code zero, not rejected                                              |
| 16:46:14.802 | Report 3564, DP 2 true, stage `acknowledged`                                             |
| 16:46:15.002 | Report 3565, DP 107 fields 1 = 2 and 3 = 2, `paused`, stage `reflected`, end `reflected` |

App: `Mowing Paused` with Continue, duration 2 m 10 s, task area 0.9 m². Owner:
standstill.

### return, DP 3 `switch_charge` true, from paused

| Time         | Event                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------- |
| 16:46:39.24  | Fresh query: DP 1 true, DP 2 true, DP 118 100, DP 3 absent. No map save in progress, no refusal |
| 16:46:39.240 | Frame written                                                                                   |
| 16:46:39.242 | Frame reply, return code zero, not rejected                                                     |
| 16:47:39.24  | Read-back bound of 60 seconds passed without a single report. Stage `sent`, end `timed_out`     |

App: stayed `Mowing Paused` with Continue at 16:47:10 and 16:47:55. Owner: no
movement. The library resolved the outcome without a throw, did not retry and
kept the session open for the observe phase.

### What the five commands establish

- The written boolean point echoed as a fresh report 0.35 to 0.95 seconds after
  the write and was the acknowledgement anchor of every completed command. The
  confirmed DP 107 activity followed the echo by about 0.2 seconds.
- None of the library's writes produced a DP 103, DP 105 or DP 106 report. In
  the app-operated windows those raw control points preceded every DP 1 or DP 2
  change. They are therefore written by the app itself and are not the
  firmware's acknowledgement of a boolean change. The read-back's control-point
  anchor never fired in this window, the written-point anchor did every time.
- The frame reply with return code zero arrived within 3 milliseconds for all
  five writes, including the return that had no effect. A reply is not an
  acknowledgement, as documented.
- DP 3 `switch_charge` was absent from every fresh query and from every report
  of this window and of the two earlier windows. Firmware 6.9.28 accepts the
  write at frame level and ignores it. `return` through DP 3 is not honoured on
  the owned device.

## The app's stop route while the library listened

The return helper kept the same session open for 240 seconds after the
read-back and received 66 reports: DP 118 42 times, DP 107 11, DP 1 three, DP
108 two, DP 113 two, DP 158 two, and DP 2, DP 103, DP 104 and DP 124 once each.
The agent pressed the app controls on the owner's Mac at the owner's request.

| Time         | Event                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16:48:20.599 | Stop with Clear Progress pressed. DP 113, then within 2 ms DP 118 0, DP 2 false, DP 113, DP 107 fields 2 = 5 and 3 = 1 twice, DP 104 field 1 = 8131 |
| 16:48:20.778 | DP 118 1, rising through 42 steps                                                                                                                   |
| 16:48:36.706 | DP 118 100. App: `Saving the map: 100%`                                                                                                             |
| 16:48:38.611 | DP 1 false, then DP 107 field 6 = 1 at 16:48:38.811                                                                                                 |
| 16:48:44.4   | DP 124 and DP 158 raw points                                                                                                                        |
| 16:48:54.003 | DP 107 default payload. App: Charge and Start available                                                                                             |
| 16:49:10.173 | Charge pressed. DP 103 field 1 = 4914, DP 107 field 1 = 1 at 16:49:10.175                                                                           |
| 16:49:10.664 | DP 107 fields 1 = 1 and 3 = 1, `returning`. App: `Returning…` with Stop and Pause                                                                   |
| 16:49:17.594 | DP 107 fields 1 = 1, 2 = 1 and 3 = 1, then 1 = 1 and 3 = 1 again at 16:49:30.668                                                                    |
| 16:50:08.388 | DP 108 fields 2 = 1 and 3 = 1, then fields 1 = 1, 2 = 1 and 3 = 1 at 16:50:11.597                                                                   |
| 16:50:12.613 | DP 118 0, DP 1 true at 16:50:12.914, DP 107 fields 2 = 5 and 3 = 1 at 16:50:13.115. Dock arrival anchors                                            |
| 16:50:28.996 | DP 118 100 after 19 steps, DP 1 false 16:50:30.449, DP 107 field 6 = 1 16:50:30.649, DP 158 16:50:33.995                                            |
| 16:50:45.947 | DP 107 default payload. Owner: the mower stands in the dock                                                                                         |
| 16:51:39.244 | Observe deadline. `request_aborted`, `closed: 'aborted'`, client shutdown                                                                           |

This repeats the map-saving, Charge, positioning, returning and dock sequence
of the reproduction receipt with the same field values and adds one more
app-correlated `returning` cycle. The working return route on this device is
the app's Stop, Clear Progress and Charge sequence over the raw control points
DP 104 and DP 103, whose field 1 values (8131 and 4914 here, again distinct
from every earlier value) remain uninterpreted.

## Home Assistant, protections and cleanup

The Home Assistant lawn mower entity tracked `mowing` at 16:43:23, `paused` at
16:44:53, `mowing` at 16:45:24 and `docked` at 16:52:03 through its own local
backend. Battery stayed at 100. Rain stop and child protection read `on` before
and after the window and were never written. The app's task counters ended at
0.9 m² and 2 m 10 s.

Five containers ran, one per command, each removed after its sanitized log was
saved. The credential copy, the session file and the stop marker were removed.
The outcome files, the raw report file of the return window and the sanitized
logs remain on the host in a private directory. No repository, fixture, test or
log received a credential, identifier, key or geometry.

## Software

The command path of PR #171 ran unchanged from `main` at `48a80d9`. The
synthetic tests in `test/mower-commands.test.mjs` passed on the same build
before the window (20 tests). No code changed for this receipt.

## Exact remaining limits

- `return` through DP 3 `switch_charge` is not honoured by firmware 6.9.28. The
  command stays declared and documented, and a consumer must treat a
  `timed_out` return as no effect. No library write of the raw control points
  DP 104 or DP 103 is established, because the meaning of their field 1 value
  is unknown.
- One window and one cycle per command class: start from docked, pause from
  mowing, resume from paused, pause from mowing, return from paused. Start after
  a Stop, pause while returning, resume after a long pause, commands during a
  map save or the app's Loading phase, and refusals by low battery, rain or the
  child lock were not exercised.
- There is still no docked, charging, idle or error activity payload. Dock
  arrival remains an anchor (DP 118 reset to 0 with DP 1 true and the map-saving
  payload) outside every command lifecycle.
- The `acknowledged` stage through a raw control point never occurred for a
  library write. Whether any firmware emits DP 103 to 106 without an app write
  is unknown.
