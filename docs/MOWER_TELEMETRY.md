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
(`enum` with an explicit value map, `boolean`, `percent`, `signal_dbm` or
`signal_percent`), the evidence `source` and a level:

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

| Field                   | Data point | Level                | Definition                                     |
| ----------------------- | ---------- | -------------------- | ---------------------------------------------- |
| `status`                | none       | none                 | Local replies did not contain activity data    |
| `battery`               | 8          | confirmed            | `battery_percentage`, integer 0 to 100, `%`    |
| `progress`              | none       | none                 | No current mowing-progress definition observed |
| `network.kind`          | 134        | confirmed for `Wifi` | `net_media_type`, maps `Wifi` to `wifi`        |
| `network.signalPercent` | 109        | confirmed            | `wifi_signal_strength`, integer 0 to 100, `%`  |

Every confirmed row cites the same receipt above. `None` and `Cellular` are
declared but not observed, so they remain unmapped. DP 109 is a percentage,
not a negative dBm reading. Status and progress remain `unconfirmed`. Passing
`definitions: []` explicitly opts out of the built-in registry. Built-in
definitions and their decode rules are frozen so consumers cannot alter the
defaults shared by other sessions.

A consumer that holds its own confirmed evidence can pass definitions to
`decodeMowerTelemetry`. The consumer then owns that provenance. Definitions
added to this registry must cite a receipt in `docs/research/` that records the
data point id, the declared code and type from the device schema, the observed
values, the app and firmware versions, the user action and three reproductions.

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
units. CI runs both suites on Linux with Node 24 without a device.

## Remaining acceptance

Not established: a fresh read-only source and confirmed definitions for E15
activity and mowing progress, other network modes, or other firmware. Two
30-second windows, one with the Eufy app visible, returned no spontaneous status
reports. Cloud cached values are not substituted for local observations. See
the receipt and the [model matrix](MODEL_MATRIX.md#e15-local-telemetry-2026-09-16).
The missing report-acquisition path is tracked in
[#150](https://github.com/keesmod/eufy-mega-client/issues/150).
Physical control, settings and map decoding remain separate work.
