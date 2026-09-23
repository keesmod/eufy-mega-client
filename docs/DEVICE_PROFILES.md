# Device profiles and feature policy

[device-profiles.ts](../src/device-profiles.ts) owns the exact recognized
model/type pairs, family, discovery topology and separate snapshot, live and
recording admission. Discovery and media evaluation consume this source. The
public API and private protocol adapters remain unchanged.

## Reading the policy

Recognition only means the exact model/type pair has a descriptor. Discovery
validates the actual inventory relationship. `h3` requires an admitted HomeBase
owner, `h3-or-standalone` also retains an empty/self-parent descriptor, and
`standalone` rejects an H3 command relationship. A standalone descriptor always
reports `standalone_transport_unverified`. It does not enable a connection.
`owner` denotes the station itself.

Each media feature selects one of three existing rules:

- `h3` uses the exact owner and firmware policy printed below.
- `established` preserves the original model-only media check for T8160,
  T8142, T8134 and T8213. The normal discovery and transport path still enforces
  model/type, topology and initialization. This exception is not a template for
  adding devices.
- `blocked` returns `camera_media_unverified` when a camera exists on a usable
  transport. A station has no camera media.

All admitted media remains `experimental` in `CameraCapabilities`. Each feature
is evaluated separately. Camera initialization or relationship failures precede
media admission, then owner initialization is checked. For example, a supported
camera with invalid owner credentials retains `invalid_connection_credentials`.
If its media policy also rejects the tuple, `camera_media_unverified` keeps its
existing precedence. Reading capabilities sends no device commands.

Availability, battery and events retain their existing observed-property and
adapter checks. Live policy includes the existing video/audio path and does not
promise audible sound. Recording policy covers download and thumbnail media.
Calendar/list access and its independent permissions remain unchanged.

The table is generated from the runtime registry and checked during `npm test`.
It describes software policy. [MODEL_MATRIX.md](MODEL_MATRIX.md), family evidence
and linked hardware reports retain dated observations, failed features and
unresolved tuples. Refactoring the registry supplies no new hardware evidence.

<!-- generated device profiles: start -->

H3 media requires the actual T8030/type 18 owner,
a matching parent and T8030 serial prefix, and four-part numeric
owner firmware at or above 2.0.9.7.

| Model | Type  | Kind    | Family           | Discovery topology | Snapshot    | Live        | Recordings  | Software evidence                 |
| ----- | ----- | ------- | ---------------- | ------------------ | ----------- | ----------- | ----------- | --------------------------------- |
| T8400 | 30    | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8410 | 31    | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8401 | 34    | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8411 | 35    | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8441 | 45    | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8442 | 46    | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8414 | 100   | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8416 | 104   | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8417 | 105   | camera  | indoor           | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INDOOR.md)             |
| T8030 | 18    | station | homebase         | owner              | blocked     | blocked     | blocked     | [Evidence](DISCOVERY.md)          |
| T86P2 | 111   | camera  | lte              | h3-or-standalone   | h3          | h3          | h3          | [Evidence](LTE.md)                |
| T8111 | 1     | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8110 | 10035 | camera  | eufycam          | h3-or-standalone   | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8112 | 4     | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8113 | 8     | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8114 | 9     | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8140 | 14    | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8161 | 23    | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8600 | 24    | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8162 | 26    | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8144 | 49    | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8172 | 89    | camera  | eufycam          | h3                 | h3          | h3          | h3          | [Evidence](EUFYCAM.md)            |
| T8160 | 19    | camera  | eufycam          | h3                 | established | established | established | [Evidence](EUFYCAM.md)            |
| T8200 | 5     | camera  | wired-doorbell   | standalone         | blocked     | blocked     | blocked     | [Evidence](WIRED_DOORBELLS.md)    |
| T8201 | 5     | camera  | wired-doorbell   | standalone         | blocked     | blocked     | blocked     | [Evidence](WIRED_DOORBELLS.md)    |
| T8202 | 5     | camera  | wired-doorbell   | standalone         | blocked     | blocked     | blocked     | [Evidence](WIRED_DOORBELLS.md)    |
| T8203 | 93    | camera  | wired-doorbell   | standalone         | blocked     | blocked     | blocked     | [Evidence](WIRED_DOORBELLS.md)    |
| T8213 | 91    | camera  | battery-doorbell | h3                 | established | established | established | [Evidence](BATTERY_DOORBELLS.md)  |
| T8214 | 94    | camera  | battery-doorbell | h3                 | h3          | h3          | h3          | [Evidence](BATTERY_DOORBELLS.md)  |
| T8224 | 95    | camera  | battery-doorbell | h3                 | h3          | h3          | h3          | [Evidence](BATTERY_DOORBELLS.md)  |
| T8223 | 96    | camera  | battery-doorbell | h3                 | h3          | h3          | h3          | [Evidence](BATTERY_DOORBELLS.md)  |
| T8142 | 15    | camera  | eufycam          | h3                 | established | established | established | [Evidence](EUFYCAM.md)            |
| T8130 | 32    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8131 | 33    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8170 | 48    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8122 | 60    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8123 | 61    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8124 | 62    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8134 | 63    | camera  | solo             | h3-or-standalone   | established | established | established | [Evidence](SOLOCAM.md)            |
| T8B00 | 64    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8171 | 88    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8173 | 98    | camera  | solo             | h3-or-standalone   | h3          | h3          | h3          | [Evidence](SOLOCAM.md)            |
| T8452 | 132   | camera  | garage           | standalone         | blocked     | blocked     | blocked     | [Evidence](GARAGE.md)             |
| T8453 | 133   | camera  | garage           | standalone         | blocked     | blocked     | blocked     | [Evidence](GARAGE.md)             |
| T84A1 | 151   | camera  | walllight        | h3-or-standalone   | blocked     | blocked     | blocked     | [Evidence](WALLLIGHT.md)          |
| T81A0 | 10005 | camera  | walllight        | h3-or-standalone   | h3          | h3          | h3          | [Evidence](WALLLIGHT.md)          |
| T8425 | 47    | camera  | floodlight       | h3-or-standalone   | h3          | h3          | h3          | [Evidence](FLOODLIGHT.md)         |
| T8426 | 87    | camera  | floodlight       | h3-or-standalone   | h3          | h3          | h3          | [Evidence](FLOODLIGHT.md)         |
| T8530 | 55    | camera  | integrated       | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INTEGRATED_CAMERAS.md) |
| T8790 | 90    | camera  | integrated       | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INTEGRATED_CAMERAS.md) |
| T85V0 | 203   | camera  | integrated       | h3-or-standalone   | h3          | h3          | h3          | [Evidence](INTEGRATED_CAMERAS.md) |

