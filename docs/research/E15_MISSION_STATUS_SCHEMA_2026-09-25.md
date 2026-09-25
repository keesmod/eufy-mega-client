# E15 mission status schema, 2026-09-25

Evidence for the DP 107 mission status definition shipped in 0.22.0, from the
local-backend workstream of
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8).
It records the official app's own decoder of DP 107 and the owned E15's
observed values against it. The owner asked for this decoding and approved the
release in chat on 2026-09-25. Nothing was written to the mower for it.

## Source

The official app's product script for the T2880 is `T2880.js`, the script that
Anker eufy 6.1.00 downloads for the product. It has SHA-256
`0be33785e7c70d2c2e890d0f3b9d4ee512dca527b447ca95651ba683d5ef048d`. It is the
same script as the [map provenance](../MAP_GEOMETRY.md#provenance) and the
[settings schema receipt](E15_SETTINGS_SCHEMA_2026-09-25.md), read on the
owner's Mac. Its data-point dispatch hands DP 107 to its mission status
decoder and binds the result to the app's `mission_status` properties. The
decoder's field numbers and enumerations give these facts. They were read
only, and no code was copied:

| Field | Meaning     | Values used by the library                                                                                                                                                                                                                                     |
| ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Mission     | 0 none, 1 recharge. Mowing missions: 2 whole lawn, 4 mapping while mowing, 5 temporary, 7 remote-controlled, 8 scheduled whole lawn, 9 scheduled mapping while mowing, 10 selected zone, 16 scheduled zone, 17 drawn box, 18 edge trim, 22 scheduled edge trim |
| 2     | Sub-mission | 0 none. Others name phases such as relocation, leaving the station, saving the map, setting the blade height and defogging                                                                                                                                     |
| 3     | State       | 0 idle, 1 running, 2 paused, 3 aborted, 4 complete                                                                                                                                                                                                             |
| 4     | Power mode  | 0 running, 1 standby, 2 hibernate                                                                                                                                                                                                                              |
| 5     | Error flag  | Boolean                                                                                                                                                                                                                                                        |
| 6     | Saving data | Boolean                                                                                                                                                                                                                                                        |

The script declares further boolean fields 7 to 12 and a back-to-station reason
in field 7. The library does not read them.

## Observed on the owned E15

- The device is the owned E15, product code T2880, firmware 6.9.28 as last
  read on 2026-09-20, with the Anker eufy app 6.1.00.
- **Earlier receipts.** The [contract receipt](E15_ROBOT_STATUS_CONTRACT_2026-09-16.md),
  the [reproduction receipt](E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md) and
  the [stop and return receipt](E15_STOP_RETURN_WINDOW_2026-09-20.md) cover
  these values, each app-correlated:
  - missions 1 and 2 with states 1 and 2;
  - sub-missions 1 (Positioning…), 3, 5 (Saving the map), 6 and 9 (Defogging…);
  - field 6 right after each map save;
  - the default payload with the idle controls.
- **Window of 2026-09-25.** It sampled the cloud copy of DP 107 every two
  seconds through the integration's cloud client, with the app read on the
  Mac:
  - A Box task started in the app reported mission 17 with state 1, at times
    with sub-mission 3, on every sample for about ten minutes. The app showed
    Mowing….
  - The task ended by itself with mission 1 and state 1, and the app showed
    Returning….
  - After each arrival the map save showed sub-mission 5 with state 1, then
    field 6, then the default payload.
- **Hibernation.** Field 4 = 2 as the only record was read from the cloud
  while the mower stood docked on 2026-09-06, 2026-09-24 and 2026-09-25, from
  five to fifteen minutes after a rest ended until the next rest. At 07:30 UTC
  on 2026-09-25 the app showed its idle controls meanwhile.

Every value observed on the owned E15 fits the app's decoder.

## Classification

The shipped `mission_status` definition is `confirmed`. The basis is the app's
own decoder of this data point together with reproductions on the owned E15:

- The message structure, the state values running and paused, and the
  sub-mission and flag fields are reproduced across four owner-operated
  windows.
- The whole-lawn and recharge missions are reproduced at least four times
  each. The drawn-box mission was reported continuously for one task.
- The other mowing missions listed above differ from the whole lawn only in
  the area or trigger the app's decoder names. They share the state field, so
  a running or paused one reads as `mowing` or `paused` on the same basis.
  This extends the reproduction rule of
  [typed mower telemetry](../MOWER_TELEMETRY.md#definitions-and-confirmation-levels)
  with the vendor's own decoder as evidence for enumeration values of an
  already reproduced field. The owner approved it for this release.
- A message without mission, sub-mission, state or error flag reads as
  `idle`, whatever its power mode or saving-data flag. That covers the default
  payload and hibernation. `idle` is not `docked`: the same message follows the
  app's Stop on the lawn.

Still withheld as `invalid`:

- the map save, sub-mission 5 without a mission;
- the first frame of a start, a mission without a state;
- a paused return;
- missions that do not mow, such as mapping without mowing or driving to a
  target point;
- aborted and completed states;
- the error flag.

## Not done

No command, setting or map request was sent for this receipt, and no capture,
identifier, address or lawn geometry is recorded. The script stays on the
owner's Mac.
