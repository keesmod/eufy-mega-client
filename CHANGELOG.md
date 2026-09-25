# Changelog

## 0.20.0 - Unreleased

### Opt-in mower settings

- `session.querySettings()` and the pure `decodeMowerSettings(snapshot,
{ schema })` read seven E15 settings from one local status snapshot: mow
  height, volume, smart no-go zone suggestions, sparse lawn optimization,
  rain auto return, child lock and bird-view capture. Each is `reported`,
  `missing` or `invalid`, with its bound, step and unit for the value settings
  and `writable` from the library's table and the device's declaration.
- `session.setSetting({ name, value, readBackMs? })` writes one of four
  settings, `mowHeight` from 25 to 75 mm, `volume` from 0 to 100 %,
  `smartNoGoZones` and `sparseLawnOptimization`, behind a new explicit
  `mowers.settings` opt-in that is separate from `commands`. It follows the
  command lifecycle: one fresh status query, typed refusals before any write,
  one control frame, and a bounded read-back that ends `reflected` only when a
  fresh report carries the written value. The outcome returns the `previous`
  value. A restore is a second deliberate call. Nothing is retried, replayed,
  reconnected or restored by the library.
- Rain and child protection, DP 101 and DP 47, are read only in either
  direction, as the owner decided in keesmod/eufy-robomow-ha#8. The bird-view
  capture of the app's Real Lawn map is read only too. `setSetting()` refuses
  them with `mower_setting_read_only`.
- New refusals `mower_settings_disabled`, `mower_setting_invalid`,
  `mower_setting_read_only`, `mower_setting_undeclared`,
  `mower_setting_evidence_missing`, `mower_setting_map_saving` and
  `mower_setting_already_set`. New `client.mowers.settingsEnabled` and
  `session.settingsEnabled`.
- Sources: the device's own declaration, read in a read-only readout on the
  owned E15 on 2026-09-25, and the product script of the official app on the
  owner's Mac. See [Opt-in mower settings](docs/MOWER_SETTINGS.md) and the
  [settings schema receipt](docs/research/E15_SETTINGS_SCHEMA_2026-09-25.md).
- Upgrade: additive for callers. `MowerLocalSession` gains `settingsEnabled`,
  `querySettings()` and `setSetting()`, and `MowerModule` gains
  `settingsEnabled`, so a consumer that implements these interfaces itself,
  for example in a test double, adds them. Rollback: install 0.19.0 and drop
  the `settings` opt-in and the new calls.

The change is software-verified: CI and synthetic tests against the local
peer. The supervised change, read-back and restore of the mow height on the
owned E15 is pending in keesmod/eufy-robomow-ha#8.

## 0.19.0 - 2026-09-24

### Command progress while the read-back runs

- `session.sendCommand()` accepts an optional `onProgress` callback. It
  receives the acknowledgement once and every fresh DP 107 report that decodes
  to a confirmed activity while the read-back still runs, as frozen copies.
  After a `stop` on the owned E15 that is `returning` within a second, where
  the outcome arrives only with the map-saving payload at the dock arrival
  about 30 seconds later. The mower bridge in keesmod/eufy-robomow-ha uses it
  to show the drive home, a finding of the control window of 2026-09-24 in
  keesmod/eufy-robomow-ha#8.
- The callback adds no evidence and no stage. Its errors are ignored and it
  cannot change, end, retry or replay a command. A non-function value is
  refused with `mower_command_invalid`. Without it nothing changes.
- Upgrade: additive, no identifier, session or outcome change. Rollback:
  install 0.18.1 and drop the callback.

Use the compiled versioned 0.19.0 tarball and its verified integrity from the
GitHub release. Only the command read-back gains the optional callback. The
change is software-verified: CI and synthetic command tests with the report
order recorded on 2026-09-20. No new hardware test was needed because the
callback only forwards reports the confirmed definitions already decode. Retain
the previous package and lockfile for rollback.

## 0.18.1 - 2026-09-23

### Video Doorbell C30 reported with device type 96

