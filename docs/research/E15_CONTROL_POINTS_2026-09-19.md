# E15 control points and the opt-in command path, 2026-09-19

Evidence for [#169](https://github.com/keesmod/eufy-mega-client/issues/169).
This receipt records what the retained owner-operated reports establish about
the raw control points, which declared boolean points changed on every app
press, and what the shipped command path therefore writes. No command was sent
to the mower for this receipt. The hardware acceptance of the command path is a
separate owner-operated window that has not taken place.

## Boundary

The retained reports of the [2026-09-16](E15_ACTIVITY_REPORTS_2026-09-16.md)
and [2026-09-19](E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md) windows stay on
the owning host and were analysed there. This receipt publishes data point
numbers, byte counts, field numbers, value ranges and counts only. No raw
capture, credential, identifier, key, address or lawn geometry accompanies it.
The unlicensed mower fork and the existing Home Assistant integration were not
consulted. The library only listened during both windows.

## Established from the retained reports

The two windows retained 18 reports of the writable raw control points: eight
of DP 103 `start_control`, four of DP 104 `stop_control`, five of DP 105
`pause_control` and one of DP 106 `resume_control`. Decoded with the public
Protocol Buffers encoding rules recorded in the
[DP 107 contract receipt](E15_ROBOT_STATUS_CONTRACT_2026-09-16.md), every one
of the 18 payloads is three bytes holding exactly one varint record in field 1.
The 18 values lay between 1380 and 9876 and no two were equal. That is the
established layout. The meaning of the value, whether the device validates it,
and whether the app writes these points or the firmware emits them as its own
control acknowledgements cannot be established from device reports. DP 103
preceded every start of mowing and every return with the same layout, so its
payload does not select between the two.

The declared boolean points moved with the presses. DP 1 `switch_go` became
true about 0.3 seconds after every Start, four of four. DP 2 `pause` became
true within 0.2 seconds of every Pause, five of five, became false after the
one Continue, and became false together with every Stop. The app's Charge
control changed neither DP 1 nor DP 3 `switch_charge`, and DP 3 never appeared
in any of the 352 retained reports. DP 143 `extend_cmd`, a writable raw point,
arrived shortly before three of the four Starts and never before a Charge. It
is recorded and not interpreted.

## What ships

The command path in [Opt-in mower commands](../MOWER_COMMANDS.md) writes the
declared booleans, whose semantics the protocol owner documents publicly and
whose changes were observed on this device for DP 1 and DP 2. The raw control
points are not written. They remain the acknowledgement anchor in the
read-back, because they reported within milliseconds of every press. `return`
writes DP 3, which is declared and documented but unobserved on this device.
The synthetic tests in `test/mower-commands.test.mjs` cover the lifecycle,
refusals, timeouts, rejection and session loss without a device.

## Pending hardware acceptance

One bounded owner-operated window with the owner at the mower, current
telemetry, the official app as the independent reference, the owner's explicit
confirmation of every prerequisite and opt-in per command class in chat,
physical confirmations, recovery evidence and verified cleanup. Until that
receipt exists the command path is software coverage only. Firmware 6.9.28
and app 6.1.00 remain the only observed versions.
