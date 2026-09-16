# E15 DP 107 `robot_status` field contract, 2026-09-16

Evidence for [#153](https://github.com/keesmod/eufy-mega-client/issues/153).
This receipt derives the binary envelope and field boundaries of the E15
`robot_status` report from permitted public sources and the owner's retained
reports, records what each observed field value coincided with, and states the
evidence level of every candidate meaning. It follows the
[report-acquisition receipt](E15_ACTIVITY_REPORTS_2026-09-16.md), which recorded
how the reports were obtained.

## Boundary

The retained reports stay on the owning Home Assistant host. They were analysed
there and in the private work directory. This receipt publishes field numbers,
values, counts and receipt times only. No raw capture, credential, device
identifier, key or lawn geometry accompanies it. The unlicensed mower fork was
not consulted for code, constants, schemas, fixtures, tests or its interpretation
of any data point. The device's declared codes for DP 1, 2, 103, 104 and 105 are
product metadata from the owned device's schema and are used only as timing
anchors.

Read-only. The client sent no command, DP write, refresh or setting during the
observation. E15 remains `observe_only`.

## Permitted sources

| Fact                                                                                                                                                                                                                                            | Permitted source                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A raw data point is reported over the LAN as base64 text keyed by the DP id inside the `dps` object                                                                                                                                             | [tuya/TuyaOpen, 4e3147b3241ae15a171f284c3d812b20a26fe398](https://github.com/tuya/TuyaOpen/blob/4e3147b3241ae15a171f284c3d812b20a26fe398/src/tuya_cloud_service/schema/tuya_iot_dp.c), `tuya_iot_dp_raw_report`, SHA-256 `0e88c41e3f49b912eb6bcdac876cffd6ee8037a19c77e075288760ffc5b662a8`. Apache-2.0, copyright Tuya Inc. Read only                                        |
| A wire record is a tag varint followed by a payload. The tag is the field number shifted left by three bits combined with the wire type. Wire types are 0 varint, 1 fixed 64-bit, 2 length-delimited, 3 and 4 deprecated groups, 5 fixed 32-bit | [Protocol Buffers Encoding guide](https://protobuf.dev/programming-guides/encoding/), public documentation. Site source [protocolbuffers/protocolbuffers.github.io, 4b88f52a8f830d4b4fbdad161dee33618ebc617f](https://github.com/protocolbuffers/protocolbuffers.github.io/tree/4b88f52a8f830d4b4fbdad161dee33618ebc617f), BSD-3-Clause, copyright Google Inc. No code copied |
| A varint is base 128 with a continuation bit per byte, least significant group first, at most ten bytes for a 64-bit value. Parsers accept fields in any order. A missing record means the field is absent                                      | Same encoding guide                                                                                                                                                                                                                                                                                                                                                           |
| Field numbers run from 1 to 536,870,911. A scalar field with implicit presence that holds its zero default is not serialized. The first enum value must be zero. Unknown fields are preserved by parsers                                        | [Language Guide, proto3](https://protobuf.dev/programming-guides/proto3/), same site and license                                                                                                                                                                                                                                                                              |
| The device declares DP 107 `robot_status` and DP 108 `battery_status` as read-only `raw` with no property type, range or internal layout, and DP 5 `status` as an enum that never arrived in any report                                         | Owned E15/T2880 schema retrieved through discovery, recorded in the [telemetry receipt](E15_TELEMETRY_OBSERVATION_2026-09-16.md)                                                                                                                                                                                                                                              |

The encoding guide is a serialization format. It establishes how to split a
payload into numbered records and how to read integers. It says nothing about
what any E15 field means, and no enum is inferred from it.

## Envelope and boundaries from independent observations

The 93 authenticated reports of the owner-operated windows contain 40 raw data
point values across DP 103, 104, 105, 107, 108, 113, 124, 143, 152 and 158.
Every value is valid base64. Decoded, 38 of the 40 parse completely as wire
records with no trailing bytes, using only wire types 0 and 2, with strictly
ascending field numbers within one payload. The remaining two are DP 107
payloads of exactly one zero byte. A zero byte is not a valid tag, because
field number 0 is outside the documented range, and an empty proto3 message
would serialize to zero bytes rather than one. It is therefore recorded as a
separate default payload, not as a record sequence.

| Boundary                                                          | Evidence                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport envelope is base64 text in a JSON string keyed by DP id | TuyaOpen raw report path, and all 40 retained raw values decode as base64                                                                                                                                                                          |
| DP 107 payloads are wire-record sequences                         | 18 of 20 payloads parse completely with wire type 0 only. Every record boundary is fixed by the tag and the varint continuation bits, so no length is assumed                                                                                      |
| Observed field numbers are 1, 2, 3 and 6, all varints             | Field 1 appears in 13 payloads, field 2 in 7, field 3 in 14, field 6 in 2. No other field number, wire type or nested message appears in DP 107                                                                                                    |
| Payload length varies from 1 to 6 bytes                           | Lengths 1, 2, 4 and 6 observed. Length follows from which fields are present and their values, not from a fixed layout                                                                                                                             |
| Omitted fields are the zero default                               | The proto3 rule for implicit presence. `08 02` next to `08 02 18 01` and `10 05 18 01` next to `08 02 10 09 18 01` show fields 3, 1 and 2 dropping out rather than being sent as zero                                                              |
| The single zero byte is a distinct default payload                | Observed twice, each about 15 seconds after a lone field 6 report and after DP 1 changed to `false`. It carries no record and is not interpreted                                                                                                   |
| The same envelope holds for the other raw points                  | DP 108 `battery_status` payloads of 2, 4 and 6 bytes parse as varints in fields 1, 2 and 3. DP 113, 124, 143, 152 and 158 parse with nested length-delimited fields. DP 158 reaches 376 bytes, beyond the DP 107 parser bound, and is out of scope |

Byte values quoted above are the established layout of the observed fields.
They are not a copy of a capture, and the synthetic fixtures reproduce only this
layout.

## Field values against independent anchors

Anchors are the owner's reported sequence from the previous receipt, the Mac
app display, and the device's own declared boolean or control points that
arrived in the same reports. The Mac app version was not separately read.

| Receipt time, UTC        | DP 107 fields                                           | Anchors in the same second                                                        | Owner and app observation                            |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 17:11:47.095             | 1 = 2                                                   | DP 103 `start_control` one millisecond earlier, DP 1 `switch_go` true at 47.415   | Start pressed. Defogging displayed, then Mowing      |
| 17:11:47.615 to 17:12:44 | 1 = 2, 3 = 1, eight payloads                            | Three of them also carry field 2 = 9, 3 or 6 for one report each                  | Mowing displayed, Mac app Mowing 0%                  |
| 17:13:40.485             | 1 = 2, 3 = 2                                            | DP 105 `pause_control` one millisecond earlier, DP 2 `pause` true at 40.682       | Pause pressed. Physical standstill, Mowing Paused 0% |
| 17:14:38.684 and 38.941  | 2 = 5, 3 = 1                                            | DP 2 false, DP 104 `stop_control`, DP 118 `save_map_process` rising from 1 to 100 | Session ended. Saving the map displayed              |
| 17:14:54.845             | 6 = 1                                                   | DP 1 false at 54.645, DP 118 reached 100 at 53.040                                | Not separately noted                                 |
| 17:15:10.085             | default payload                                         | None                                                                              | Not separately noted                                 |
| 17:15:15.786 to 17:15:23 | 1 = 1 alone, then with 3 = 1, then with 2 = 1 and 3 = 1 | DP 103 `start_control` two milliseconds before the first                          | Return pressed. Positioning, then Returning          |
| 17:16:42.565             | 2 = 5, 3 = 1                                            | DP 118 reset to 0, DP 1 true, then DP 118 rising to 100                           | Dock arrival while Saving the map displayed          |
| 17:16:58.695             | 6 = 1                                                   | DP 1 false at 58.495                                                              | Not separately noted                                 |
| 17:17:14.541             | default payload                                         | None                                                                              | Not separately noted                                 |

DP 108 `battery_status` arrived four times: twice as fields 2 = 1 and 3 = 1,
once as field 3 = 1 alone, and once as fields 1 = 1, 2 = 1 and 3 = 1 one second
before the second map-saving phase at the dock. No definition is proposed for it.

## Candidate meanings and evidence levels

The rule from [typed mower telemetry](../MOWER_TELEMETRY.md) applies. A
candidate needs three independent, app-correlated reproductions to become
`confirmed`. This test is one controlled start, pause and return cycle. Each
transition happened once, so no candidate reaches `confirmed` regardless of how
many reports repeated the same value within one phase.

| Candidate                       | Reading                           | Support                                                                                                                                         | Level        | Shipped as                                                          |
| ------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| Field 1 = 2 with field 3 = 1    | Mowing job running, `mowing`      | Eight payloads in one phase, Mac app Mowing 0%. The first seconds may include the displayed Defogging, which no separate field value identifies | `observed`   | Withheld `wire` definition in `E15_TELEMETRY_DEFINITIONS`           |
| Field 1 = 2 with field 3 = 2    | Mowing job paused, `paused`       | One payload, one millisecond after the pause control, owner-confirmed standstill, Mac app Mowing Paused                                         | `observed`   | Withheld `wire` definition                                          |
| Field 1 = 1 with field 3 = 1    | Return job running, `returning`   | Two payloads after the return control, app Positioning and Returning. The first return payload had field 3 absent                               | `observed`   | Withheld `wire` definition                                          |
| Field 2 = 5 with field 3 = 1    | Map saving phase                  | Three payloads in two phases, both with DP 118 rising and the app displaying map saving                                                         | `observed`   | Not shipped. No `MowerActivity` value exists for map saving         |
| Field 2 = 9, 3, 6 during mowing | Unknown substate                  | One payload each, no app change noted at those times                                                                                            | `hypothesis` | Not shipped                                                         |
| Field 2 = 1 during returning    | Unknown substate                  | One payload                                                                                                                                     | `hypothesis` | Not shipped                                                         |
| Field 6 = 1 alone               | Unknown, follows DP 1 turning off | Two payloads, no app state noted                                                                                                                | `hypothesis` | Not shipped                                                         |
| Default payload                 | Unknown idle or cleared state     | Two payloads, no app state noted. It cannot be read as `docked` or `idle`, which would infer state from an empty message                        | `hypothesis` | Not shipped                                                         |
| Any field as mowing progress    | None                              | The app displayed 0% throughout, and no field changed monotonically                                                                             | none         | Mowing progress stays unconfirmed. DP 118 remains map-save progress |

The shipped candidates are data, not behaviour. `decodeMowerTelemetry` withholds
them, so `status` reports `{ state: 'unconfirmed', level: 'observed' }` on the
owned device. When three reproductions exist, the level flips to `confirmed` in
the registry and the same decoder starts reporting. A consumer holding its own
evidence can pass the same definitions at `confirmed` today.

## Software

`parseMowerWirePayload(value)` is the pure structural parser. It accepts base64
text of at most 256 bytes and at most 32 records, decodes varints up to
2^53 - 1, copies length-delimited and fixed-width records as bytes without
recursing, reports the empty or single-zero-byte payload as `default`, and
names the first fault of malformed input. It never throws and shares no memory
with its input. The decoder attaches its result as `fields[dp].wire` for every
data point named by a `wire` definition of any level, because structure carries
no meaning. A `wire` definition matches a payload only when every listed field
is a varint with the listed value, absent meaning zero. Repeated field numbers,
non-varint records, the default payload and unknown combinations are withheld.

`test/e15-activity.test.mjs` covers the established shape, omitted fields, the
default payload, other wire types, malformed and truncated input, size and
record limits, unknown values, mixed evidence levels, the declaration veto,
frozen registry entries and copy isolation, with synthetic payloads built from
the documented tag and varint rules.

## Exact remaining limits

- No DP 107 candidate is `confirmed`. Each transition was observed once. The
  next hardware step is one bounded owner-operated window with two further
  start, pause and return cycles, recording app state at each report.
- Defogging has no identified field value. It may share field 1 = 2 with field 3
  = 1 during the first seconds after Start.
- Field 2 values 9, 3, 6 and 1, field 6 = 1 and the default payload have no
  correlated app state. They remain structural values.
- Mowing progress has no source. The app displayed 0% during this short run.
  DP 118 is map-save progress and is not relabelled.
- DP 108 `battery_status` shares the envelope and has no proposed definition.
- Firmware 6.9.28 and this app tuple only. The Mac app version was not read.
- Simultaneous operation of the existing LAN consumer and an observer is not
  established as reliable, as recorded in the previous receipt.