- Discovery admits a C30 that Eufy reports as model `T8224` with device type
  `96`, as in the report on
  [ha-eufy-cam#40](https://github.com/keesmod/ha-eufy-cam/issues/40). It gets
  the same battery doorbell adapter, HomeBase 3 topology and snapshot, live and
  recording policy as `T8224` with type `95`. Earlier versions rejected it as
  `unsupported_device`. Only this exact pair is added. Every other model keeps
  its single type, and `T8224` with any other type stays unsupported.
- The pair is a reported inventory value, not independently reproduced, and no
  hardware was tested. Details are in
  [Battery doorbell evidence](docs/BATTERY_DOORBELLS.md#reported-c30-type-96-0181).
- Upgrade: no API, identifier or session change. Rollback: install 0.18.0,
  which rejects the pair again. References #183.

Use the compiled versioned 0.18.1 tarball and its verified integrity from the
GitHub release. Only discovery and media admission of the exact `T8224` type
`96` pair change. Protocol, commands, media code, camera identifiers and
persisted sessions are unchanged. The change is software-verified only: CI and
synthetic adapter, media, lifecycle, capability and discovery tests. The
reported C30 has not been tested on hardware. Retain the previous package and
lockfile for rollback. The camera bridge pins this release separately in
keesmod/ha-eufy-cam. References #183.

## 0.18.0 - 2026-09-23

### Typed E15 map geometry decoding

- Add `decodeMowerMapSnapshot`, `decodeMowerMapFile`, `decodeMowerPathFile` and
  `decodeMowerPoseFile` with the `MowerMap`, `MowerPath`, `MowerMapPose` and
  related types. They decode the three files that `PortableMapAcquisition`
  retains into read-only geometry: map identity, grid and bounds, station
  pose, region boundaries with sub-regions, obstacles, virtual and physical
  forbidden zones, virtual walls, cross-boundary tunnels, pass-through and
  required zones, trap and maintenance markers, the mowing history path with
  point kinds and end pose, and the six-byte pose record of
  `navPath.bin.stream`. The numbering comes from the original parser and is
  validated against the retained captures, recorded with its provenance in
  [Decoded mower map geometry](docs/MAP_GEOMETRY.md).
- Every file decodes independently and never throws. Malformed input reports
  the structural reason, byte offset and message path per file, unknown
  enumeration values keep their code, undecoded field numbers are listed,
  degenerate polygons, lines and ellipses are flagged and never repaired, and
  grid issues are reported. Integers stay integers because no source states
  the unit, and the pose values are display only. No mowing zone is invented,
  nothing is editable and E18 is not covered.
- Upgrade: additive API on the same `PortableMapAcquisition` contract, no
  change to acquisition, commands, telemetry, camera identifiers or persisted
  sessions. Rollback: install the previous package. References #51, next step
  #178.

### Accumulated cleaning-path history

- Add `MowerPathAccumulator` with the `MowerPathHistory`, `MowerPathSegment`,
  `MowerMapGeneration`, `MowerPathMergeInput`, `MowerPathMergeResult`,
  `MowerPathStartReason`, `MowerPathRejection` and
  `MowerPathAccumulatorOptions` types. `merge` takes the decoded geometry of
  each acquisition snapshot in receipt order and keeps one ordered history per
  map identity and generation: successive `history` paths of one map extend
  it by the points they add, every segment records the acquisition revision
  and `receivedAt` it came from, the end pose and the path kind follow the
  latest history or complete path, and every point keeps its kind and code.
  A changed map id, path id or map generation (grid, origin or save time) and
  a history that diverges from the confirmed points start a new history and
  return the previous one instead of mixing. A `realtime` path only extends
  the history provisionally and never replaces its points, kind or end pose,
  the empty realtime placeholder that opens each demand changes nothing, and
  malformed, duplicate, out-of-order and oversized inputs are rejected with a
  reason while the existing history stays untouched. Histories are frozen
  plain data and the merge invents no point, order or timing.
- Upgrade: additive API on the same `PortableMapAcquisition` contract and the
  #51 decoder, no change to acquisition, commands, telemetry, camera
  identifiers or persisted sessions. Rollback: install the previous package.
  Software evidence only, the merge rules and their confirmation levels are in
  [Decoded mower map geometry](docs/MAP_GEOMETRY.md). References #178.

### Hardware evidence for stop and return, documentation only

- The owner-operated window of 2026-09-20 recorded in the
  [stop and return receipt](docs/research/E15_STOP_RETURN_WINDOW_2026-09-20.md)
  confirms the 0.17.0 `stop` class on the owned E15 with firmware 6.9.28:
  DP 1 `switch_go` false was echoed 0.6 seconds after the write, the device
  reported `returning` 0.3 seconds after it and drove to the dock by itself,
  and the map-saving payload reported in `payload` arrived at dock arrival 30
  seconds after the write. A plain DP 1 false therefore ends the task and
  returns the mower, it does not leave it stopped on the lawn with or without
  its progress. `return` over DP 3 `switch_charge` sent from the stopped task
  that the app's Stop with Clear Progress had reached ended `timed_out`
  without a report or a physical effect, as it had from `paused`. The
  library has no DP 3 return route on this firmware, `stop` is the library
  route that brings the mower home, and the app's Charge over the raw control
  points remains the only way back from a task stopped on the lawn. Model
  matrix, [Opt-in mower commands](docs/MOWER_COMMANDS.md) and the API notes
  carry the evidence. No code, type or package change. References #173.

Use the compiled versioned 0.18.0 tarball and its verified integrity from the
GitHub release. Without the map API nothing changed. A consumer of
`PortableMapAcquisition` gains the read-only decoding of #51 and the history
accumulator of #178 as additive functions and types on the same snapshot
contract, and the stop and return evidence of #173 is documentation only. Both
map changes are software-verified only: CI, synthetic fixtures and the retained
captures of 2026-09-10 decoded and replayed locally without wire-type
conflicts. A fresh acquisition decoded end to end on the owned E15, the
coordinate and heading units, the meaning of `navPath.bin.stream` and the
merged history against the app's displayed path remain open hardware
obligations, so the pose values stay display only. Commands, telemetry, the
camera modules and persisted sessions are unchanged. Retain the previous
package and lockfile for rollback. The mower bridge pins this release
separately in keesmod/eufy-robomow-ha. References #51, #178 and #173.

## 0.17.0 - 2026-09-19

### Opt-in stop and the return precondition

- Add the opt-in command class `stop`. `session.sendCommand({ kind: 'stop' })`
  writes DP 1 `switch_go` false, the value the protocol owner assigns to
  stopping the job and the value reported after every app Stop on the owned
  E15. Its acknowledgement is DP 104 `stop_control` or the echo of the written
  point, and its reflection is the map-saving DP 107 payload, fields 2 = 5 and
  3 = 1 as the only records, reported in the new outcome field `payload`
  instead of `activity`. The same opt-in, exclusive ownership, typed refusals,
  bounded read-back and absence of retry, replay and reconnect apply.
- `return` is refused before any write with the new `mower_command_task_active`
  while DP 1 is not `false` on the fresh query, and with the existing
  `mower_command_map_saving` unless DP 118 reads exactly 100. The official app
  offers Charge only after Stop and the map save, and a return sent from
  `paused` was ignored on firmware 6.9.28, so the library now sends `return`
  only from the stopped task. The library cannot tell docked from stopped on
  the lawn, so a return sent while docked is not refused.
- Additive types: `MowerCommandKind` gains `stop` and `MowerCommandOutcome`
  gains the optional `payload`. Synthetic tests cover the stop lifecycle, stop
  without its reflection, the DP 107 shapes that never reflect it, the new
  refusal and stop followed by return on one session. The contract and the
  sources are in [Opt-in mower commands](docs/MOWER_COMMANDS.md).
- Hardware evidence: none yet for `stop` and for `return` from the stopped
  task. Both are software only until the owner-operated window of #173, which
  also records whether a plain DP 1 false keeps or clears the mowing progress.
  `start`, `pause` and `resume` keep their confirmed evidence from 0.16.0.
  References #173.

Use the compiled versioned 0.17.0 tarball and its verified integrity from the
GitHub release. Without `mowers.commands` nothing changed. A consumer that
opts in gains `stop` and must expect `mower_command_task_active` from a
`return` sent while the task is active, where 0.16.0 wrote DP 3 and timed out.
Until the window of #173 reports otherwise, `stop` and `return` from the
stopped task are unconfirmed on hardware and `return` still has no confirmed
route on firmware 6.9.28. Public types are additive, the telemetry definitions
and the camera modules are unchanged. Retain the previous package and lockfile
for rollback. The mower bridge pins this release separately in
keesmod/eufy-robomow-ha. References #173.

## 0.16.0 - 2026-09-19

### Opt-in E15 commands

- Add `mowers.commands: { enabled: true, stopRoute, readBackMs? }` as the only
  way to enable physical control, and `session.sendCommand({ kind })` for
  `start`, `pause`, `resume` and `return`. Each call runs one fresh status
  query, writes one declared boolean point, DP 1 `switch_go`, DP 2 `pause` or
  DP 3 `switch_charge`, and reads the lifecycle back from fresh reports within
  a bound: `stage` is `sent`, `acknowledged` or `reflected` and `end` is
  `reflected`, `rejected`, `timed_out` or `report_limit`. A sent command is
  never reported as completed and dock arrival is never inferred.
- Typed refusals before any write: `mower_commands_disabled`,
  `mower_command_invalid`, `mower_command_undeclared`,
  `mower_command_evidence_missing`, `mower_command_map_saving` and
  `mower_command_already_set`. One command owns the session at a time. There
  is no retry, replay or reconnect. Rain and child protection are never
  touched. Without the opt-in nothing changed.
- The control frame, its sources and the reasons for not writing the raw
  control points are in [Opt-in mower commands](docs/MOWER_COMMANDS.md) and
  the [control-point receipt](docs/research/E15_CONTROL_POINTS_2026-09-19.md).
- Hardware evidence: one owner-operated window on firmware 6.9.28 with app
  6.1.00, see
  [the command window receipt](docs/research/E15_COMMAND_WINDOW_2026-09-19.md).
  `start`, `pause`, `resume` and a second `pause` ended `reflected` within 1.2
  seconds of the write. `return` over DP 3 `switch_charge` ended `timed_out`
  without any report or effect, so firmware 6.9.28 does not honour it and a
  consumer must treat a `timed_out` return as no effect. The app's Stop, Clear
  Progress and Charge returned the mower while the library listened. The model
  matrix records start, pause and resume as confirmed and return as not
  honoured. References #169.

Use the compiled versioned 0.16.0 tarball and its verified integrity from the
GitHub release. Without `mowers.commands` nothing changed: the local session
still never writes and `sendCommand()` is refused with
`mower_commands_disabled` before any frame. A consumer that opts in must name
its stop route, send one command at a time and treat `timed_out` as an unknown
device state that is never retried. On the owned E15 with firmware 6.9.28
`start`, `pause` and `resume` are confirmed and `return` over DP 3 has no
effect, so a consumer must not offer return as a working control on this
firmware. Public types are additive, the telemetry definitions and the camera
modules are unchanged. Retain the previous package and lockfile for rollback.
The mower bridge pins this release separately in keesmod/eufy-robomow-ha.
References #169, #171 and #172.

## 0.15.0 - 2026-09-19

### Confirmed E15 activity

- `E15_TELEMETRY_DEFINITIONS` ships the three DP 107 `robot_status` payloads
  at `confirmed`: fields 1 = 2 and 3 = 1 `mowing`, 1 = 2 and 3 = 2 `paused`,
  1 = 1 and 3 = 1 `returning`. `queryTelemetry()` and `decodeMowerTelemetry`
  now report `status` for these payloads on the owned E15 instead of
  `{ state: 'unconfirmed', level: 'observed' }`. An absent DP 107 reports
  `missing`, and a transitional, map-saving, field 6 or default payload
  reports `invalid` for that report. The `mowing` payload also covers the
  app's Defogging phase. Types and other definitions are unchanged.
- Evidence: three further owner-operated start, pause and return cycles on
  firmware 6.9.28 with app 6.1.00, see
  [the reproduction receipt](docs/research/E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md).
  References #156.

Use the compiled versioned 0.15.0 tarball and its verified integrity from the
GitHub release. The only runtime change is the E15 registry: `status` now
reports `mowing`, `paused` or `returning` from DP 107 instead of
`{ state: 'unconfirmed', level: 'observed' }`, reports `missing` without DP
107 and `invalid` for the transitional, map-saving, field 6 and default
payloads. A consumer that branched on the unconfirmed state should handle the
reported, missing and invalid states. Public types, the other definitions and
the camera modules are unchanged. Retain the previous package and lockfile for
rollback. The mower bridge pins this release separately in
keesmod/eufy-robomow-ha. References #156 and #168.

## 0.14.0 - 2026-09-19

### Per-start live bound and a free primary session

- Add `liveUpperBoundMs` (120000 to 3600000, default 120000) and
  `startLive(cameraId, { signal?, maxDurationMs? })`. A stream may ask for a
  bound between one second and the ceiling, otherwise `invalid_live_bound`.
  Without a per-start value the bound stays 120 seconds whatever the ceiling.
  `startLive(cameraId, signal?)` keeps working.
- With `maxLiveStreamsPerStation` above 1, every live stream now uses its own
  P2P session, including the first one, so the primary session stays free.
  Mode commands, state refreshes and snapshots work while cameras stream.
  Recording transfers, reloads and recovery of a camera without a stream still
  fail with `station_busy` or `devices_busy` while any stream runs. With the
  default of 1 nothing changed.
- Bench evidence on one T8030 with one T8160, see
  [the research note](docs/research/LIVE_BOUND_2026-09-19.md).

Use the compiled versioned 0.14.0 tarball and its verified integrity from the
GitHub release. Both options keep their defaults, so consumers keep one live
stream per station on the primary session with a 120-second bound until they
opt in. A longer stream needs a raised `liveUpperBoundMs` and an explicit
`maxDurationMs` per start. Retain the previous package and lockfile for
rollback. The camera bridge pins this release separately in keesmod/ha-eufy-cam.
References #163, #165 and #166.

## 0.13.0 - 2026-09-18

### Concurrent live streams per station

- Add `maxLiveStreamsPerStation` (1 to 4, default 1). Above 1, every further
  concurrent live camera on a station opens its own P2P session, keyed by
  station and channel, with its own STOP confirmation, 120-second cap, abort
  cleanup and disposal. The primary session keeps control, snapshots,
  recordings and the first stream. The same camera twice, a start beyond the
  limit, and recording transfers or mode commands during live still fail with
  `station_busy`. Default behaviour is unchanged.
- Verified with two concurrent T8160 streams on one T8030, see
  [the research note](docs/research/CONCURRENT_LIVE_2026-09-18.md). Three or
  four streams are unverified on hardware.

### Read-only local mower session

- Add `EufyClient.mowers.openLocalSession(id, { host })` for one authenticated Tuya
  LAN protocol 3.5 session to one discovered E15. `queryStatus()` returns a copied
  snapshot with `source`, local `observedAt` and raw `dps`. No data point is
  interpreted or written. There is no command, setting, retry, reconnect or
  automatic polling.
- Borrow the private local key from the verified cloud binding only during key
  negotiation and erase it afterwards. Public results never contain the key,
  device ID or host. Every failure is a stable `EufyError` code without upstream
  detail, and failed or closed sessions release their socket and timers.
- Record every protocol fact with its permitted public source, pinned revisions
  and file digests in [Mower transport provenance](docs/MOWER_TRANSPORT_PROVENANCE.md).
  The frame codec and session-key derivation are reproduced byte for byte with
  tinytuya 1.20.0 and covered by synthetic peer tests. The subsequent
  [E15 6.9.28 observations](docs/research/E15_TELEMETRY_OBSERVATION_2026-09-16.md)
  confirm bounded local queries, schema retrieval and session cleanup.

### Typed mower telemetry

- Add `session.queryTelemetry()` and the pure `decodeMowerTelemetry()` that turn
  one snapshot into `status`, `battery`, `progress` and `network` fields with
  `source` and `observedAt`, plus every reported data point typed by the device's
  own declared schema and the raw `dps` copy. Nothing is inferred from age or
  absence.
- Retain the device's data-point schema from discovery and expose a copy as
  `session.schema`. Typed values come only from `confirmed` definitions that also
  conform to the declaration. The shipped E15 registry now includes independently
  observed battery percentage, Wifi and signal percentage. `signalPercent` is
  additive and keeps DP 109's declared `%` unit separate from `signalDbm`.
  Activity, mowing progress and unobserved network modes remain unconfirmed.
  Consumers may pass their own confirmed definitions. See
  [typed mower telemetry](docs/MOWER_TELEMETRY.md).

### Spontaneous mower reports

- Add `session.receiveReport()` for bounded, authenticated command-8 reports.
  It preserves full-frame arrival time, distinguishes reports from query replies,
  and returns each report's own data points without merging older values.
- Keep a pending report read alive with transport-only heartbeats. Preserve one
  operation per session, bounded buffering, cancellation, timeout and shutdown.
  No DP refresh, command write, retry or reconnect is added. See the
  [report API](docs/API.md#spontaneous-mower-reports-0130).

### E15 activity report contract

- Establish the DP 107 `robot_status` envelope from the protocol owner's base64
  raw report path and the public Protocol Buffers encoding rules, verified
  against every retained raw value of the owner-operated windows. Add the pure
  bounded `parseMowerWirePayload()` and expose its structural result as
  `fields[dp].wire` for data points named by a `wire` definition.
- Add the `wire` decode kind for evidence-gated candidate readings of a raw
  payload. Ship the mowing, paused and returning candidates for DP 107 at
  `observed`, so `status` now reports `unconfirmed` with that level and no
  activity value until three app-correlated reproductions exist. Battery,
  network and the report freshness rules are unchanged. See the
  [contract receipt](docs/research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md).

### Cloud identity renewal

- Discard the cached key-exchange identity and persist the cleared session when
  the Mega cloud answers with result code 4404 or 4416, also when that body
  arrives with a non-2xx status such as HTTP 463. That reset was unreachable
  before because every non-2xx response failed as `http_error` first, so a
  stored session whose identity had been invalidated elsewhere, for example by
  a key exchange on the same token from another host, failed every restore
  attempt. Observed with camera bridge client 0.12.3 on 2026-09-18 in #157.
- The rejected call now fails with `request_rejected`, `key_exchange_failed` or
  `authentication_rejected` carrying the remote code instead of `http_error`.
  Every other non-2xx response keeps `http_error`. No automatic retry is added.
  The next explicit call performs a fresh key exchange.

### Upgrade and compatibility

Existing camera and mower APIs, identifiers, persisted sessions and the map
acquisition adapter are unchanged. Consumers that matched `http_error` for a
rejected cloud identity now receive the remote result code instead. The
`MowerAdapter` contract is unchanged, so custom adapters keep working and report
`mower_protocol_unavailable` for local sessions. The local session interface gains `schema`, `queryTelemetry()` and `receiveReport()`.
`MowerTelemetryValue` gains the optional `wire` property and status definitions gain
the `wire` decode kind. Consumers that matched `status` against `{ state: 'unconfirmed' }`
exactly now also see `level: 'observed'`.
Use the compiled versioned 0.13.0 tarball and its verified integrity from the
GitHub release. `maxLiveStreamsPerStation` defaults to 1, so consumers keep one
live stream per station until they opt in. Retain the previous package and
lockfile for rollback. The camera bridge pins this release separately in
keesmod/ha-eufy-cam. References #145, #147, #149, #150, #153, #157, #159, #160
and #161.

## 0.12.3 - 2026-09-15

### Easier device maintenance

- Consolidate all 51 existing device profiles and per-feature media rules in
  one typed registry. Preserve exact model/type, owner and firmware admission,
  including the four established routes. Snapshot, live and recording
  capabilities retain their independent failures and current public shape.
- Generate and check the software-policy table from the same registry. Existing
  model/topology behavior is characterized before and after the refactor.
  This change adds no model, transport or hardware support claim.
- Give maintainers one place to review a known-family device addition and its
  snapshot, live and recording rules. Characterization tests detect changes to
  existing profiles. New protocols still require implementation and hardware
  validation before support can be claimed.

### Late audio discovery

- Keep audio codec discovery open after bounded video-only startup. The first
  late AAC packet is classified and normalized without a second stream-start
  event or camera command. Live handle metadata reflects the observed codec.
- Preserve the three-second startup limit for cameras that send no audio.
  Consumers must explicitly support adding a late audio track. This library
  correction alone does not add audio to an existing browser connection or
  establish T8134 acceptance for camera issue #10.

### Upgrade and compatibility

Use the compiled versioned 0.12.3 tarball and its verified integrity. The combined
[camera 0.8.19 release](https://github.com/keesmod/ha-eufy-cam/pull/81) consumes
this version. Other consumers must validate their own late-audio handling and
bridge behavior. Public API shapes, identities and admission boundaries remain
compatible. Retain the previous package and lockfile for rollback and preserve
the private credential/session store. No data migration is required.

References #139 and [camera #78](https://github.com/keesmod/ha-eufy-cam/issues/78).

## 0.12.2 - Unreleased

### Logging improvements for diagnostics

- Add bounded firmware, hardware and received parent context to rejected security
  inventory rows. Distinguish absent, self, missing, ambiguous and invalid parents.
  Private parent identifiers are only for consumer-side anonymous correlation.
- Preserve model admission, topology guards and mixed inventories. This supplies
  support evidence for camera issue #40 without claiming its cause or a C30 fix.

## 0.12.1 - Unreleased

- Add optional bounded `deviceModel` and `deviceType` diagnostics to
  `unsupported_device` discovery issues. Omit invalid values without coercion
  or truncation. Keep existing error codes, identities and model admission.
- Allow consumers to diagnose unknown model/type pairs without logging raw
  inventory. Consumers must still exclude the existing private `deviceId` field.
- This diagnostic patch follows [camera issue #40](https://github.com/keesmod/ha-eufy-cam/issues/40).
  It does not establish why the reported C30 is missing or add hardware support.

## 0.12.0 - Unreleased

- Combine the unpublished SoloCam discovery/media work with exact H3 profiles
  for Indoor, Floodlight, Wall-light, eufyCam C35, T86P2 in Wi-Fi mode and camera
  functions in three integrated products. Reuse existing attributed protocol
  classes and command paths. Preserve T8134 admission and existing identities.
- Add stored snapshots, live video/audio and recording software coverage only
  behind the actual admitted owner and existing firmware guards. Preserve
  acknowledged stop/cancel, bounded cleanup and independent owners. Missing
  battery or availability observations remain unknown.
- Recognize four wired doorbell and two garage camera model/type pairs with
  explicit standalone/owner blockers. Recognition does not activate their
  missing authentication, events or media. No lock, lid, garage-door, light or
  PTZ controls are added.
- Record reproducible standalone, older-owner, LTE and PoE/NVR protocol limits,
  including a bounded offline descriptor inspector that omits private values.
  Unimplemented connections and unresolved model variants remain open.
- Allow one explicitly tracked unpublished candidate version across related
  runtime PRs. Updated release notes are required. Existing tags, releases or
  drafts and failed remote checks reject that exception. All CI and immutable
  publication checks remain required.
- See the [0.12.0 candidate notes](docs/RELEASE_0_12_0.md) for exact models,
  source evidence, consumer limits and remaining obligations. Software tests
  do not add hardware support or resolve the T8134 audio report. No session
  migration is needed. Retain the previous package, lockfile and private store
  for rollback. This candidate has not been published or deployed.

## 0.11.0 - Unreleased

- Add exact SoloCam discovery, observed state and motion/person event routing for
  ten model/type pairs behind the existing T8030 HomeBase 3 owner. Select the
  private SoloCamera adapter while preserving eufyCam and doorbell adapters.
- Preserve T8134 identities and existing media admission. Additional SoloCam media
  stays explicitly unverified. Standalone descriptors identify their own owner
  without enabling an unverified connection or creating a HomeBase entity.
- See [SoloCam software evidence](docs/SOLOCAM.md). No new hardware support,
  session migration or physical control is claimed. Retain the preceding package
  and private store for rollback. This version is not published.

## 0.10.0 - 2026-09-11

- Add `getCameraCapabilities()` for snapshot, live and recording software admission.
  Results use the existing media and owner guards without connecting to devices.
  Available operations remain experimental. Hardware acceptance is unchanged.
- Preserve existing methods and private session stores. No migration is needed.
  Retain the preceding package and store for rollback.

## 0.9.0 - Unreleased

- Enable stored snapshots, live video/audio and recordings for exact T8214/94,
  T8224/95 and T8223/96 behind the existing T8030 H3 local LAN-derived profile.
  Require the documented numeric owner firmware branch. Preserve T8213 media.
- Validate separate E340 and C30/C31 live commands, acknowledged stop/cancel,
  bounded cleanup and failure isolation with synthetic family fixtures.
- See [battery doorbell media evidence](docs/BATTERY_DOORBELLS.md#h3-core-media-090).
  Hardware acceptance remains open. No session migration is required. Retain
  the preceding package and private store for rollback. No release is published.

## 0.8.0 - Unreleased

- Admit exact T8214/94, T8224/95 and T8223/96 battery doorbells behind the existing
  T8030 owner and select the private BatteryDoorbellCamera adapter.
- Preserve observed state, battery, firmware, owner/property-filtered detections,
  distinct ring events and replay suppression. Preserve existing camera identities.
- Keep new doorbell media explicitly unverified and retain the T8213 media route.
  Candidate type 7/16 variants and unsupported owners remain explicit.
- See [battery doorbell software evidence](docs/BATTERY_DOORBELLS.md). No hardware
  claim or session migration is added. Retain the preceding package and private
  session store for rollback. This version is unreleased.

## 0.7.0 - Unreleased

- Enable exact eufyCam model/type media profiles behind T8030 using existing
  H3 local LAN-derived command paths. Require the documented owner firmware
  branch for newly admitted models. Keep unknown profiles explicitly unsupported.
- Preserve stored snapshots, live video/audio, recording history and downloads,
  with per-model command and lifecycle fixtures. No new hardware support is claimed.
- Require the matching camera channel for local live-stop confirmation. Remove
  pending recording EOF listeners after cancellation and suppress duplicate listeners.
- Check unsupported camera-bound recording access before opening its connection.
- See [eufyCam media evidence](docs/EUFYCAM.md). Version 0.7.0 is unreleased.
  No session migration is required. Retain the preceding package and private
  session store for rollback.

## 0.6.0 - Unreleased

- Admit twelve exact eufyCam model/type pairs behind the existing HomeBase 3 owner.
  Keep unsupported owners and unresolved model variants explicit and isolated.
- Add optional `Device.availability` and `getDeviceState()`. Report observed battery
  and status values without SDK numeric coercion. Preserve existing identifiers.
- Filter detections by camera properties and actual owner, retaining event identity,
  duplicate suppression and existing doorbell ring semantics.
- Newly admitted models reject media with `camera_media_unverified` pending #20.
  Existing media routes remain unchanged. No new hardware support is claimed.
- See [eufyCam software evidence](docs/EUFYCAM.md). No session migration is needed.
  Retain the previous package and private store for rollback. This version is unreleased.

## 0.5.0 - Unreleased

- Add typed discovery relationships and per-device reasons through `discoverDevices()`.
  Keep existing `listDevices()` results and camera/HA identifier fields compatible.
- Isolate unknown models, unsupported owners and device initialization failures.
  Preserve duplicate identity, malformed relationship and inventory-cap errors.
- Represent standalone T8134 ownership without a false HomeBase or unverified
  transport. Wire/auth research remains in #36. No hardware support is added.
- See [discovery evidence and migration notes](docs/DISCOVERY.md). No session-store
  migration is required. Retain the previous package and private store for rollback.
  This version is unreleased.

## 0.4.0 - Unreleased

- Add the bounded read-only `PortableMapAcquisition` library adapter for the three
  independently evidenced E15 streams, using Node built-ins and explicit private
  RTC provisioning. No Android or remote helper runs in the acquisition path.
- Preserve complete transport files across partial, oversized, unordered or
  contradictory replacements. Demand expiry, abort, disconnect and shutdown
  close owned resources and report peer cancellation separately.
- Keep camera and mower credentials separate and preserve existing public APIs.
  Synthetic lifecycle coverage does not establish new hardware support.
- See [acquisition contract and evidence](docs/MAP_ACQUISITION.md). This version
  is unreleased. No persisted-session migration is required. Retain the previous
  package and original map source for rollback.

## 0.3.1 - Unreleased

- Accept the independently observed EU appliances Home endpoint without widening
  the host allowlist to arbitrary subdomains.
- Keep the Home login name and native Tuya account UID separate. Internal private
  connections now use the UID returned by the authenticated Tuya session.
- Verify E15 discovery, local-key equality and SID reuse with the compiled library
  on the account owner host. Public results remain free of connection secrets.
- Existing 0.3.0 prototype stores without the native UID fail closed. Reconnect
  with a fresh private mower store after retaining its backup. No production
  store migration, release publication or deployment is included.

## 0.3.0 - Unreleased

- Add an independent Home/Tuya mower authentication adapter and E15 discovery
  profile to the modular API. Public device results exclude connection secrets.
- Bound requests and session reuse, validate regional hosts and revoke private
  connection access on cancellation, shutdown and renewed discovery.
- Preserve EufyMegaClient compatibility and separate camera/mower stores.
  Default mower authentication now uses Home/Tuya when no custom adapter is set.
- Include Apache-2.0 protocol attribution and the inherited MIT app-profile notice.
- Live E15 account binding remains pending explicit approval of the prepared
  experiment. This version is unreleased and adds no hardware support claim.
- Keep each mower store private. A custom adapter retains its own session format.
  To roll back, retain the previous package and its private store backup.

## 0.2.1 - Unreleased

- Preserve duplicate-event suppression when a saved event cache is restored in
  the same millisecond it was exported. Keep the five-minute expiry bound.
- Add synthetic family, topology, command and media lifecycle regression fixtures.
  These establish software behavior only. They do not add model support.
- Consumers can update to this library version when it is published. No session
  migration is required. Retain the previous package for rollback.

## 0.2.0 - 2026-09-10

- Add `EufyClient` with optional, independent security and mower modules. Keep
  `EufyMegaClient` and all existing exports compatible.
- Give each module its own authentication state, cancellation and shutdown.
  Separate bridge consumers use separate instances and private session stores.
- Define the mower adapter and opaque session contracts. No mower protocol ships
  in this version. Without an adapter, login reports `mower_protocol_unavailable`.
- Validate module isolation and public TypeScript consumers with synthetic
  fixtures. This adds no hardware support claims or bridge deployment.

## 0.1.1 - 2026-09-10

- Include eufyCam S220 / 2C Pro T8142 and SoloCam S220 T8134 in Mega
  discovery when paired with T8030 HomeBase 3. Fixes the model exclusion
  described in ha-eufy-cam issue #10 when using the Mega backend.
- Retain the HomeBase 3 parent requirement and existing device-specific protocol
  commands. Standalone SoloCam operation is outside this change.
- Upgrade the consuming bridge to a release that pins library 0.1.1. Keep the
  previous bridge version and private session backup for rollback.
- S220 hardware validation is pending; automated tests do not establish live
  video, audio, recording or event compatibility.

## 0.1.0 — 2026-09-10

- Independent Mega authentication, session persistence and discovery for the
  initial T8030/T8160/T8213 installation.
- Explicit LAN connection credentials, with no legacy cloud API fallback.
- Library-owned typed device, event, snapshot, live, recording and Guard Mode APIs.
- Device acknowledgement and telemetry checks for stop, transfer completion and
  Guard Mode. Cancellation and shutdown retain cleanup ownership.
- FCM reconnection and persisted duplicate suppression.
- Allow delayed first AAC packets within a bounded three-second audio discovery
  window; start immediately once both media types are identified.
- MIT attribution, protocol tests and compiled GitHub package distribution.

Hardware and HA acceptance passed on the target installation, including the
agreed 11-hour-26-minute overnight observation. This does not establish full
24-hour reliability or improved battery life. See the compatibility results.
