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

## Software evidence and remaining acceptance

The report tests use invented device identities and data. They cover command
correlation, partial reports, original arrival time across deferred consumption,
foreign device IDs, invalid JSON and authentication tags, missing reports,
exclusive ownership, cancellation, shutdown, bounded buffering and transport
heartbeat lifecycle. A separate regression covers frequent reports that would
otherwise keep postponing the heartbeat.

Activity and mowing progress remain `unconfirmed`. A controlled transition
window, three reproduced reports for each proposed value and independent app
correlation remain required. DP 118 remains map-save progress and must not be
relabeled as mowing progress. The declared raw DP 107 and DP 108 have no new
binary definition in this implementation.

The candidate is staged in a private test directory only. It does not replace
the existing mower integration and does not publish version 0.13.0.
