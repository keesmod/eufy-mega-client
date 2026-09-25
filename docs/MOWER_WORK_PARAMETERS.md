# Mower work parameters

Access to DP 155 of the E15, the message the official app calls its main-page
work parameters. Change class: additive extension of the mower module, 0.23.0.
The library reads and decodes the value from the cloud record. Behind the
settings opt-in of [Opt-in mower settings](MOWER_SETTINGS.md) it writes the
mow speed and the blade speed, one field in one partial message per write,
and reads the value back from fresh LAN reports. Edge distance, mow spacing,
the direction and the mow height in DP 155 are read only.

## Reading

`client.mowers.queryWorkParameters(id, signal?)` reads DP 155 of one
discovered E15 and resolves a `MowerWorkParametersReading`, always with
`source: 'cloud'` and `observedAt`:

- `{ state: 'reported', parameters, undecodedFields }` when the value decodes.
- `{ state: 'missing' }` when the cloud record carries no DP 155.
- `{ state: 'invalid' }` when the value is not text or does not decode.

`decodeMowerWorkParameters(value)` is the same decoder as a pure function. It
returns `{ shape: 'decoded', parameters, undecodedFields }` or
`{ shape: 'malformed', reason }` and never throws.

The read needs a connected module with current discovery bindings, like
`openLocalSession()`, and reports `authentication_required` or
`mower_binding_unavailable` otherwise. A custom adapter without the capability
reports `mower_protocol_unavailable`. Cloud and lifecycle errors are
`mower_request_failed`, `mower_invalid_response`, `request_timeout`,
`request_aborted` and `client_closed`. Each call makes one request. Nothing is
retried, cached or polled.

## Where the value is read

The owned E15 declares DP 155 `reserved_raw_155` as a readable and writable raw
point, and the app writes it with its action `ECL_MOW_SET_MAIN_PAGE_WORK_PARAM`
as an encoded protobuf message, see the
[settings schema receipt](research/E15_SETTINGS_SCHEMA_2026-09-25.md). DP 155
is absent from the E15's local status replies. It is present in the Tuya
cloud's device record, the `tuya.m.device.get` result that discovery already
reads, as base64 text under `dps` key `155`. On 2026-09-25 the owned E15's
cloud record carried it with all seven fields set.

The adapter repeats that request for the bound device and returns only the
value of key `155` with the receipt time. The device ID, the local key and
every other field and data point of the record stay inside the adapter. The
value is a cloud cache. No device time for it is established, so `observedAt`
is the library's receipt time of the cloud response and the value can be
older. It is never merged into a local snapshot, as the
[telemetry receipt](research/E15_TELEMETRY_OBSERVATION_2026-09-16.md) requires
for cached cloud values.

## Message numbering

`MainPageWorkParam`, the top-level message:

| Field | App name                      | Type                       | Library field       |
| ----- | ----------------------------- | -------------------------- | ------------------- |
| 1     | `mow_height`                  | `OptionalInt`              | `mowHeight`         |
| 2     | `mow_speed`                   | `MowSpeed`                 | `mowSpeed`          |
| 3     | `edge_cutting_distance`       | `OptionalInt`              | `edgeDistance`      |
| 4     | `main_direction_angle_config` | `MainDirectionAngleConfig` | `direction`         |
| 5     | `mow_spacing`                 | `OptionalInt`              | `mowSpacing`        |
| 6     | `blade_disk_speed`            | `BladeDiskSpeed`           | `bladeSpeed`        |
| 7     | `current_mow_spacing`         | int32                      | `currentMowSpacing` |

The nested messages, with the app's enumeration names in lower case:

| Message                    | Field | App name and type                                                         | Library value                  |
| -------------------------- | ----- | ------------------------------------------------------------------------- | ------------------------------ |
| `OptionalInt`              | 1     | `value`, int32                                                            | The wrapper's number           |
| `MowSpeed`                 | 1     | `speed_type`, 0 `low`, 1 `medium`, 2 `adaptive_high`, 3 `auto`            | `mowSpeed`                     |
| `BladeDiskSpeed`           | 1     | `speed_type`, 0 `low`, 1 `medium`, 2 `high`                               | `bladeSpeed`                   |
| `MainDirectionAngleConfig` | 1     | `mode`, 0 `single`, 1 `multiple`, 2 `auto_rotate`                         | `direction.mode`               |
| `MainDirectionAngleConfig` | 2     | `single_mode_config`, `SingleModeConfig` with 1 `angle`                   | `direction.singleAngle`        |
| `MainDirectionAngleConfig` | 3     | `multiple_mode_config`, `MultipleModeConfig` with repeated 1 `angles`     | `direction.multipleAngles`     |
| `MainDirectionAngleConfig` | 4     | `auto_rotate_mode_config`, `AutoRotateModeConfig` with 1 `angle_interval` | `direction.autoRotateInterval` |
| `MainDirectionAngleConfig` | 5     | `current_angle`, int32                                                    | `direction.currentAngle`       |

