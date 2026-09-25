# Mower work parameters

Read-only access to DP 155 of the E15, the message the official app calls its
main-page work parameters. Change class: additive extension of the mower
module, unreleased. The library reads and decodes the value. It does not write
it.

## Contract

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

## Writing is not implemented

The app's encoder sets only the fields that change, each in its wrapper, so
one message can carry a single field. `encodeMowerWorkParameter` in
`src/mowers/work-parameters.ts` encodes one such partial message for
`mowSpeed`, `bladeSpeed`, `edgeDistance` or `mowSpacing`, with a zero as an
empty wrapper and a negative value as a ten-byte varint, and refuses anything
else with `mower_setting_invalid`. It is not exported from the package entry
point and nothing calls it. Direction and mow height are not encoded.

There is no write path. Three things are not established: whether the device
merges a partial message or resets the fields it does not carry, which
transport a write would use, and how it would be read back.

## Provenance

| Fact                                                                                         | Permitted source                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message names, field numbers, types and enumerations, the empty 0x00 message, partial writes | The message serializers and the encoder in the product script of the installed Anker eufy app 6.1.00 on the owner's Mac, the script recorded with its SHA-256 in the [settings schema receipt](research/E15_SETTINGS_SCHEMA_2026-09-25.md). Read only, no code copied |
| Varints, sign extension, packed repeated fields, proto3 defaults, unknown fields             | The Protocol Buffers encoding and proto3 guides pinned in [typed mower telemetry](MOWER_TELEMETRY.md)                                                                                                                                                                 |
| `tuya.m.device.get` returns the device's data points next to its schema                      | The sources pinned in [typed mower telemetry](MOWER_TELEMETRY.md#device-schema)                                                                                                                                                                                       |

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

This read has not run against the owned E15. The observation of 2026-09-25
above was not made with this code.
