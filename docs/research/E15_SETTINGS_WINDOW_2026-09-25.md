# E15 setting windows, 2026-09-25

Hardware acceptance for [Opt-in mower settings](../MOWER_SETTINGS.md) and the
settings workstream of
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8).
Three supervised windows ran on the owned E15 in the dock. The first changed
and restored the mow height through Home Assistant, the mower bridge and this
library. The second did the same for every writable setting and both bounds of
the mow height, and then tested one write of the DP 155 work parameters over
the LAN outside this library. The third changed and restored the mow speed and
the blade speed through Home Assistant, mower bridge 0.11.0 and this library's
0.23.0.

## First window, the mow height

### Setup

- Owned E15, product code T2880, in the dock with a full battery. Firmware was
  not re-read, it was 6.9.28 on 2026-09-20.
- Library 0.22.0 inside mower bridge app 0.10.1, and Home Assistant
  integration 0.14.2, on the owner's installation. The settings code of 0.22.0
  equals 0.20.0.
- The bridge ran with `settings_mode: write` and kept `operating_mode:
observe_only`, so its command routes stayed closed. The integration ran in
  its `control` mode on the bridge backend for the window only.
- The official Anker eufy app on the owner's Mac was the independent
  reference, read in the background through its accessibility texts.
- The owner stood at the mower and asked for the test at 10:13:32 UTC, after
  confirming dry weather and a clear lawn at 10:04:41 UTC for the window that
  preceded it. Rain and child protection were on before, during and after the
  window, and the mower never left the dock.
- A parallel session of the same issue ran the window at the owner's request
  with this workstream's scripts, and handed over its timeline and outputs.
  The results below were checked afterwards against the Home Assistant
  history and one fresh query through the bridge.

### Timeline (UTC)

- **10:18:19 to 10:18:25** The bridge app options gained
  `settings_mode: write` and the app restarted. Its state reported
  `routes.settings: true` and `routes.control: false`. The integration
  switched to the bridge backend. A fresh query through the bridge reported
  `mowHeight` 40 mm, writable, bound 25 to 75, step 1.
- **10:19:13.749** `number.set_value` 45 on the Cut Height entity. The call
  returned without an error at 10:19:13.848. The integration returns without
  an error only for a `confirmed` outcome, a fresh report of DP 110 at 45 that
  the library read back after its single write. The entity showed 45 at
  10:19:13.846 from the poll that the write requests. A fresh query at
  10:19:31.933 reported 45. The app showed Grass Height 45 mm.
- **10:19:48.930** `number.set_value` 40. The call returned without an error
  at 10:19:49.001. The entity showed 40 at 10:19:49.000. A fresh query at
  10:20:04.126 reported 40, with rain auto return and child lock both true.
  The app showed Grass Height 40 mm.
- **10:20:22 to 10:20:28** The integration returned to the local backend and
  the bridge app options were restored from their backup, `routes.settings:
false`. The setting entities read 40 mm, volume 0 and both protections on.
- **10:23:55** One more fresh query through the bridge reported 40.

### Result

- `setSetting` writes DP 110 on the owned E15 and reads the written value back
  from a fresh report. Each Home Assistant call, which covers the bridge
  request, the library's fresh query, the single write, the read-back and the
  integration's poll, took 99 and 71 milliseconds.
- The change and its restore were two deliberate writes, each decided on its
  own fresh query. Nothing was retried or replayed.
- The app's Grass Height follows a DP 110 write. This settles an open point of
  the [settings schema receipt](E15_SETTINGS_SCHEMA_2026-09-25.md): changing the
  mow height does not need the DP 155 work parameters on this firmware.
- Rain and child protection stayed on and were never written. The bridge's
  command routes stayed closed.
- The mower entity read `unknown` in bridge mode during the window, because
  the docked E15's query reply carries no DP 107. This did not affect the
  writes.

## Second window, every writable setting and the work parameters