No source confirms a unit or range for these values, so they stay the
device's integers. Mow height has its own DP 110 setting, whose write the app
follows on this firmware, see the
[settings window receipt](research/E15_SETTINGS_WINDOW_2026-09-25.md).

## Decoding rules

- An empty value and the app's single byte 0x00, which it writes for an empty
  message, decode to empty parameters.
- A field exists only when its wrapper message is on the wire. An empty
  wrapper is a present zero, because proto3 does not encode a zero, so it
  reads as 0 or the first enumeration name. `direction.mode` is `single` when
  its field is absent. `currentAngle` and `currentMowSpacing` exist only when
  their field is on the wire.
- A negative int32 is a ten-byte sign-extended varint. A value outside int32
  is malformed.
- `multipleAngles` accepts packed and unpacked records in wire order.
- An enumeration value without a name keeps its number as `{ unknown }`.
- Unknown field numbers are skipped. `undecodedFields` lists each top-level
  field number that is unknown or whose message carried an unknown field.
- Repeated records follow the parser rules: the last scalar wins and repeated
  messages merge.
- A known field with another wire type is malformed with `field_type`.
- Bounds: 344 characters of text, 256 decoded bytes, ten-byte varints, three
  nested messages and 64 records, packed elements included. The faults are
  `not_text`, `not_base64`, `too_long`, `truncated`, `field_number`,
  `wire_type`, `field_type`, `varint`, `too_many_fields` and `too_deep`. The
  known schema is exactly three messages deep, so the decoder cannot reach
  `too_deep`. The reader enforces that bound on its own.

## Writing

`session.setWorkParameter({ name, value, readBackMs? }, signal?)` writes one
work parameter on an open local session. It needs the settings opt-in,
`mowers.settings`, and reports `mower_settings_disabled` without it. It
writes only these values:

| Parameter    | Field | Values written                   | Why only these                                                                                |
| ------------ | ----- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `mowSpeed`   | 2     | `low`, `medium`, `adaptive_high` | The three speed types that both of the app's mow speed enumerations name. `auto` is read only |
| `bladeSpeed` | 6     | `low`, `medium`, `high`          | The app's whole blade disk speed enumeration                                                  |

`edgeDistance`, `mowSpacing`, `direction`, `mowHeight` and `currentMowSpacing`
are refused with `mower_setting_read_only` whatever the value. No permitted
source gives a bound for the edge distance or the mow spacing. The app's
control handler checks only that they are numbers. The app's Mowing Parameters
panel, opened read only on 2026-09-25, showed its Customized Mode with a zone
map and no values, and its Default Mode tab was not opened because a tap on it
may change the mode. A direction write would replace a nested configuration.
The mow height has its own DP 110 setting.

One write runs these steps and stops at the first refusal, before anything is
sent:

1. The request is checked without I/O: `mower_setting_invalid` for another
   name, value or read-back bound, `mower_setting_read_only` for the
   parameters above.
2. The session schema must declare DP 155 `reserved_raw_155` as a readable and
   writable raw point, otherwise `mower_setting_undeclared`.
3. One cloud reading of DP 155 through the module, as
   `queryWorkParameters()` makes it, within the session timeout. The LAN
   status query does not carry DP 155, so this cloud cache is the only source
   of the value before the write. A failed or late reading, a reading that is
   not `reported`, a parameter that is absent, carries an unknown field or
   holds a value the library does not write is
   `mower_setting_evidence_missing`.
4. One fresh LAN status query. DP 118 must hold a map-save percentage, or the
   write is `mower_setting_evidence_missing`, and a running map save is
   `mower_setting_map_saving`.
5. A parameter already at the requested value in the cloud reading is
   `mower_setting_already_set`.
6. One control frame with DP 155 as the base64 text of a partial message that
   carries only the parameter's field, the way the app's encoder writes one
   change. `low` is an empty wrapper, because proto3 leaves a zero out.
7. Fresh reports are read back within the bound, default 10 seconds and at
   most 60, like a setting. The first report received after the write whose
   DP 155 carries the parameter at the written value is `reflection`, with
   every parameter it decoded to. The latest one with another value is
   `other`. A value that does not decode or lacks the parameter is no evidence
   either way.

