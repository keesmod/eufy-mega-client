# Decoded mower map geometry

Issue [#51](https://github.com/keesmod/eufy-mega-client/issues/51) delivers
typed, read-only decoding of the three E15 map files that
[`PortableMapAcquisition`](MAP_ACQUISITION.md) retains. The field numbering
comes from the original parser as recorded in the provenance section below. The
decoder is an independent TypeScript implementation on Node built-ins. It never
sends, edits or selects anything. Maps stay read-only.

## Public contract

```ts
import { decodeMowerMapSnapshot, type MapAcquisitionSnapshot } from '@keesmod/eufy-mega-client';

function describe(snapshot: MapAcquisitionSnapshot) {
  const geometry = decodeMowerMapSnapshot(snapshot);
  for (const fault of geometry.faults) console.warn(fault.file, fault.reason, fault.path);
  const lawn = geometry.map?.regions[0]?.boundary;
  const history = geometry.cleaningPath?.points.length ?? 0;
  return { lawn, history, station: geometry.map?.stationPose, pose: geometry.navigationPose };
}
```

`decodeMowerMapSnapshot` takes the `lastComplete` snapshot of an acquisition
and returns `MowerMapGeometry` with the snapshot's `revision` and `receivedAt`,
the decoded `channel` message and its realtime `map`, the `cleaningPath` and
the display-only `navigationPose`. Each file decodes independently. A file that
fails leaves the other two intact and adds one entry to `faults` with the file
name, the structural reason, the absolute byte offset and the dotted message
path. `decodeMowerMapFile`, `decodeMowerPathFile` and `decodeMowerPoseFile`
decode one file each and return `{ shape: 'decoded' }` or
`{ shape: 'malformed' }`. None of them throws on malformed input. They never
mutate the input and return plain data that survives `structuredClone`.

Every field is exposed as carried on the wire. Integers stay integers, absent
scalars take the protocol default of zero, false or an empty string, and absent
messages stay `undefined`. Enumerations map to lowercase names with the raw
code beside them, and a value outside the known set reports `unknown` with its
code. Field numbers that this decoder does not interpret are listed in
`undecodedFields`. Polygons with fewer than three distinct points, lines with
equal endpoints and ellipses with a zero axis are reported with
`degenerate: true` and never repaired. The map reports `issues` for an empty
grid, a zero resolution, a missing origin, a missing or out-of-bounds station
pose and a degenerate region boundary. `bounds` spans `origin` plus
`width × resolution` and `height × resolution` in map units when all three are
present and positive.

The library invents no mowing zones. Sub-region selection state is reported as
read-only data, no method selects, orders or edits anything, and there is no
E18 coverage.

## Accumulated cleaning-path history

Issue [#178](https://github.com/keesmod/eufy-mega-client/issues/178) adds
`MowerPathAccumulator`, a library-owned accumulator that merges the decoded
cleaning paths of successive acquisitions into one ordered history while it
preserves the end pose, the map generation and the freshness of every point.
The adapter of #50 replaces a retained file when a later complete file
arrives, so a consumer that only keeps `lastComplete` sees the path of the
latest acquisition. The accumulator keeps what earlier acquisitions carried
and records where every point came from. It changes nothing in the adapter or
the decoder.

```ts
import {
  decodeMowerMapSnapshot,
  MowerPathAccumulator,
  type MapAcquisitionSnapshot,
} from '@keesmod/eufy-mega-client';

const paths = new MowerPathAccumulator();

function record(snapshot: MapAcquisitionSnapshot) {
  const result = paths.merge(decodeMowerMapSnapshot(snapshot));
  if (result.outcome === 'started' && result.previous) archive(result.previous);
  if (result.outcome === 'rejected') console.warn('path input rejected', result.reason);
  return paths.history;
}
```

`merge` reads `revision`, `receivedAt`, `map` and `cleaningPath` of a
`MowerMapGeometry` and returns the outcome together with the current history.
Feed it every snapshot in receipt order, one accumulator per mower. The
history is frozen plain data that survives `structuredClone`. Its `points`
are the decoder's points in wire order with their kind and code unchanged,
and each entry of `segments` names a point range, the acquisition `revision`
and `receivedAt` it came from and the kind of the path file that carried it.
`endPose` and `kind` follow the latest `history` or `complete` path,
`confirmed` counts the leading points such a path established, and `revision`
and `receivedAt` name the latest input that extended or confirmed the history.
`history` returns the current history and `clear` drops and returns it.

The merge rules are structural comparisons of the points the wire carried:

- A history is keyed by the map id, the path id and the map generation, which
  is the grid (`width`, `height`, `resolution` and `origin`) and
  `lastSavedTime` of the realtime map in the same snapshot. A different key
  starts a new history with reason `identity` or `generation`. The previous
  history is returned in `previous`, never mixed in.
- A `history` or `complete` path is authoritative for the whole path. When it
  repeats the current points and continues them, only the continuation is
  appended as a new segment (`extended`). When it carries nothing beyond the
  current points, the history is `unchanged` and only its freshness advances,
  plus the confirmed count, end pose and kind when the path reaches the
  confirmed points. When it agrees with the confirmed points but not with the
  provisional tail, that tail is replaced (`replaced` counts the points) so
  that the history equals the path on the wire. When it diverges inside the
  confirmed points, a new history starts with reason `diverged`.
- A `realtime` path never replaces a point, the kind or the end pose that a
  history or complete path established. Its points extend the history
  provisionally: a continuation of the current points or of the provisional
  tail adds only the new points, a repetition changes nothing but the
  freshness, and points that match neither are appended as one segment. The
  next history or complete path confirms or replaces them.
- An empty path of any kind changes nothing, including the empty `realtime`
  placeholder that opens every demand with a zero end pose. An input whose
  `receivedAt` precedes the latest merged input is `out_of_order`, one that
  repeats its revision and `receivedAt` is a `duplicate`, a structurally
  invalid input is `malformed`, a snapshot whose path or realtime map did not
  decode is `path_unavailable` or `map_unavailable`, a path with an unknown
  kind code is `unknown_kind`, a path whose `mapId` differs from the map id is
  an `identity_mismatch`, and growth beyond `maxPoints` (default 4,194,304,
  the wire record budget) is `too_many_points`. None of them touches the
  existing history.

Receipt order is decided by `receivedAt` because the acquisition adapter
restarts `revision` with every instance. Revisions are recorded as provenance
only. Only `points` are accumulated. `legacyPoints`, the opaque compressed
data and undecoded fields are not.

| Behaviour                                                                                    | Source                                                                                  | Level                                      |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| An empty `realtime` placeholder with a zero end pose precedes the `history` file of a demand | Retained captures of 2026-09-10 replayed through the accumulator on the owner's machine | capture                                    |
| A repeated `history` path merges as unchanged and a stale replay is rejected                 | Same replay                                                                             | capture                                    |
| A changed grid coincides with a different history path and starts a new history              | Same replay, two captures of one map                                                    | capture                                    |
| Growth of one history across acquisitions and the replacement of a provisional tail          | Synthetic fixtures only, no retained capture holds two lengths of one path              | software                                   |
| Non-empty `realtime` paths and whether they carry the whole path or only the new points      | No source and no capture                                                                | unconfirmed, handled structurally as above |
| The merged history against the app's displayed path on the owned device                      | Not run in #178                                                                         | open hardware obligation                   |

No coordinate, count, name or identifier from the replayed captures appears
in this repository. The replay reported outcomes only.

## Field semantics and confirmation levels

Levels: **parser** means read from the original parser's own serializers and
deserializers, **capture** means additionally validated against the retained
private captures of 2026-09-10, and **display only** means the association or
unit is not confirmed by a source and the value must not drive control.

| File and message                  | Fields                                                                                                                                                                                                          | Meaning                                                              | Level                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| `map.bin.stream`, `MapChannelMsg` | 1 type, 2 realtimeMap, 3 multiMap                                                                                                                                                                               | Channel envelope. The transfer carries the realtime map              | parser, capture                    |
| `RealtimeMap`                     | 1 map, 2 legacyPath                                                                                                                                                                                             | Current map and an optional legacy path                              | parser, capture                    |
| `Map` identity                    | 1 id, 2 name, 34 type, 17 mapState, 29 lastSavedTime (`Timestamp` 1 seconds, 2 nanos)                                                                                                                           | Map identity, kind, state and save time                              | parser, capture                    |
| `Map` grid                        | 3 width, 4 height, 5 resolution, 6 origin (`Point` 1 x, 2 y as sint32), 16 totalArea                                                                                                                            | Grid extent and origin. All retained geometry lies inside the bounds | parser, capture                    |
| `Map` station                     | 7 hasStation, 8 stationPose (`Pose` 1 x, 2 y, 3 theta as sint32)                                                                                                                                                | Dock position and heading                                            | parser, capture, unit display only |
| `Map` boundary                    | 10 regions (`Region` 1 id, 2 name, 3 boundary, 4 subRegions, 6 obstacles), `SubRegion` 1 id, 2 name, 3 boundary, 4 isSelectedForMow, 5 adjacentSubRegionIds, 6 selectedForMowOrder, 7 center, 9 innerBoundaries | Lawn boundary polygons and their sub-regions                         | parser, capture                    |
| `Map` exclusion                   | 11 obstacles (`Polygon` 1 points), 12 forbiddenZones (1 id, 2 boundary, 3 isPolygon, 4 shape, 5 ellipse), 14 physicalForbiddenZones (1 id, 2 polygon, 3 isClosed), 13 virtualWalls (1 id, 2 line)               | No-go geometry: obstacles, virtual and physical zones, walls         | parser, capture for 11 and 12      |
| `Map` pathway                     | 18 crossBoundaryTunnels and 32 virtualCrossBoundaryTunnels (1 points, 2 id), 35 passThroughZones (1 id, 2 boundary, 3 shape, 4 ellipse), 15 crossBoundaryMarkers (1 id, 2 pose)                                 | Connections between lawn parts                                       | parser, capture for 18             |
| `Map` other geometry              | 26 requiredZones (1 id, 2 boundary, 3 obstacleAvoidance, 4 shape, 5 ellipse), 20 trappedPoints (1 id, 2 point), 38 maintenancePoints (1 id, 2 position, 3 name)                                                 | Required zones, trap and maintenance markers                         | parser, capture for 26             |
| `Map` flags                       | 21 hasBirdView, 22 birdViewIndex, 25 hasBackup, 30 mainDirectionAngle, 37 mapViewRotateAngle, 39 isBoundaryLocked, 9 compressedData as a length only                                                            | Presentation state                                                   | parser                             |
| `Map` undecoded                   | 19, 23, 24, 27, 28, 31, 33, 36, 40, 41                                                                                                                                                                          | Settings, backups and bird-view details, listed in `undecodedFields` | parser, not decoded                |
| `cleanPath.bin.stream`, `Path`    | 1 id, 2 mapId, 3 type (realtime, history, complete), 4 compressedData as a length, 5 endPose, 6 legacyPoints, 7 points (`PathPoint` 1 position, 2 type)                                                         | Mowing history of the current map                                    | parser, capture                    |
| `PathPoint.type`                  | cleaning 0, return 1, resume 2, cross_boundary 3, move 4, mapping 5, semi_auto_manual_mapping 6                                                                                                                 | Segment kind per point                                               | parser, capture                    |
| `navPath.bin.stream`, `Pose`      | 1 x, 2 y, 3 theta                                                                                                                                                                                               | A pose record. Its meaning is not confirmed                          | capture, display only              |
| Shapes                            | rectangle 0, polygon 1, ellipse 2 (`Ellipse` 1 center, 2 semiMajorAxis, 3 semiMinorAxis, 4 rotationAngle float)                                                                                                 | Zone shape                                                           | parser                             |

Units are not stated by any source read in this run. The wire carries integers
and the library exposes them unchanged. Two observations in the retained
captures are consistent with millimetre coordinates and milliradian headings:
the boundary polygon area divided by `totalArea` is one hundred thousand in
both captures, which matches millimetres with `totalArea` in tenths of a square
metre, and the docked heading values are plus and minus 1571. These remain
observations. The `navPath.bin.stream` association rests on structure alone:
the six-byte file decodes as a pose at the station position with a mirrored
heading in both retained captures, and no readable file dispatch names its
message. Consumers may display these values and must not derive control from
them.

## Provenance

What was read, where and how it was verified:

1. The installed App Store app "Anker eufy" 6.1.00 on the owner's Mac, an iPad
   app on Apple Silicon. Its main executable is FairPlay protected, every
   embedded framework is not. The owner confirmed this route on 2026-09-20 in
   chat, recorded on #51.
2. `Frameworks/ESIotMegaKit.framework`, a Kotlin/Native framework with
   unstripped symbols. Its symbol metadata names the mower map model
   (`MowMapData`, `MowPath`, `MowMapPose` and the other classes with their
   property names and types) and its parse flow: the map bytes go to a
   JavaScript context and come back as JSON that the Kotlin model reads. Read
   with `nm`, `otool`, `llvm-objdump` and byte scans on the owner's Mac.
3. The product script that the app downloads per product code and evaluates
   in JavaScriptCore, `T2880Handle.mix.js` for the E15, cached by the app as
   `Documents/megaeupr/JavaScript/T2880.js` and `T2880.zip` with SHA-256
   `0be33785e7c70d2c2e890d0f3b9d4ee512dca527b447ca95651ba683d5ef048d`, file
   date 2026-06-18, delivered to the app on 2026-09-16. It contains
   google-protobuf JavaScript classes `proto.proto.mower.*` and
   `proto.proto.mower.p2p.*`. Every field number, wire type, nested type and
   enumeration in the table above was read from their `serializeBinaryToWriter`
   and `deserializeBinaryFromReader` functions. The copies and hashes are
   retained privately with the #49 captures and are not published.
4. Verification against the retained captures of 2026-09-10, a normal-source
   bundle and the portable acquisition: the map file decodes as
   `MapChannelMsg` with a realtime map, the history file as a `history` path,
   both without wire-type conflicts, every boundary, obstacle, zone, tunnel and
   path point inside the grid bounds, the station pose and the path end pose
   inside the bounds and close to each other, path point kinds within the
   enumeration and the map state complete. No coordinate, count, name or
   identifier from those captures appears in this repository.

No schema, constant, fixture, test or interpretation table from the unlicensed
mower fork was read or used. No code was copied from the app. The decoder,
the fixtures and the tests were written independently from the numbering above.
The earlier attempts of 2026-09-11 on the Android packages and the emulator
were not repeated.

## Software evidence

| Device and route                     | Feature                                                               | Evidence                                                                                                                               | Claim                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| E15 T2880, app 6.1.00 product script | Map, path and pose decoding from the original parser's numbering      | [Decoder](../src/mowers/maps/geometry.ts), [wire reader](../src/mowers/maps/protobuf.ts), [tests](../test/map-geometry.test.mjs)       | Experimental software coverage from #51                                                                      |
| Same profile, retained captures      | Structural validation of the numbering                                | Private captures of 2026-09-10, method above                                                                                           | Capture-validated, no fresh hardware trial                                                                   |
| E15                                  | Fresh acquisition decoded end to end on the owned device              | Not run in #51                                                                                                                         | Open hardware acceptance                                                                                     |
| E15 T2880, same profile              | Cleaning-path history across acquisitions                             | [Accumulator](../src/mowers/maps/history.ts), [tests](../test/map-path-history.test.mjs), retained captures replayed as recorded above | Experimental software coverage from #178, capture-validated for the placeholder, repeat and generation cases |
| E15                                  | Live path growth merged and compared with the app on the owned device | Not run in #178                                                                                                                        | Open hardware acceptance                                                                                     |
| E18 or other firmware                | Any decoding                                                          | No evidence                                                                                                                            | Unclaimed                                                                                                    |

The tests use synthetic geometry only. They cover identity, grid, bounds and
station pose, boundary, exclusion and pathway fields with nested polygons,
ellipses and lines, path point kinds and end pose, independent per-file
faults, the pose-only rule for `navPath.bin.stream`, malformed input
(truncated and overlong varints, field zero, groups, unknown wire types, length
overflow, wire-type mismatches at several depths, the nesting and record
budgets), omitted axes and empty records, degenerate geometry and grid issues,
unknown enumeration values, packed and unpacked integer lists, undecoded fields
and the multi-map branch. No live session, helper change or hardware trial was
part of #51. The existing Android map source is unchanged.

The #178 tests use the same synthetic fixtures. They cover growth of one
history across acquisitions with per-segment provenance, a restarted revision
counter, every identity and generation change, the empty realtime placeholder,
realtime continuations, deltas and repetitions, the replacement of a
provisional tail by the next history path, a complete path confirming
realtime points, malformed inputs of every shape, undecodable files, unknown
kinds, identity mismatches, stale and duplicate inputs, shorter history files,
diverging tasks, frozen output, caller mutation after the merge, the point
bound and option validation. No live session or hardware trial was part of
#178.

## Remaining obligations

- The bounded owned-device window of
  [#178](https://github.com/keesmod/eufy-mega-client/issues/178) under the
  live rules (fresh binding, reclaimed exclusive ownership, backups,
  independent recovery and a verified normal acquisition afterwards) that
  compares the merged history with the app's displayed path and observes
  whether non-empty `realtime` paths reach this transport remains open.
- The compatibility adapter for the existing map-bundle contract and the
  packaged acquisition on Linux amd64 and arm64 remain on the 2026-09-16 list
  recorded on #51 and are not scheduled.
- A source for the coordinate and heading units, the meaning of
  `navPath.bin.stream` and a fresh acquisition decoded end to end on the owned
  E15 remain open. Until then the pose values stay display only.

## Privacy

Decoded maps are private lawn geometry. Do not log, upload or include them in
diagnostics, and keep captures, identifiers and fixtures with real coordinates
out of the repository. Synthetic fixtures describe no real lawn.