### Setup

- The same mower, versions and reference as the first window. The mower stayed
  in the dock, and rain and child protection were on before, during and after
  the window.
- The owner opted in to both parts of the window in the settings thread while
  standing at the mower. This session ran the window.
- Part 1 used the same scripts as the first window: the bridge's
  `settings_mode: write` and the integration on the bridge backend in its
  `control` mode from 12:07:43 to 12:07:50 UTC, and back from 12:10:33 to
  12:10:39 UTC.
- Part 2 ran with the integration back on its local backend and the bridge's
  settings route closed.

### Part 1, every writable setting through Home Assistant

Each row is one Home Assistant service call on the setting's entity. Every
call returned without an error, which the integration allows only for a
`confirmed` outcome. After each call a fresh query through the bridge reported
the new value.

| UTC          | Setting                  | Change      | Call returned after | Also seen                        |
| ------------ | ------------------------ | ----------- | ------------------- | -------------------------------- |
| 12:08:05.314 | `volume`                 | 0 to 20 %   | 93 ms               | Home Assistant 20 at once        |
| 12:08:10.565 | `volume`                 | 20 to 0 %   | 80 ms               | Home Assistant 20 until 12:08:15 |
| 12:08:33.491 | `smartNoGoZones`         | on to off   | 80 ms               | Home Assistant off               |
| 12:08:50.123 | `smartNoGoZones`         | off to on   | 89 ms               | Home Assistant on                |
| 12:09:06.989 | `sparseLawnOptimization` | off to on   | 86 ms               | Home Assistant on                |
| 12:09:23.468 | `sparseLawnOptimization` | on to off   | 89 ms               | Home Assistant off               |
| 12:09:40.126 | `mowHeight`              | 40 to 25 mm | 103 ms              | App Grass Height 25 mm           |
| 12:10:04.094 | `mowHeight`              | 25 to 75 mm | 86 ms               | App Grass Height 75 mm           |
| 12:10:23.879 | `mowHeight`              | 75 to 40 mm | 85 ms               | App Grass Height 40 mm           |

The volume restore came five seconds after the change. Home Assistant
requests its refresh after a write through a debouncer with a ten-second
cooldown, so the entity showed the previous 20 % for 4.5 seconds although the
write was confirmed and a fresh query at 12:08:11.750 reported 0. This is a
display delay of the integration, not of the library or the bridge.

### Part 2, the DP 155 work parameters over the LAN

DP 155 is the app's `ECL_MOW_SET_MAIN_PAGE_WORK_PARAM`, one protobuf message.
The app's product script defines its fields as mow height (1), mow speed (2),
edge cutting distance (3), the main direction configuration (4), mow spacing
(5), blade disk speed (6) and the current mow spacing (7). Its encoder sets
only the fields it is given, so the app writes a partial message.

No fresh LAN query or report recorded in this library's earlier hardware
windows carried DP 155, while the cloud's last reported values before this
window held all seven fields. The mow height in it matched DP 110 at 40 mm.
The cloud's DP 139
`follow_edge_distance` read 0 while the edge cutting distance in DP 155 read
150, so DP 139 is not the app's edge distance.

- **12:10:48.249** One LAN control frame wrote DP 155 with only field 6, the
  blade disk speed, set from 1 to 2. A Tuya client on the owner's Home
  Assistant host sent it with the integration's own local credentials. This
  library was not involved.
- **12:10:48.455** A LAN report carried the complete DP 155 message with blade
  disk speed 2 and every other field unchanged.
- **12:11:13** The cloud's DP 155 matched the report.
- The app's Mowing Parameters panel was opened read only. Its Customized Mode
  was active. It was closed without a change.
- **12:11:38.929** The same frame shape set the blade disk speed back to 1.
- **12:11:39.114** A LAN report carried the complete message with blade disk
  speed 1 and every other field unchanged. The cloud matched afterwards.

