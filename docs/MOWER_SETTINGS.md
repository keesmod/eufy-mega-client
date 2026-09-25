# Opt-in mower settings

Implementation and software evidence for the settings workstream of
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8).
The write path sits on the local session of
[Mower transport provenance](MOWER_TRANSPORT_PROVENANCE.md) and uses the
control frame of [Opt-in mower commands](MOWER_COMMANDS.md). Change class:
additive extension of the mower module. Reads still never write. The session
can write exactly four declared setting points, only behind an explicit
per-client opt-in that is separate from the command opt-in, one write at a
time, without retry, replay or reconnect. Rain and child protection are read
only.

## Contract

`new EufyClient({ mowers: { ..., settings: { enabled: true, readBackMs? } } })`
is the only way to enable setting writes. `enabled` must be literally `true`.
An invalid opt-in fails client construction with `mower_invalid_options`.
Without the opt-in `session.setSetting()` is refused with
`mower_settings_disabled` before any frame is written, and
`client.mowers.settingsEnabled` and `session.settingsEnabled` report `false`.
The command opt-in neither implies nor requires it.

### Reading

`session.querySettings()` runs one status query and decodes it.
`decodeMowerSettings(snapshot, { schema })` is the same decoder as a pure
function, so a consumer that already queries status can read the settings
from that snapshot without another query. Every setting of the table below
comes back as one of:

- `{ state: 'reported', dp, type, value, writable }`, with `min`, `max`,
  `step` and `unit` for a value setting. The bound is the app's own input
  check narrowed by the device's declaration. `writable` is true when the
  library writes the setting and the session schema declares its point
  readable and writable with the expected code and type. The client opt-in is
  reported separately.
- `{ state: 'missing', dp }` when the snapshot does not carry the point.
- `{ state: 'invalid', dp }` when the value has another type or lies outside
  the bound or step.

Nothing is inferred from an absent or invalid point, and no cloud or older
value is substituted.

### Writing

`session.setSetting({ name, value, readBackMs? })` writes one setting and
resolves a `MowerSettingOutcome`:

1. One fresh status query. Its snapshot is returned as `before`, and the
   setting's value on it as `previous`. The typed refusals below are decided
   on it, and nothing is written when one applies.
2. One control frame that writes the setting's declared point, for example
   `{"110": 45}`. `sentAt` is the local time the frame was written to the
   socket.
3. A bounded read-back of fresh command-8 reports, default 10 seconds and at
   most 60. Every report received in that window is returned in `reports`.
   Reports whose receipt time precedes `sentAt` are kept as context and never
   count as evidence.

| Stage       | Evidence                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `sent`      | The frame was written. The device's frame reply, when one arrived, is in `reply`. A reply is not an acknowledgement |
| `reflected` | A fresh report carried the written point at the written value, reported in `reflection`                             |

| End            | Meaning                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `reflected`    | The device reported the written value within the bound                                                                          |
| `rejected`     | The device answered the control frame with a description, which the reference implementation sends only for an unusable command |
| `timed_out`    | The bound passed. The outcome is resolved, not thrown, because the write has already happened and must not be repeated          |
| `report_limit` | 64 reports arrived without the written value                                                                                    |

A fresh report that carries the point at another value is recorded in `other`,
the latest one wins, and the read-back continues until the written value or
the bound. It is evidence that the device holds another value, never a reason
to write again. There is no `completed`, and nothing is inferred from silence
or from the frame reply. The library never restores a value by itself. A
restore is a second deliberate `setSetting()` with `previous`, which runs its
own fresh query and refusals.

### Typed refusals before any write

