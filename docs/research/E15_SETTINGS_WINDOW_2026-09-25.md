# E15 setting window, 2026-09-25

Hardware acceptance for [Opt-in mower settings](../MOWER_SETTINGS.md) and the
settings workstream of
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8):
one supervised change, read-back and restore of the mow height on the owned
E15 through Home Assistant, the mower bridge and this library.

## Setup

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

## Timeline (UTC)

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

## Result

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

## Not covered

- Volume, smart no-go zones and sparse lawn optimization were not written on
  hardware.
- The library's outcome fields, stage, end and the reflection's receipt time,
  were not captured separately. The integration's success stands for
  `confirmed`.
- Writes while mowing, during a map save or at the bounds of 25 and 75 mm.
- Any other firmware or installation.

The traces, script outputs and the call helper stay private on the owner's
host.