At 12:12:08 the integration read the mower docked on its local backend with
cut height 40 mm, volume 0, both protections on, smart no-go zones on and
sparse lawn optimization off. The bridge app ran with its original options.

### Result

- `setSetting` confirmed every writable setting on the owned E15, including
  both bounds of the mow height, and each restore. Every Home Assistant call
  took 80 to 103 milliseconds.
- The app's Grass Height follows DP 110 at both bounds.
- The E15 accepts a partial DP 155 message over the LAN, keeps every field
  that the message does not carry and reports the complete message within
  about 0.2 seconds. A single-field write of the work parameters with a
  fresh-report read-back is therefore possible, but the value before the
  write can only come from the cloud, because the LAN status query does not
  carry DP 155.

## Third window, the work parameter speeds

### Setup

- The same mower and reference. Library 0.23.0 inside mower bridge app 0.11.0
  and Home Assistant integration 0.15.0, deployed an hour earlier.
- The owner opted in to the window in the settings thread while standing at
  the mower in dry weather. The mower stayed in the dock, rain and child
  protection were on before, during and after the window, and no mowing
  command was sent.
- The same scripts as the first two windows opened the bridge's settings route
  and switched the integration to the bridge backend in `control` from
  14:03:54 to 14:04:01 UTC, and back from 14:05:14 to 14:05:19 UTC.
- In bridge mode the integration showed the same five DP 155 values as on its
  local backend, from the bridge's cloud reading of 14:03:59.

### Timeline

Each row is one Home Assistant call on the entity's select. Every call returned
without an error, which the integration allows only for a `confirmed` outcome.
The bridge then served the work parameters from the reflecting LAN report, with
its receipt time.

| UTC          | Parameter    | Change                      | Call returned after | Reflecting report |
| ------------ | ------------ | --------------------------- | ------------------- | ----------------- |
| 14:04:16.052 | `mowSpeed`   | `medium` to `adaptive_high` | 333 ms              | 14:04:16.366      |
| 14:04:33.989 | `mowSpeed`   | `adaptive_high` to `medium` | 347 ms              | 14:04:34.319      |
| 14:04:41.567 | `bladeSpeed` | `medium` to `high`          | 332 ms              | 14:04:41.879      |
| 14:04:54.275 | `bladeSpeed` | `high` to `medium`          | 449 ms              | 14:04:54.705      |

- Home Assistant showed each new value 15 to 17 milliseconds before its call
  returned.
- Every reflecting report kept the other parameters, the edge distance and
  the mow spacing unchanged.
- Separate read-only cloud readings matched: mow speed 2 at 14:04:28, mow
  speed 1 and blade speed 2 at 14:04:48, and both 1 with every field equal to
  the start at 14:05:06. Each restore was therefore decided on a cloud reading
  that already carried the change.
- At 14:05:04.973 an edge distance change through Home Assistant was refused
  in 5 milliseconds as read only, before any request.

### Result

- `setWorkParameter` writes the mow speed and the blade speed of the owned E15
  as one partial DP 155 message each and reads the written value back from a
  fresh LAN report. Each Home Assistant call, which covers the library's cloud
  reading, fresh query, single write and read-back, took 332 to 449
  milliseconds.
- `queryWorkParameters` read the owned E15's values through the bridge, and the
  cloud reflected every change within 12 seconds.
- Recorded in
  [keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5833748272).

## Not covered

- Writes while mowing or during a map save.
- The library's outcome fields, stage, end and the reflection's receipt time,
  were not captured separately in the first two windows. The integration's
  success stands for `confirmed`. The third window captured the reflection's
  receipt time through the bridge.
- The `low` mow and blade speeds, and the app's display of the speeds, which
  the app shows only in a mode tab this workstream does not tap. Edge
  distance, mow spacing and the direction are read only.
- Any other firmware or installation.

The traces, script outputs and the call helpers stay private on the owner's
host.