The outcome carries `write` with the field and the `encoded` message, `cloud`
with the reading's receipt time and parameters, `before`, `previous`,
`sentAt`, `stage`, `end`, `reply`, `reflection`, `other` and `reports`, with
the stages and ends of a setting. A timeout resolves because the write already
happened. Nothing is retried, replayed or restored. A restore is a second
deliberate call with `previous`, decided on its own cloud reading. Typed
refusals leave the session open. One write owns the session like a command or
a setting.

The cloud value is a cache. When the app changed a parameter moments before,
the reading can still hold the older value, so `previous` and the
`already_set` refusal follow the cache, and the read-back decides on fresh
LAN reports only.

## Hardware evidence

- On 2026-09-25 a read-only comparison on the owner's installation found that
  the owned E15's `tuya.m.device.get` record carries the same 86 data points
  as the cloud's data point request, DP 155 included with the same value. The
  comparison used the Home Assistant integration's own cloud client and
  printed only key counts, types and lengths.
- The same day the second
  [settings window](research/E15_SETTINGS_WINDOW_2026-09-25.md) wrote a
  partial DP 155 message with only the blade disk speed over the LAN, outside
  this library. The E15 kept every field the message did not carry and
  reported the complete message within about 0.2 seconds, and the cloud
  matched. The restore behaved the same.
- The third [settings window](research/E15_SETTINGS_WINDOW_2026-09-25.md), also
  on 2026-09-25, ran this library's 0.23.0 inside mower bridge 0.11.0 through
  Home Assistant. `queryWorkParameters` read the owned E15's values, and
  `setWorkParameter` changed the mow speed from `medium` to `adaptive_high`
  and back and the blade speed from `medium` to `high` and back. Each write
  was `reflected` by a fresh LAN report that kept every other field, the whole
  Home Assistant call took 332 to 449 milliseconds, and later cloud readings
  matched each change.
- The `low` speeds and writes while mowing or during a map save have not run
  on hardware.

## Provenance

| Fact                                                                                                                    | Permitted source                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message names, field numbers, types and enumerations, the empty 0x00 message, partial writes                            | The message serializers and the encoder in the product script of the installed Anker eufy app 6.1.00 on the owner's Mac, the script recorded with its SHA-256 in the [settings schema receipt](research/E15_SETTINGS_SCHEMA_2026-09-25.md). Read only, no code copied |
| The E15 merges a partial message written over the LAN and reports the complete message                                  | Owner-supervised window of 2026-09-25, recorded in the [settings window receipt](research/E15_SETTINGS_WINDOW_2026-09-25.md)                                                                                                                                          |
| The written values: three mow speed types that both mow speed enumerations name, the whole blade disk speed enumeration | The product script above: `MowSpeedType` with four values, the extended settings' `MowSpeed.SpeedType` with the first three, and `BladeDiskSpeedType` with three                                                                                                      |
| Varints, sign extension, packed repeated fields, proto3 defaults, unknown fields                                        | The Protocol Buffers encoding and proto3 guides pinned in [typed mower telemetry](MOWER_TELEMETRY.md)                                                                                                                                                                 |
| `tuya.m.device.get` returns the device's data points next to its schema                                                 | The sources pinned in [typed mower telemetry](MOWER_TELEMETRY.md#device-schema)                                                                                                                                                                                       |

No code, schema, constant, fixture, test or table from the unlicensed mower
fork was used.

## Software evidence

`test/mower-work-parameters.test.mjs` builds every value from the tag and
varint rules with invented numbers. It covers a full message, the empty
message, single fields, empty wrappers, negative values and the int32 bounds,
packed, unpacked and mixed angles, unknown enumeration values and fields,
repeated records, every fault without a throw, the reader's nesting bound,
copy isolation, the encoder's output for each parameter against hand-built
bytes and its refusals, and the module read: reported, missing, invalid, an
unknown or foreign binding, a module that is not connected, a custom adapter
without the capability, sanitized cloud failures, cancellation and shutdown.

`test/mower-work-parameter-write.test.mjs` covers the write path on a
loopback device: the frozen table of written values, the opt-in, invalid and
read-only requests, the declaration, the one partial message in the control
frame for a speed and for a zero, the merged report read back with its
parameters, a restore as a second write on its own reading, every refusal of
the cloud reading and of the fresh query without a control frame, a failed and
a late cloud reading that leave the session open, another reported value as
`other` with a timeout and no second write, a rejected control reply and the
session held for the whole write.

The read and both writes have since run on the owned E15, see
[Hardware evidence](#hardware-evidence).
