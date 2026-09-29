# E15 charger contact, 2026-09-29

Evidence for the DP 108 charger contact definition shipped in 0.27.0, from
[#209](https://github.com/keesmod/eufy-mega-client/issues/209) and the
resting-state research in
[keesmod/eufy-robomow-ha#82](https://github.com/keesmod/eufy-robomow-ha/issues/82).
Before it, no reading separated a rest at the charging station from a stop on
the lawn: the idle mission status, the map-saving payload, DP 1 false and DP 118
at 100 follow both. This receipt records the official app's own decoder of DP
108 and one owner-requested window on the owned E15 against it. Nothing was
written to the mower by the library or the probe.

## Source

The official app's product script for the T2880 is `T2880.js`, SHA-256
`0be33785e7c70d2c2e890d0f3b9d4ee512dca527b447ca95651ba683d5ef048d`, the same
script as the [mission status receipt](E15_MISSION_STATUS_SCHEMA_2026-09-25.md).
It was read on the owner's Mac. Its data-point dispatch hands DP 108 to its
battery status decoder and binds the result to the app's
`battery_status` properties. The decoder gives these fields. They were read
only, and no code was copied:

| Field | Meaning                   | Values                                 |
| ----- | ------------------------- | -------------------------------------- |
| 1     | State                     | 0 discharging, 1 charging, 2 charged   |
| 2     | Charger connected         | Boolean                                |
| 3     | Switch on                 | Boolean                                |
| 4     | Temperature               | 0 normal, 1 overheated, 2 under-heated |
| 5     | Night charging protection | Boolean                                |

The device's own schema declares DP 108 `battery_status` read-only `raw`
without an internal layout, as the
[contract receipt](E15_ROBOT_STATUS_CONTRACT_2026-09-16.md) recorded. Read
through discovery on 2026-09-29, it also gives a maximum length of 128. It
declares DP 5 `status` a read-only enumeration of 17 values, among
them `standby`, `charging`, `charge_done` and `sleep`.

The same desk check covered the other candidates named in #209:

- DP 107 fields 7 to 12 are the back-to-station reason, an enumeration, and five
  booleans: navigation located, upgrading, data conversion in progress, and two
  flags for an abnormal state during remote control. None of them names the
  station.
- The app's data-point dispatch has no branch for DP 5, so the app does not
  read it, although the device declares it.

## Window

- **Device and versions.** The owned E15, product code T2880, firmware 6.9.28
  as read from its cloud record on 2026-09-29, with the Anker eufy app 6.1.00
  on the owner's Mac. Times are UTC, in daylight.
- **Probe.** A private, read-only sampler read the cloud's data point request,
  `tuya.m.device.dp.get`, every two seconds from 06:56:05 to 08:54:12, 3,543
  samples, through the Home Assistant integration's existing cloud client, and
  logged DP 1, 2, 5, 8, 107, 108 and 118. The log stays on the owner's host. No LAN report listener ran,
  so that no second local session competed with the owner's running mower
  bridge.
- **Actions.** The owner asked the agent to operate the official app on the
  owner's Mac. The agent pressed every control there: a default Box with Start,
  Stop after about a minute of mowing, and Charge after at least twenty minutes
  on the lawn, three times. The app's display was read after each step: the
  status text, whether Charge was offered, the charging mark on the battery and
  the mower's position on the map. Nobody watched the mower in person, so the
  app is the only correlation.

## Observed values

DP 108 field 2 is written as "connected" when it is 1 and "not connected" when
it is absent. Field 3 was 1 in every sample. The table cuts times to the whole
second. The transition figures below use the sample times.

| Phase                  | Interval (UTC)       | Samples | DP 108                                                      | App                                                     |
| ---------------------- | -------------------- | ------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Rest 1 at the station  | 06:56:05 to 07:25:00 | 868     | connected, charged (field 1 = 2), in hibernation throughout | Fully Charged, Charge not offered, mower at the station |
| Start 1 in the station | 07:25:00 to 07:25:41 | 20      | connected                                                   | Defogging…                                              |
| Stop 1 on the lawn     | 07:27:05 to 07:47:48 | 622     | not connected, discharging                                  | Mower on the lawn, Charge offered                       |
| Rest 2 at the station  | 07:48:45 to 07:55:29 | 202     | connected, charging (field 1 = 1)                           | Charging mark, Charge not offered, mower at the station |
| Start 2 in the station | 07:55:29 to 07:56:13 | 22      | connected                                                   | Mowing…                                                 |
| Stop 2 on the lawn     | 07:57:21 to 08:17:39 | 609     | not connected, discharging                                  | Mower on the lawn, Charge offered                       |
| Rest 3 at the station  | 08:18:54 to 08:25:25 | 196     | connected, charging                                         | Charging mark, Charge not offered, mower at the station |
| Start 3 in the station | 08:25:25 to 08:26:08 | 21      | connected                                                   | Mowing…                                                 |
| Stop 3 on the lawn     | 08:27:16 to 08:47:41 | 612     | not connected, discharging                                  | Mower on the lawn, Charge offered                       |
| Rest 4 at the station  | 08:48:32 to 08:54:12 | 170     | connected, charging                                         | Charging mark, Charge not offered, mower at the station |

Transitions, each resolved to one two-second sample:

- **Departures.** Field 2 cleared in the same sample in which DP 107 first
  reported the sub-mission leaving the station, 41, 44 and 42 seconds after
  Start. Until then the mower defogged in the station with field 2 connected
  while DP 107 already reported the Box mission running. Field 1 cleared in
  the same sample.
- **Arrivals.** Field 2 was set 57, 74 and 51 seconds after Charge, in a sample
  in which DP 107 still reported the recharge mission. Field 1 followed two to
  four seconds later with charging, and the map save began within six seconds
  of the arrival.

The mowing between departure and Stop and the drive home between Charge and
arrival read not connected in every sample. No request failed.

The phase boundaries are not all independent of DP 108. Each stop on the lawn
runs from the app's Stop to its Charge, and each departure coincided with DP
107's sub-mission leaving the station, so those boundaries come from other
sources. Each rest starts at the arrival sample, the first with field 2 set, so
that boundary comes from field 2 itself. The map save that followed within six
seconds and the app's mower at the station confirm those arrivals. With these
boundaries, all 1,499 samples at the station read connected and all 2,044
samples away from it read not connected, 1,843 of them during the three stops
on the lawn.

## The library's request

The library reads the device record, `tuya.m.device.get`, not the data point
request the probe sampled. On 2026-09-25 a read-only comparison found that the
two carry the same 86 data points on the owned E15, DP 155 with the same
value, see
[Mower work parameters](../MOWER_WORK_PARAMETERS.md#hardware-evidence). At
11:52 UTC on 2026-09-29 one further read-only comparison through the same
cloud client, with the mower resting at the station, found the same DP 108
value in both, connected and charged. The not-connected value was not compared
through the device record, and the library itself did not read the contact on
hardware for this receipt.

## Candidates that do not separate

- **Hibernation.** DP 107 field 4 = 2 appeared on the lawn 10 minutes 18
  seconds, 10 minutes 21 seconds and 10 minutes 20 seconds after each Stop. At
  the station it held in all 868 samples of rest 1, with field 2 connected. It
  is not station-only, contrary to the earlier note in #209.
- **DP 107 fields 7 to 12.** None of them, and not field 5, appeared in any
  sample, also not during the three returns after Charge. Only fields 1, 2, 3,
  4 and 6 did.
- **DP 5** read `standby` in every sample, at the station, while mowing and on
  the lawn.
- **DP 107 default payload and DP 1.** The idle payload followed every map
  save at the station and on the lawn. DP 1 changed with tasks and also during
  rests at the station.

## Classification

The cloud reading's charger definition is `confirmed`. The basis is the app's own
decoder of DP 108 together with the window above: field 2 was connected in
every sample of four rests and three starts at the station and not connected in
every sample of three stops of at least twenty minutes on the lawn, with three
departures and three arrivals. This follows the rule of
[typed mower telemetry](../MOWER_TELEMETRY.md#definitions-and-confirmation-levels)
as extended by the mission status receipt: the vendor's own decoder names the
field, and the owned E15 reproduced both values at least three times each.
It agrees with the earlier receipts, in which fields 1, 2 and 3 arrived one to
five seconds before each of seven owner-confirmed dock arrivals and no DP 108
arrived during six app Stops on the lawn
([contract](E15_ROBOT_STATUS_CONTRACT_2026-09-16.md),
[reproduction](E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md)).

The library exposes only field 2, as `charger.connected` of the cloud reading,
through an internal definition that is not part of the local registry.
Field 1 follows it but is not needed to separate the two cases. The empty or
single-zero-byte payload reads as not connected, the encoding's default. A
field 2 that is not a single varint of 0 or 1 is `invalid`.

## Not established

- Nobody confirmed the mower's position in person. The app's map and controls
  are the correlation.
- DP 108 LAN reports were not received in this window, and the E15's local
  status replies do not carry DP 108. The definition is used for the cloud
  reading only.
- The cloud keeps the last reported value. A mower that loses its connection
  as it leaves or reaches the station, a mower lifted off the station by hand,
  a station without power and a return for rain or low battery were not tested.
- Other models are not covered. No E18 support claim is added.

## Not done

No command, setting or map request was sent by the library or the probe for
this receipt. Every physical action was a control of the official app. No
capture, identifier, address or lawn geometry is recorded. The app script, the
sample log and the app screenshots stay private.
