# E15 local telemetry observations, 2026-09-16

Evidence for [#149](https://github.com/keesmod/eufy-mega-client/issues/149), the
remaining hardware definitions from #147. Change class: patch to the existing
telemetry registry, with an additive network signal-percentage field. The
transport and authentication code are unchanged.

## Device and independent reference

- Owned E15, product code T2880, owner-reported firmware 6.9.28.
- Owner-reported iOS Anker eufy app 6.1.00. The owner reported Online,
  Fully Charged and 100%. The same iOS app installed on the owner's Mac was
  inspected read-only and independently displayed Fully Charged and 100%.
- Direct LAN Tuya 3.5 from an isolated Node 24.21.0 Linux container on the
  existing installation's host. Starting library commit
  `44715abe1c4ef09efa2aaa880c344e82c65e7054`, unpublished 0.13.0 candidate.
- The owner authorized the remaining #147 work, including the bounded
  read-only observations. No command, setting, heartbeat, DP refresh or device
  motion was requested. The app was used only to view existing information.

The library authenticated, discovered one E15 and verified its account-bound
device ID and local key against the existing installation in memory before
opening the local session. Credentials, cloud sessions, raw device records and
raw samples stayed on the owning host. This receipt contains selected product
metadata and scalar readings only. No mower-fork code, data-point table, schema,
fixture or test was consulted to define these mappings.

## Product declarations and confirmed definitions

Discovery returned 100 usable schema entries. The host-side JSON representation
of the schema has SHA-256
`c13b90028e7d4944edaf1b1af5df994a01a7c15c9670b8aabdea4d7e2a3ecccf`.

| Field          | DP  | Declared code          | Declared type, range and unit                     | Observed value | Confirmation                                                                     |
| -------------- | --- | ---------------------- | ------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| Battery        | 8   | `battery_percentage`   | read-only integer, 0 to 100, scale 0, step 1, `%` | 100            | confirmed, schema plus nine local observations and app comparison                |
| Network kind   | 134 | `net_media_type`       | read-only enum `None`, `Wifi`, `Cellular`         | `Wifi`         | confirmed for `Wifi` only, schema plus nine local observations                   |
| Network signal | 109 | `wifi_signal_strength` | read-only integer, 0 to 100, scale 0, step 1, `%` | 68             | confirmed as the device-declared percentage, schema plus nine local observations |

The signal result is `signalPercent: 68`. There is no observed dBm value or
conversion formula. Negating this value to produce -68 dBm would invent a unit
conversion. The existing `signalDbm` API remains available to separately
evidenced definitions. These observations do not establish an RF calibration.

`None` and `Cellular` exist in the declaration but were not locally observed.
They are not included in the confirmed enum map. A field declaration names a
possible value, not a completed hardware test of that value.

## Reproductions

Each row is a separate authenticated status-query response. Times are UTC on
2026-09-16. Every response contained 22 data points and retained its own local
receipt time. No cloud value or older response was merged into a snapshot.

| Window               | Local observation times                  | Battery       | Network kind     | Declared signal percentage |
| -------------------- | ---------------------------------------- | ------------- | ---------------- | -------------------------- |
| Original library     | 14:57:47.075, 14:57:48.582, 14:57:50.088 | 100, 100, 100 | Wifi, Wifi, Wifi | 68, 68, 68                 |
| Passive report check | 15:00:00.145, 15:00:15.161, 15:00:30.174 | 100, 100, 100 | Wifi, Wifi, Wifi | 68, 68, 68                 |
| Eufy app visible     | 15:07:21.799, 15:07:36.804, 15:07:51.817 | 100, 100, 100 | Wifi, Wifi, Wifi | 68, 68, 68                 |

The last two windows used a temporary copy of the compiled session with
host-only logging immediately after frame decryption. The hook recorded
decoded reports without changing outgoing bytes, correlation or timing. Across
both 30-second windows it recorded six command-16 query replies and no command-8
status reports, including while the owner-provided Eufy app opened its mower
overview. Authentication reused the first window's private cloud session.

## Why activity and mowing progress remain unconfirmed

The local replies never contained DP 5 `status`, DP 107 `robot_status` or DP 108
`battery_status`. The returned DP 118 is declared `save_map_process`, so it
cannot be used as mowing progress. A full battery does not prove docking,
charging or the current task state.

The cloud discovery record contains additional cached data points, including
DP 5 with `standby`, while the app displays Fully Charged. Neither a current
device observation time nor the meaning needed to map that cache to the public
activity contract was established. It must not be labeled as local telemetry.
No binary status/progress format was inferred from an unrelated cached value.

Tuya's Apache-2.0
[reference LAN implementation](https://github.com/tuya/TuyaOpen/blob/4e3147b3241ae15a171f284c3d812b20a26fe398/src/tuya_cloud_service/lan/tuya_lan.c#L859)
handles both query commands by dumping cached object data points. This supports
the distinction between a query reply and fresh raw reports. It does not prove
which additional read-only route this E15 firmware offers. No query variations,
refresh writes or guessed commands were sent.

The next implementation step is to establish an evidenced, fresh, read-only
source for activity and mowing progress, then correlate its values with the
app, tracked in [#150](https://github.com/keesmod/eufy-mega-client/issues/150).
Repeating idle scalar queries cannot establish missing state transitions
or a binary progress definition. The hardware evidence remains in the
[model matrix](../MODEL_MATRIX.md#e15-local-telemetry-2026-09-16).

## Implementation and validation

`E15_TELEMETRY_DEFINITIONS` now supplies DP 8, DP 134's observed `Wifi` value
and DP 109. `signal_percent` keeps percentages separate from `signal_dbm`.
`status` and `progress` remain `unconfirmed`. The public raw snapshot and its
receipt time are preserved. No polling, commands or automatic retries are added.

The synthetic fixture in `test/fixtures/e15-telemetry.mjs` recreates the three
observed product declarations with invented readings. Tests exercise the
default registry through both the pure decoder and the public local session,
missing/partial data, invalid percentages, unobserved enums, declaration veto,
caller overrides and mutation protection for the shared definitions. They also
ensure a full battery and map-save percentage cannot become activity or mowing
progress.

The compiled implementation was then exercised through the public
`session.queryTelemetry()` on the same E15, with the unmodified transport.
Three responses at 15:17:58.431, 15:17:59.938 and 15:18:01.445 UTC returned
`battery: { percent: 100 }` and
`network: { kind: 'wifi', signalPercent: 68 }`, both `reported`. Status and
progress stayed `unconfirmed`, and `signalDbm` was absent. These are three
additional observations after the nine raw queries above. Their timestamps are
local receipt times, not proof of when the device last refreshed each value.

The host copy matched the locally built files byte for byte. SHA-256 of
`dist/mowers/telemetry/definitions.js` was
`2d039d3eaaec34f96e66dae1ede633030709548777cce99660d6693becfcbb22`, and
`dist/mowers/telemetry/decode.js` was
`819a150c60a413871e8592096a26c7ef86204fdda37fdfd111d67e1f0c467747`.
Node 24 validation passed 1,129 tests. The 44 release-tool tests, formatting,
model-matrix and workflow checks passed. The dependency audit reported no
vulnerabilities.

## Cleanup and recovery

All observation sessions completed `disconnect()` and reported
`connected: false`. Each client shut down and each temporary container was
removed. The existing mower integration and Android map source/helper remained
running without configuration changes, overrides or reloads. The mower stayed
docked with a 100% battery in the owning Home Assistant runtime after the first
window, and the map entity remained available. A final runtime read after the
updated-decoder window again showed docked, 100% and an available map. The map
reported at 15:19:21 UTC. This is recovery evidence from the existing
integration, not evidence for a new activity definition.

The temporary test container was absent after the last session. The private
task's copied credential file and cloud-session file were removed. Original
installation credentials and private on-host observation records were retained.

The tested library is staged only in a private task directory. It does not
replace the existing mower integration, and this work does not publish 0.13.0.