| Code                             | Decided on                                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mower_settings_disabled`        | The client has no valid settings opt-in                                                                                                                                                                                     |
| `mower_setting_invalid`          | Unknown name, a value of the wrong type, a value outside the app's input bound or not an integer, or a `readBackMs` outside 1000 to 60000                                                                                   |
| `mower_setting_read_only`        | `rainAutoReturn`, `childLock` or `birdViewCapture`, whatever the value                                                                                                                                                      |
| `mower_setting_undeclared`       | The session schema does not declare the point readable and writable with the expected code and type, a value point is scaled, or the value lies outside the declared bound or step. A session without a schema cannot write |
| `mower_setting_evidence_missing` | The fresh query carries no valid current value for the setting, so there is nothing to restore, or no valid DP 118 `save_map_process` percentage                                                                            |
| `mower_setting_map_saving`       | DP 118 is strictly between 0 and 100. Conservative, as for commands: the app offers no control during a map save                                                                                                            |
| `mower_setting_already_set`      | The fresh query already shows the requested value, so the write cannot produce a fresh change                                                                                                                               |

The existing session errors apply unchanged: `mower_local_busy` while another
operation owns the session, including a command, `request_aborted` on
cancellation, `client_closed` on shutdown, `mower_local_disconnected` when the
peer closes during the read-back, and `request_timeout` as the hard deadline
of the session timeout plus the read-back bound. A closed session must be
opened again by the consumer. Nothing is resent on the new session.

## Rain and child protection

The owner decided on 2026-09-25 in
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8)
that DP 101 `rain_auto_return` and DP 47 `child_lock` stay read only. The
library has no write path for them in either direction. `setSetting()` refuses
both with `mower_setting_read_only` before any I/O, whatever the value, so no
consumer of this library can turn a protection off or on. Both are reported,
so a consumer can confirm that they are on before a supervised window. The
command lifecycle still never reads them for a decision and never bypasses
them.

DP 133 `enable_bird_view_capture` is read only as well. By its declared code
and the app's action it enables image capture for the app's Real Lawn map,
which belongs to the map work, and its effect has no evidence here.

## The settings and their sources

| Setting                  | DP  | Declared code, type and bound           | App action and input check                             | Written |
| ------------------------ | --- | --------------------------------------- | ------------------------------------------------------ | ------- |
| `mowHeight`              | 110 | `mow_height`, value 25 to 75, step 1 mm | `ECL_MOW_SET_MOW_HEIGHT`, number from 25 to 75         | Yes     |
| `volume`                 | 26  | `volume_set`, value 0 to 100, step 1 %  | `ECL_MOW_SET_VOLUME`, number from 0 to 100             | Yes     |
| `smartNoGoZones`         | 132 | `enable_smart_forbid_zone`, bool        | `ECL_MOW_SET_AI_FORBIDDEN_ZONE_ENABLE`, boolean        | Yes     |
| `sparseLawnOptimization` | 141 | `sparse_lawn_optimization`, bool        | `ECL_MOW_SET_SPARSE_LAWN_OPTIMIZATION_ENABLE`, boolean | Yes     |
| `rainAutoReturn`         | 101 | `rain_auto_return`, bool                | `ECL_MOW_SET_RAIN_RETURN`, boolean                     | Never   |
| `childLock`              | 47  | `child_lock`, bool                      | `ECL_MOW_SET_CHILDREN_LOCK`, boolean                   | Never   |
| `birdViewCapture`        | 133 | `enable_bird_view_capture`, bool        | `ECL_MOW_SET_BIRD_VIEW_COLLECTION_ENABLE`, boolean     | Never   |

| Fact                                                                                                                                                                           | Permitted source                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The owned E15 declares every point of the table readable and writable with the code, type, bound and unit above                                                                | Product schema retrieved through discovery in a read-only readout on 2026-09-25, recorded in the [settings schema receipt](research/E15_SETTINGS_SCHEMA_2026-09-25.md). Product metadata, not a secret. Field names follow [typed mower telemetry](MOWER_TELEMETRY.md) |
| The official app writes these points for these actions, reads them back as integers or booleans and checks mow height from 25 to 75 and volume from 0 to 100 before it writes  | The product script of the installed Anker eufy app 6.1.00 on the owner's Mac, the same script as the [map provenance](MAP_GEOMETRY.md#provenance), recorded in the [settings schema receipt](research/E15_SETTINGS_SCHEMA_2026-09-25.md). Read only, no code copied    |
| A write is the 3.5 LAN control command `0x0d` with the version header and `{"protocol":5,"t":<seconds>,"data":{"dps":{...}}}`, and the device's reply does not show acceptance | The sources and pinned revisions in [Opt-in mower commands](MOWER_COMMANDS.md#the-writes-and-their-sources)                                                                                                                                                            |

The unlicensed mower fork was read only to learn which settings its local
backend exposes. No code, schema, constant, fixture, test or table from it was
used. The names follow the device's declared codes.

### Why nothing else is written

- DP 155 is declared as a reserved raw point. The app writes it as one
  protobuf message that carries mow height, mow speed, edge distance, mow
  spacing, blade speed and the direction configuration together, so a write
  replaces all of them. It needs its own evidence and stays a later step.
- DP 139 `follow_edge_distance` is declared from -10000 to 10000 mm and the
  app checks no range before it writes it, so there is no usable bound.
- The other writable declarations, for example `edge_trim`, the work angle,
  cellular, language and unit, are outside this first slice. Reserved points
  are never written.

## Software evidence

`test/mower-settings.test.mjs` runs against the synthetic peer of
`test/fixtures/local-mower.mjs` with synthetic declarations in the documented
cloud shape. The tests cover the frozen settings table, the pure decoder with
narrowed bounds, steps, missing and invalid values and without a schema,
refusal without the opt-in while reading still works, invalid opt-ins at
construction and their independence from commands, the documented frame and
document for every writable setting, reflection only by the written value with
other values recorded in `other`, a change and its restore as two deliberate
writes on one session, timeout with the evidenced stage, rejection, the
read-only protections whatever the value, invalid requests, every typed
refusal without a written frame, the schema veto including a narrower declared
bound and step, exclusive ownership shared with commands, peer loss without
reconnect, cancellation, shutdown, the report limit, the hard deadline,
heartbeats during a long read-back and outcome isolation. All tests use
loopback sockets and synthetic values.

## Hardware acceptance

Not run yet. The planned acceptance is one supervised change, read-back and
restore of `mowHeight` from 40 to 45 and back to 40 mm on the owned E15
through the mower bridge, with the owner's explicit opt-in under the
conditions of
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8)
and the app as the independent reference. Until then every setting write is
software-verified only, and the receipt will be linked here.