T8224 also admits the reported type 96 with the same policy.
See [MODEL_MATRIX.md](MODEL_MATRIX.md) for the report.

<!-- generated device profiles: end -->

## Reviewing a known-family addition

1. Start a bounded engineering story with permitted identity evidence and the
   actual command-owner topology. Review the applicable family protocol tests.
2. Add one exact row in `device-profiles.ts`. A reviewed Indoor profile following
   the existing H3 route would use `camera(type, 'indoor', 'h3-or-standalone',
h3Media)`. Use the actual proven model and numeric type. No wildcard, guessed
   type, model-prefix matching or firmware expansion is implied.
3. Select snapshot, live and recording policy explicitly. If only some features
   have software evidence, provide a complete policy such as
   `{ snapshot: 'h3', live: 'blocked', recordings: 'blocked' }`. Extend the actual
   family tests for the commands that are admitted and negative owner/firmware
   cases. Recognition does not establish command support.
4. Keep the frozen pre-refactor characterization intact for existing models.
   Add independent expectations for a deliberately admitted new model and update
   the registry completeness test in the same reviewed change.
5. Run `npm run build`, `node scripts/device-profiles.mjs --write`, `npm test`
   and the repository checks. The generated table needs no separate model list.
   Link scoped hardware observations separately before claiming physical support.

## Unknown-device evidence

An `unsupported_device` report already carries a received model code bounded to
`T[A-Z0-9]{4}`, an integer type from 0 through 65535 and bounded firmware/topology
context when available. Use the received pair, parent status/model and owner
firmware to identify a candidate family and the missing evidence. A product
name or serial prefix cannot substitute for the received model field.

Missing, malformed or conflicting evidence remains an explicit gap. Retain mixed
inventory results and redact identifiers in the consumer diagnostic projection.
Unknown reports never add a profile at runtime or trigger protocol probing.
Other-owner, standalone, LTE and NVR research stays in its selected stories.

## Consumer handoff

No session migration, new export, reason code or `CameraCapabilities` field is
required. The combined batch coordinator builds the immutable client candidate
and validates the bridge against it. Preserve its dependency and version
ownership. Existing media, late-audio, ICE, recording permissions and cleanup
tests remain required. Hardware observations remain scoped to the actual device,
firmware, owner and feature tested.
