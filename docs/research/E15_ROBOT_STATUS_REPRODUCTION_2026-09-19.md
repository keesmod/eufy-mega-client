# E15 DP 107 `robot_status` reproduction window, 2026-09-19

Evidence for [#156](https://github.com/keesmod/eufy-mega-client/issues/156).
One owner-operated hardware window reproduced the three withheld DP 107
candidates of the [contract receipt](E15_ROBOT_STATUS_CONTRACT_2026-09-16.md)
through three start, pause and return cycles. Each candidate reached at least
three independent, app-correlated reproductions and is promoted to `confirmed`
in `E15_TELEMETRY_DEFINITIONS`. Field 2 values, field 6 and the default payload
were correlated with the displayed app text where possible and stay withheld.

## Boundary

The library only listened. The observer opened one read-only local session per
window through `EufyClient.mowers.connect()`, `discover()` and
`openLocalSession()` and looped `session.receiveReport()`. It sent no status
query, DP write, refresh, setting or command, and it never retried or
reconnected. Every physical action came from the official app. The owner
confirmed the prerequisites of the issue in chat, stood at the mower during the
whole window, confirmed physical mowing, standstill at every pause and arrival
at the dock after every return, and explicitly asked the agent to press the app
controls on the owner's own Mac while supervising. Rain and child protection
stayed on. Nothing was inferred from inactivity or from an acknowledgement.

Raw reports stay on the owning Home Assistant host. This receipt publishes
field numbers, values, counts, receipt times and displayed app text only. No
credential, device identifier, key, lawn geometry, map image or address
accompanies it. Credentials and the LAN host were read from the owner's
private environment at run time and were never written to a repository, a
fixture or a log. The unlicensed mower fork and the existing Home Assistant
integration's interpreted states were not used as evidence.

## Versions and setup

| Item     | Value                                                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device   | E15/T2880, firmware 6.9.28. The observer read `6.9.28` from the cloud device record's software version during discovery, matching the owner-reported value of the previous receipts                                                          |
| App      | Anker eufy iOS app 6.1.00, build 260908221344, running on macOS through iOS app support. This is the same app the earlier receipts called the Mac app, so its version is now recorded                                                        |
| Library  | `main` at `bcbecea` (0.14.0 release). The mower module is unchanged since 0.13.0. Compiled `dist/mowers/local/session.js` SHA-256 `cf170b21d60b6f0fe314205f88273432d1148e40230b1e57653db93632827b75`, identical to the two previous receipts |
| Runtime  | Isolated Node 24.21.0 Linux container on the existing Home Assistant host, host networking, read-only root, no capabilities, direct LAN Tuya 3.5. Removed after the window                                                                   |
| Timezone | Europe/Amsterdam, UTC+2 on this date. All times below are UTC receipt times of complete frames                                                                                                                                               |
| Bound    | 15 minutes per observer, session `timeoutMs` 60000, one `receiveReport()` at a time                                                                                                                                                          |

## Windows

The library closes a session when no report arrives within the session timeout
of one read. A docked, idle mower stays silent for longer than 60 seconds, so
the first session timed out before any control was pressed. The second session
was opened while the owner was ready and received the first two cycles. A third
session was opened for the last cycle because the second window's 15-minute
bound would have expired in the middle of it. Each session was opened
separately and closed cleanly. None reconnected or replayed anything.

| Window | Opened       | Closed       | Exit                                                        | Reports | DP 107 | DP 108 | DP 118 |
| ------ | ------------ | ------------ | ----------------------------------------------------------- | ------- | ------ | ------ | ------ |
| 1      | 14:43:20.973 | 14:44:20.975 | `request_timeout` after 60 s of idle silence, no press made | 0       | 0      | 0      | 0      |
| 2      | 14:44:39.855 | 14:55:25.998 | Caller stop, `request_aborted`, `closed: 'aborted'`         | 179     | 40     | 8      | 84     |
| 3      | 14:55:27.641 | 14:59:23.431 | Caller stop, `request_aborted`, `closed: 'aborted'`         | 80      | 19     | 4      | 34     |

The 259 authenticated reports carried one data point each: DP 1 twelve times,
DP 2 eight, DP 103 six, DP 104 three, DP 105 four, DP 106 once, DP 107 59, DP
108 twelve, DP 109 four, DP 118 118, DP 126 twice, DP 134 twice, and the raw
points 102, 113, 124, 143, 152 and 158 together 28 times. All 115 raw values
decoded as valid base64. Every DP 107 payload parsed as varint records in
fields 1, 2, 3 or 6, or as the single-zero-byte default payload. No new field
number, wire type or length appeared.

## Cycles

The agent pressed the controls on the app's device page. `Stop` opens a dialog
that asks whether to keep or clear the task progress. `Clear Progress` was
chosen every time so that each cycle started from a cleared task. `Charge` is
the app's return-to-dock control and becomes available only after `Stop` and
the map save that follows it. App text was read from the same page within a
few seconds of each change. The owner confirmed the physical observations in
chat.

### Cycle 1, window 2

| Receipt time | DP 107 fields       | Anchors in the same second                                                                                            | App text and physical observation                                        |
| ------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 14:44:45.384 | 1 = 2               | DP 103 `start_control` 14:44:45.341, DP 1 true at 45.645                                                              | Start pressed                                                            |
| 14:44:45.845 | 1 = 2, 3 = 1        |                                                                                                                       | Mowing… displayed by 14:45:00, owner confirmed the mower was mowing      |
| 14:44:51.459 | 1 = 2, 3 = 1        |                                                                                                                       |                                                                          |
| 14:44:55.969 | 1 = 2, 2 = 3, 3 = 1 | DP 108 fields 2 = 1 and 3 = 1 at 55.480, DP 108 field 3 = 1 at 56.286                                                 | Mowing… 0%                                                               |
| 14:45:07.199 | 1 = 2, 3 = 1        |                                                                                                                       |                                                                          |
| 14:46:20.971 | 1 = 2, 3 = 2        | DP 105 `pause_control` 14:46:20.973, DP 2 true at 21.175                                                              | Pause pressed. Mowing Paused, 0%. Owner confirmed standstill             |
| 14:47:01.767 | 1 = 2, 3 = 1        | DP 106 `resume_control` 14:47:01.763, DP 2 false at 02.054                                                            | Continue pressed. Mowing…, 1% at 14:47:15, area 0.7 m², duration 1 m 7 s |
| 14:47:02.254 | 1 = 2, 3 = 1        |                                                                                                                       |                                                                          |
| 14:47:47.888 | 1 = 2, 3 = 2        | DP 105 at 14:47:47.886, DP 2 true at 47.958                                                                           | Pause pressed. Mowing Paused, 1%. Owner confirmed standstill             |
| 14:48:27.192 | 2 = 5, 3 = 1, twice | DP 104 `stop_control`, DP 2 false, DP 118 reset to 0 then rising                                                      | Stop pressed, Clear Progress. Saving the map: 99% at 14:48:35            |
| 14:48:44.984 | 6 = 1               | DP 118 reached 100 at 42.828, DP 1 false at 44.783                                                                    | Loading…, then Charge and Start controls                                 |
| 14:49:00.579 | default payload     |                                                                                                                       |                                                                          |
| 14:49:03.441 | 1 = 1               | DP 103 at 14:49:03.439                                                                                                | Charge pressed                                                           |
| 14:49:03.938 | 1 = 1, 3 = 1        |                                                                                                                       | Positioning… at 14:49:15                                                 |
| 14:49:11.310 | 1 = 1, 2 = 1, 3 = 1 |                                                                                                                       |                                                                          |
| 14:49:35.379 | 1 = 1, 3 = 1        | DP 134 `None` at 33.526 and `Wifi` at 34.749                                                                          | Returning… at 14:49:40                                                   |
| 14:50:35.459 | 2 = 5, 3 = 1        | DP 108 fields 2 = 1 and 3 = 1 at 30.800, fields 1, 2 and 3 = 1 at 34.013, DP 118 reset at 34.958, DP 1 true at 35.259 | Saving the map: 99% at 14:50:50. Owner confirmed arrival at the dock     |
| 14:50:53.291 | 6 = 1               | DP 118 reached 100 at 51.737, DP 1 false at 53.092                                                                    | Idle controls, Charge greyed out                                         |
| 14:51:06.781 | default payload     |                                                                                                                       |                                                                          |

### Cycle 2, window 2

| Receipt time | DP 107 fields       | Anchors in the same second                                                             | App text and physical observation                                           |
| ------------ | ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 14:51:17.979 | 1 = 2               | DP 103 at 14:51:17.977, DP 1 true at 18.273                                            | Start pressed                                                               |
| 14:51:18.473 | 1 = 2, 3 = 1        |                                                                                        |                                                                             |
| 14:51:21.129 | 1 = 2, 2 = 9, 3 = 1 |                                                                                        | Defogging… at 14:51:35                                                      |
| 14:51:51.091 | 1 = 2, 3 = 1        |                                                                                        |                                                                             |
| 14:51:54.648 | 1 = 2, 3 = 1        |                                                                                        |                                                                             |
| 14:51:59.106 | 1 = 2, 2 = 3, 3 = 1 | DP 108 fields 2 = 1 and 3 = 1 at 58.673, field 3 = 1 at 59.377                         | Mowing… 0% at 14:51:58                                                      |
| 14:52:10.184 | 1 = 2, 3 = 1        |                                                                                        |                                                                             |
| 14:52:23.989 | 1 = 2, 3 = 2        | DP 105 at 14:52:23.987, DP 2 true at 24.169                                            | Pause pressed. Mowing Paused, 0%. Owner confirmed standstill                |
| 14:52:45.316 | 2 = 5, 3 = 1, twice | DP 104, DP 2 false, DP 118 reset then rising                                           | Stop pressed, Clear Progress. Saving the map                                |
| 14:53:06.105 | 6 = 1               | DP 118 reached 100 at 04.100, DP 1 false at 05.905                                     | Loading…                                                                    |
| 14:53:19.590 | default payload     |                                                                                        | A Charge press during Loading… at 14:53:18 produced no report and no change |
| 14:53:33.960 | 1 = 1               | DP 103 at 14:53:33.958                                                                 | Charge pressed again from the idle controls                                 |
| 14:53:34.444 | 1 = 1, 3 = 1        |                                                                                        | Positioning… at 14:53:45                                                    |
| 14:53:40.906 | 1 = 1, 2 = 1, 3 = 1 |                                                                                        |                                                                             |
| 14:53:41.409 | 1 = 1, 2 = 1, 3 = 1 |                                                                                        |                                                                             |
| 14:53:55.444 | 1 = 1, 3 = 1        |                                                                                        | Returning… at 14:54:05                                                      |
| 14:54:35.735 | 2 = 5, 3 = 1        | DP 108 at 31.192 and 34.402 as in cycle 1, DP 118 reset at 35.235, DP 1 true at 35.535 | Saving the map: 99%. Owner confirmed arrival at the dock                    |
| 14:54:57.978 | 6 = 1               | DP 118 reached 100, DP 1 false                                                         |                                                                             |
| 14:55:12.014 | default payload     |                                                                                        | Idle controls. Window 2 was stopped at 14:55:25.998                         |

### Cycle 3, window 3

| Receipt time | DP 107 fields       | Anchors in the same second                                                         | App text and physical observation                                            |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 14:55:33.251 | 1 = 2               | DP 103 at 14:55:33.249, DP 1 true at 33.543                                        | Start pressed                                                                |
| 14:55:33.742 | 1 = 2, 3 = 1        |                                                                                    |                                                                              |
| 14:55:36.398 | 1 = 2, 2 = 9, 3 = 1 |                                                                                    | Defogging… at 14:55:50 and still at 14:56:08                                 |
| 14:56:06.411 | 1 = 2, 3 = 1        |                                                                                    |                                                                              |
| 14:56:09.817 | 1 = 2, 3 = 1        |                                                                                    |                                                                              |
| 14:56:14.276 | 1 = 2, 2 = 3, 3 = 1 | DP 108 fields 2 = 1 and 3 = 1 at 13.790, field 3 = 1 at 14.592                     | Mowing… 0% at 14:56:15                                                       |
| 14:56:25.509 | 1 = 2, 3 = 1        |                                                                                    |                                                                              |
| 14:56:50.866 | 1 = 2, 3 = 2        | DP 105 at 14:56:50.863, DP 2 true at 50.866                                        | Pause pressed. Mowing Paused, 0%. Owner confirmed standstill                 |
| 14:57:10.126 | 2 = 5, 3 = 1, twice | DP 104, DP 2 false, DP 118 reset then rising                                       | Stop pressed, Clear Progress. Saving the map: 100% at 14:57:30               |
| 14:57:27.840 | 6 = 1               | DP 118 reached 100 at 25.836, DP 1 false at 27.640                                 |                                                                              |
| 14:57:43.283 | default payload     |                                                                                    | Idle controls                                                                |
| 14:57:47.483 | 1 = 1               | DP 103 at 14:57:47.481                                                             | Charge pressed                                                               |
| 14:57:47.999 | 1 = 1, 3 = 1        |                                                                                    | Positioning… at 14:58:05                                                     |
| 14:57:55.176 | 1 = 1, 2 = 1, 3 = 1 |                                                                                    |                                                                              |
| 14:58:05.413 | 1 = 1, 3 = 1        |                                                                                    | Returning… at 14:58:20                                                       |
| 14:58:42.103 | 2 = 5, 3 = 1        | DP 108 at 37.485 and 40.696 as before, DP 118 reset at 41.601, DP 1 true at 41.916 | Saving the map: 100%. Owner confirmed arrival at the dock                    |
| 14:58:59.533 | 6 = 1               | DP 118 reached 100, DP 1 false                                                     |                                                                              |
| 14:59:13.468 | default payload     |                                                                                    | Idle controls, Charge greyed out, 100%. Window 3 was stopped at 14:59:23.431 |

## Candidate tally

A reproduction is one control transition whose DP 107 payload arrived while
the app displayed the corresponding text and the owner confirmed the physical
state. Repeated payloads within one phase count once.

| Candidate                    | Reading     | Reproductions                                                                                                                                                                     | Level       |
| ---------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Field 1 = 2 with field 3 = 1 | `mowing`    | 2026-09-16 17:11:47.615, then 14:44:45.845, 14:47:01.767, 14:51:18.473 and 14:55:33.742 above. Five transitions, four Start presses and one Continue, each with Mowing… displayed | `confirmed` |
| Field 1 = 2 with field 3 = 2 | `paused`    | 2026-09-16 17:13:40.485, then 14:46:20.971, 14:47:47.888, 14:52:23.989 and 14:56:50.866. Five pauses, each with Mowing Paused displayed and standstill confirmed                  | `confirmed` |
| Field 1 = 1 with field 3 = 1 | `returning` | 2026-09-16 17:15:15.786 to 17:15:23, then 14:49:03.938, 14:53:34.444 and 14:57:47.999. Four returns, each with Positioning… and Returning… displayed and dock arrival confirmed   | `confirmed` |

The `mowing` payload also arrives while the app displays Defogging…, see
below. Its reading is therefore a running mowing job, including the defogging
phase before the blade phase, not a guarantee that grass is being cut.

## Field 2, field 6 and the default payload

| Value                                | Observations                                                                                                                                                                                                                                    | Result                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field 2 = 9 with 1 = 2 and 3 = 1     | 14:51:21.129 and 14:55:36.398, three seconds after Start, while Defogging… was displayed. Absent in cycle 1 of this window. Seen once on 2026-09-16 without a noted app state                                                                   | Two app-correlated reproductions. Stays `observed`, not shipped                                                                                   |
| Field 2 = 3 with 1 = 2 and 3 = 1     | 14:44:55.969, 14:51:59.106 and 14:56:14.276, each within a few seconds of the app changing from Defogging… to Mowing…, each bracketed by DP 108 fields 2 = 1 and 3 = 1 before and field 3 = 1 after. The next DP 107 report omits field 2 again | Three coincidences with the displayed change, but the value is present in one report only and is not a persistent substate. Recorded, not shipped |
| Field 2 = 1 with 1 = 1 and 3 = 1     | 14:49:11.310, 14:53:40.906 and 14:57:55.176, seven to eight seconds after every return control, while Positioning… was displayed. Returning… appeared 20 to 30 seconds later without a DP 107 change                                            | No app change coincides. Unknown, not shipped                                                                                                     |
| Field 2 = 5 with 3 = 1               | Twice after every Stop and once at every dock arrival, eight phases including 2026-09-16, always with DP 118 rising and Saving the map displayed                                                                                                | Reproduced map-saving phase. `MowerActivity` has no map-saving value, so it stays data and is not decoded                                         |
| Field 2 = 6                          | Not observed in this window                                                                                                                                                                                                                     | Unchanged `hypothesis`                                                                                                                            |
| Field 6 = 1 alone                    | Six times, 0.2 seconds after DP 1 turned false and one to two seconds after DP 118 reached 100, after Stop in the field and after dock arrival alike. The app then showed Loading… and the idle controls                                        | Marks the end of a map save both in the field and at the dock, so it is neither `docked` nor `idle`. Not shipped                                  |
| Default payload                      | Six times, 13.5 to 15.6 seconds after field 6 = 1, in the field and at the dock alike, with the idle controls displayed                                                                                                                         | Cannot mean `docked`. Not shipped                                                                                                                 |
| Field 1 = 2 alone, field 1 = 1 alone | The first DP 107 report after every Start and every Charge, two milliseconds after DP 103 and about half a second before the report that adds field 3                                                                                           | Transitional first frame. No confirmed candidate claims it, so the decoder reports `invalid` for that one report                                  |

## Defogging

Defogging… was displayed for about 20 to 35 seconds after Start in cycles 2 and
3 and was reported by the owner on 2026-09-16. During that phase DP 107 carried
1 = 2 alone, 1 = 2 with 3 = 1, and 1 = 2 with 2 = 9 and 3 = 1. The persistent
fields 1 and 3 do not distinguish it from mowing. The only distinguishing
values are the transient field 2 events 9 and 3, and 2 = 9 has two
app-correlated reproductions. Defogging is therefore recorded as
indistinguishable from `mowing` in DP 107 at the current evidence level.

## Mowing progress, network and DP 108

The app showed 0% at three pauses and 1% at the second pause, after about 75
seconds of cumulative mowing with a displayed area of 0.7 m². No data point
changed alongside it. DP 126, declared `mow_blade_used_time` in minutes, rose
from 924 to 925 at 14:47:33.975, a cumulative counter. DP 118 followed the
separate map-saving phases from 0 to 100 six times and stays map-save
progress. Mowing progress remains `unconfirmed` without a candidate.

DP 134 `net_media_type` reported `None` at 14:49:33.526 and `Wifi` 1.2 seconds
later during the first return. `None` is now observed once. The registry keeps
mapping `Wifi` only. DP 109 reported 55, 54, 41 and 47 percent during the
window.

DP 108 `battery_status` arrived twelve times in a repeating pattern: fields 2 =
1 and 3 = 1 followed by field 3 = 1 alone around each field 2 = 3 event, and
fields 2 = 1 and 3 = 1 followed by fields 1, 2 and 3 = 1 one to five seconds
before each dock arrival. No definition is proposed for it.

## Home Assistant, protections and cleanup

The existing mower entities became unavailable for 10 to 20 seconds each time
an observer session opened, at 14:44:40, 14:51:30 and 14:55:50, and recovered
on their own each time without a reload or restart. At 14:59:36 the existing
integration reported docked with a state change at 14:59:31, 100% battery, rain
stop and child protection on, irrigation off and the map image updated at
14:59:01. The app showed the idle controls with Charge greyed out and 100%.
These are recovery observations, not evidence for any definition.

Both observers exited with `connected: false`, `closed: 'aborted'` and client
shutdown. The containers were removed and their absence verified. The
temporary credential copy and the cloud session copy were removed and their
absence verified. Raw reports remain on the owning host. Rain and child
protection were not changed. The Android map source was not touched. No
firmware, app or integration was changed.

## Software

`E15_TELEMETRY_DEFINITIONS` now ships the three DP 107 candidates at
`confirmed`, citing this receipt. `decodeMowerTelemetry` and
`session.queryTelemetry()` therefore report `status` as `mowing`, `paused` or
`returning` on the owned device whenever DP 107 carries one of the three
matching payloads, with or without a field 2 value. The transitional first
frames, the map-saving payload, field 6 and the default payload make the field
`invalid` for that report, and an absent DP 107 makes it `missing`. The public
shapes of 0.13.0 are unchanged. `test/e15-activity.test.mjs` covers the
promoted registry with synthetic payloads of the observed shapes.

## Exact remaining limits

- Firmware 6.9.28 and app 6.1.00 only. Other firmware and installations are
  untested.
- Defogging shares the confirmed `mowing` payload. Field 2 = 9 needs one more
  app-correlated reproduction before any defogging reading could be proposed,
  and no `MowerActivity` value exists for it.
- Field 2 = 3 coincides with the displayed change to mowing three times but is
  transient. Field 2 = 1 during returning and field 2 = 6 have no correlated
  app state. Field 6 = 1 and the default payload follow every map save in the
  field and at the dock and are not decoded.
- The map-saving payload 2 = 5 with 3 = 1 is reproduced but has no typed value.
- No payload observed in this window identifies `docked`, `charging`, `idle`
  or `error`. The dock arrival is visible only through the map-saving phase and
  the declared DP 1 and DP 118 anchors, which are not activity definitions.
- Mowing progress has no source. DP 118 remains map-save progress.
- A session closes after 60 seconds without a report. Observing an idle mower
  needs the consumer to reopen sessions, which the library never does on its
  own.
- Simultaneous operation with the existing LAN consumer still causes short
  unavailability of that consumer at session open.
