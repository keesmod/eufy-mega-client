# Typed mower telemetry

Implementation and software evidence for [#147](https://github.com/keesmod/eufy-mega-client/issues/147).
The typed layer sits on the read-only local session from
[#145](MOWER_TRANSPORT_PROVENANCE.md). Change class: additive extension of the mower
module. It reads nothing new from the device, writes nothing and infers nothing
from age or absence.

## Contract

`session.queryTelemetry()` runs one status query and returns `MowerTelemetry`.
`decodeMowerTelemetry(snapshot, { schema?, definitions? })` is the same pure
decoder for a snapshot the consumer already holds. Both keep the raw `dps` copy.

`session.receiveReport()` adds a separate acquisition path for spontaneous
command-8 reports. It keeps the full-frame arrival time and labels the result
`kind: 'device-report'`. Pass this report to `decodeMowerTelemetry` with the
session schema to decode only those reported points. A newly received query
response is not substituted for a report. See the
[report API](API.md#spontaneous-mower-reports-0130) and
[hardware receipt](research/E15_ACTIVITY_REPORTS_2026-09-16.md).

- `source` and `observedAt` come from the snapshot. Nothing is timestamped by
  the device and nothing is aged locally. Staleness is the consumer's decision.
- `fields` types every reported data point by the device's own declaration:
  `id`, `value`, `declared`, and when declared `code`, `type`, `valid`, `unit`
  and `scaled`. Validity means the value conforms to the declared property type,
  range, enum list or length. An undeclared data point has `declared: false`
  and no validity claim.
- `status`, `battery`, `progress` and `network` are typed fields driven by
  definitions. A field is `reported` with `value`, `dp`, `source` and
  `observedAt` only when a `confirmed` definition exists and the value decodes.
  It is `missing` when every confirmed data point is absent, `invalid` when a
  present value does not conform to the declaration or the definition, and
  `unconfirmed` when no confirmed definition exists, carrying the best lower
  level if one is known.
- `network` merges a connection kind and a signal level from separate data
  points. Any invalid part invalidates the whole field.

Typed values are library-owned: `MowerActivity` is `mowing`, `paused`,
`returning`, `charging`, `docked`, `idle`, `error` or `unknown`. Battery and
progress are integer percentages from 0 to 100. Network kind is `wifi`,
`cellular`, `ethernet` or `none`. A signal is either `signalDbm`, an integer
from -120 to 0, or `signalPercent`, an integer from 0 to 100, as independently
defined. No conversion between these units is inferred. A definition may only
map onto these values. Anything else is `invalid`.

## Definitions and confirmation levels

A `MowerTelemetryDefinition` names the field, the data point id, the decode rule
(`enum` with an explicit value map, `boolean`, `percent`, `signal_dbm`,
`signal_percent` or `wire` for one candidate reading of a raw payload), the
evidence `source` and a level:

| Level        | Meaning                                                                                    | Typed value |
| ------------ | ------------------------------------------------------------------------------------------ | ----------- |
| `hypothesis` | A plausible reading without sufficient evidence                                            | Withheld    |
| `observed`   | Seen once or twice on the owned mower, not yet safe as a contract                          | Withheld    |
| `confirmed`  | Reproduced at least three times on the owned mower with recorded firmware and app versions | Exposed     |

Only `confirmed` definitions produce values. This follows the evidence policy of
the existing mower project without copying its constants or schemas.

### E15 registry

`E15_TELEMETRY_DEFINITIONS` is the registry shipped with the library and is the
default for `queryTelemetry()`. The
[2026-09-16 owner observations](research/E15_TELEMETRY_OBSERVATION_2026-09-16.md)
confirm battery, Wifi and a device-declared signal percentage on E15/T2880
firmware 6.9.28. Definitions come from that device's schema and repeated
read-only responses, independently of the unlicensed mower fork.

| Field                   | Data point | Level                | Definition                                                                                                             |
| ----------------------- | ---------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `status`                | 107        | observed, withheld   | `robot_status` wire candidates: fields 1 = 2 and 3 = 1 `mowing`, 1 = 2 and 3 = 2 `paused`, 1 = 1 and 3 = 1 `returning` |
| `battery`               | 8          | confirmed            | `battery_percentage`, integer 0 to 100, `%`                                                                            |
| `progress`              | none       | none                 | No current mowing-progress definition observed                                                                         |
| `network.kind`          | 134        | confirmed for `Wifi` | `net_media_type`, maps `Wifi` to `wifi`                                                                                |
| `network.signalPercent` | 109        | confirmed            | `wifi_signal_strength`, integer 0 to 100, `%`                                                                          |

Every confirmed row cites the same receipt above. `None` and `Cellular` are
declared but not observed, so they remain unmapped. DP 109 is a percentage,
not a negative dBm reading. The three `status` candidates cite the
[DP 107 contract receipt](research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md).
They come from one owner-operated cycle, stay `observed` and are withheld, so
`status` reports `{ state: 'unconfirmed', level: 'observed' }` on the owned
device. Progress remains `unconfirmed` without a candidate. Passing
`definitions: []` explicitly opts out of the built-in registry. Built-in
definitions and their decode rules are frozen so consumers cannot alter the
defaults shared by other sessions.

A consumer that holds its own confirmed evidence can pass definitions to
`decodeMowerTelemetry`. The consumer then owns that provenance. Definitions
added to this registry must cite a receipt in `docs/research/` that records the
data point id, the declared code and type from the device schema, the observed
values, the app and firmware versions, the user action and three reproductions.

## Raw wire payloads

The E15 declares DP 107 `robot_status` and DP 108 `battery_status` as `raw`
without an internal layout. The
[DP 107 contract receipt](research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md)
establishes the envelope from the protocol owner's base64 raw report path and
the public Protocol Buffers encoding rules, and verifies it against every
retained raw value: a payload is a sequence of wire records, each a tag varint
holding the field number and wire type followed by a varint or a
length-delimited body. Fields with a zero default are omitted. The observed DP
107 fields are 1, 2, 3 and 6, all varints, in payloads of one to six bytes. The
single-zero-byte payload is a distinct default without records.

`parseMowerWirePayload(value)` is the pure structural parser for this envelope.
It returns `{ shape: 'fields', byteLength, fields }` with `number`, `wire` and
`value` per record, `{ shape: 'default' }` for the empty or single-zero-byte
payload, or `{ shape: 'malformed', reason }` naming the first fault:
`not_text`, `not_base64`, `too_long`, `truncated`, `field_number`, `wire_type`,
`varint` or `too_many_fields`. It accepts at most 256 decoded bytes and 32
records, decodes varints up to 2^53 - 1, copies `bytes`, `fixed32` and
`fixed64` records without recursing into them, never throws and shares no
memory with its input. DP 158 exceeds the byte bound and is out of scope.

The decoder attaches the parse as `fields[dp].wire` for each data point named
by a `wire` definition of any level, provided the value is text and the device
declares the point `raw` or not at all. Structure is not meaning: field numbers
and integers are the payload itself in another form, so exposing them does not
bypass the evidence levels. With `definitions: []` nothing is attached.

A `wire` definition is `{ kind: 'wire', match, activity }`. It reports
`activity` only when every field number in `match` is a varint with exactly the
listed value, an absent field counting as zero, and only at `confirmed`. A
payload that is malformed, wrong-typed or declared as a non-raw type makes the
field `invalid`. The default payload, a payload with repeated or non-varint
records, and any combination no confirmed candidate claims are withheld as
`invalid` rather than guessed. Several candidates may share one data point with
their own levels. An empty `match` or an activity outside `MowerActivity` is an
invalid definition. No enum is inferred from the wire format itself.

| Fact                                                                                                                                                           | Permitted source                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tag varint, wire types 0, 1, 2, 5 and the deprecated groups 3 and 4, base-128 varints of at most ten bytes, any field order, absent records for missing fields | [Protocol Buffers Encoding guide](https://protobuf.dev/programming-guides/encoding/), public documentation. Site source [protocolbuffers/protocolbuffers.github.io, 4b88f52a8f830d4b4fbdad161dee33618ebc617f](https://github.com/protocolbuffers/protocolbuffers.github.io/tree/4b88f52a8f830d4b4fbdad161dee33618ebc617f), BSD-3-Clause, copyright Google Inc. Read to establish format facts. No code copied |
| Field numbers 1 to 536,870,911, zero defaults of implicit-presence scalars are not serialized, the first enum value is zero, unknown fields are preserved      | [Language Guide, proto3](https://protobuf.dev/programming-guides/proto3/), same site and license                                                                                                                                                                                                                                                                                                              |
| Raw data points travel as base64 text keyed by DP id                                                                                                           | TuyaOpen `tuya_iot_dp_raw_report`, pinned in [transport provenance](MOWER_TRANSPORT_PROVENANCE.md)                                                                                                                                                                                                                                                                                                            |

## Device schema

Discovery already reads the private device record through `tuya.m.device.get`.
That record carries the product's data-point schema as JSON text. The adapter
now parses it into `MowerDpSchemaEntry` values and lends a copy to each local
session, which exposes it as `session.schema`. The schema is product metadata
with identifiers, modes, property types and ranges. It contains no credentials,
identifiers of the household or lawn geometry.

| Fact                                                                                                                                                                                                                          | Permitted source                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tuya.m.device.get` returns `schema` as JSON text next to `devId`, `dps`, `name`, `isOnline`, `productId` and `localKey`                                                                                                      | [FlagX/ha-ledvance-tuya-resync-localkey, 535d0e2732414d39a18a0254297ce59874b2cc0a](https://github.com/FlagX/ha-ledvance-tuya-resync-localkey/tree/535d0e2732414d39a18a0254297ce59874b2cc0a), `pyscript_modules/tuya/api.py`, SHA-256 `1a72284e710189cfae9f75c7b71e56884eca1d249b763ba843f072bbf92e815a`. MIT, copyright 2022 FlagX. Read only |
| The same call returns the device data points and local key for a Tuya-registered Eufy device                                                                                                                                  | [albertoxamin/eufyhome, 6cf038a5e4eaaefa397472a332eb0bcf4ddbc661](https://github.com/albertoxamin/eufyhome/tree/6cf038a5e4eaaefa397472a332eb0bcf4ddbc661), `docs/assembly_csharp_analysis.md`. MIT, copyright 2024 Alberto Xamin. Read only                                                                                                   |
| Schema entry shape: `id` as number or numeric text, `mode` `rw`, `ro` or `wr`, `type` `obj` or `raw`, `property.type` `bool`, `value` with `min`, `max` and `scale`, `enum` with `range`, `string` and `bitmap` with `maxlen` | Tuya's own device-side parser in [tuya/TuyaOpen, 4e3147b3241ae15a171f284c3d812b20a26fe398](https://github.com/tuya/TuyaOpen/tree/4e3147b3241ae15a171f284c3d812b20a26fe398), `src/tuya_cloud_service/schema/dp_schema.c`, SHA-256 `3ace2345da73c4d5da73c68f4ad93b8c88fb5d3bfcdc157f004935221390e318`. Apache-2.0, copyright Tuya Inc.          |
| A product function has an identifier of letters, digits and underscores starting with a letter, a numeric DP ID, a transfer direction and a data type. Value types carry `unit`, `min`, `max`, `scale` and `step`             | [Tuya Developer Platform, Product Functions](https://developer.tuya.com/en/docs/iot/define-product-features?id=K97vug7wgxpoq), public documentation                                                                                                                                                                                           |
| The public standard instruction set lists no lawn mower category                                                                                                                                                              | [Tuya Developer Platform, Standard Instruction Set](https://developer.tuya.com/en/docs/iot/standarddescription?id=K9i5ql6waswzq), public documentation                                                                                                                                                                                        |

The parser accepts at most 512 entries and 64 KiB of text, skips invalid or
duplicate entries and never fails discovery over this optional field. Codes
that do not match the documented identifier form are dropped while the entry is
kept. The owned E15 returned 100 usable entries, including the codes and units
in the observation receipt. That is evidence for the recorded firmware only.

## Software evidence

`test/mower-telemetry.test.mjs` covers the parser with documented and invalid
entries, typing of every property type including scale and undeclared points,
raw pass-through and copy isolation, confirmed definitions for all four fields,
withheld lower levels, the boolean and partial network rules, missing,
wrong-typed, out-of-range and unknown values, the device-declaration veto over a
definition, and the session path with and without a schema. The synthetic
schema, codes and values in that generic decoder suite are invented.
`test/e15-telemetry.test.mjs` adds independently sourced E15 declarations with
synthetic values, default-session decoding and strict separation between signal
units. `test/e15-activity.test.mjs` covers the wire parser and the DP 107
candidates: the established shape, omitted fields, the default payload, other
wire types, malformed and truncated input, size and record limits, unknown
values, mixed evidence levels, the declaration veto, frozen registry entries
and copy isolation. Its payloads are built from the documented tag and varint
rules, not from captures. CI runs all three suites on Linux with Node 24
without a device.

## Remaining acceptance

The owner-operated transition test for
[#150](https://github.com/keesmod/eufy-mega-client/issues/150) acquired fresh
command-8 reports containing DP 107 `robot_status` and DP 108 `battery_status`.
The earlier idle-window silence does not describe this active test. See its
[receipt](research/E15_ACTIVITY_REPORTS_2026-09-16.md) and the
[model matrix](MODEL_MATRIX.md#e15-local-telemetry-2026-09-16).

The DP 107 envelope and field boundaries are established in the
[contract receipt](research/E15_ROBOT_STATUS_CONTRACT_2026-09-16.md) for
[#153](https://github.com/keesmod/eufy-mega-client/issues/153). Activity
meanings remain `observed` at best: one mowing, pause and return cycle does not
independently reproduce each candidate three times, Defogging has no identified
field value, and field 2 substates, field 6 and the default payload have no
correlated app state. The mowing-progress source remains unidentified. The app
displayed 0% mowing progress, so the windows did not establish a changing
value. DP 118 changed during the app's separate map-saving phase and remains
map-save progress. Cloud cached values are not substituted for local
observations. Other network modes and firmware remain untested. The remaining
hardware step is one bounded owner-operated window with further cycles.
Physical control, settings and map decoding remain separate work.
