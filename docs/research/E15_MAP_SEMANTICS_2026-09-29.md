# E15 map units and navigation pose, 2026-09-29

Issue [#213](https://github.com/keesmod/eufy-mega-client/issues/213) checked the
installed app and the retained captures offline. The app treats pose `theta`
as milliradians and routes the `navPath` file family to its location decoder.
The physical coordinate unit remains unconfirmed. The library continues to
return the wire integers unchanged and consumers must keep the geometry display
only. There is no typed-output change, release or deployment in this research.

Later on 2026-09-29, [#215 checked source availability and recorded the owner's
millimetre assumption](E15_COORDINATE_ASSUMPTION_2026-09-29.md). That accepted
interpretation does not change the source findings below or establish a
physical unit.

## Sources and method

The source is the owner's installed App Store "Anker eufy" 6.1.00, build
260908221344, for iPad on Apple Silicon. Sources were read with `nm`, `otool`,
`llvm-objdump`, Swift symbol demangling and bounded byte scans. Names and
addresses below identify observations, not copied implementation code.

| Artifact                              | SHA-256                                                            | Use                                                               |
| ------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `ESIotMegaKit.framework/ESIotMegaKit` | `91bf4b7ec04d6e19d428c7082051f0dcccaa829cb612166af20812effbae3028` | Kotlin model getters, pose conversion and location consumer       |
| `BatteryCam` main executable          | `e9b3a8c3b9a460fcdb8e5181752d1b29b6caf3de129c9e69579ce268b2d1cc1e` | File dispatch, callback routing, Swift map conversion and drawing |
| Cached `T2880.js`                     | `0be33785e7c70d2c2e890d0f3b9d4ee512dca527b447ca95651ba683d5ef048d` | Wire `Pose` and the `ecl_decode_location_info` action             |
| Bundled `RN_IOS_ECL_MOW_PANEL.zip`    | `0d778f38ad9ad7a5ee7fd3f7d0f7a98a9d41c37de898afb9b9cbb6f8ac9457c7` | Native map-view and map-data-event references                     |
| Its `index.ios.hbc`                   | `cb91c558af7dce7e4d80dfd3ac7fcf6ce233e678e52c32aef2fdaf56c7eeb329` | Byte/string inspection, no unit claim derived from it             |

The two inspected `EHMapView.bundle` style files are also pinned:
`EHMapUIStyle_13.json` has SHA-256
`0ef0f83258d46f81ac4a57406fe13937440747f68e8aced4452e5a9b10ceb438`, and
`EHMapUIStyle_17.json` has SHA-256
`43bb84364b2c3ab47521481db636e548da165944b8df91f92ff77747352c143b`.

The framework has `cryptid 0`. The main executable has `cryptid 1`, with the
protected file range `[0x1c73000, 0x1c74000)`. Every main-executable instruction
range used below was checked against the Mach-O segment mapping and lies
outside that range. The main image base is `0x100000000`. Nothing was decrypted,
executed or instrumented. The previously retained panel file has a different
hash, so its earlier inspection was not treated as proof about this bundle.

App files, disassembly, capture replay code and the private results remain on
the owner's machine. No app code, raw captures, coordinates, lawn geometry or
identifiers are included here. The unlicensed mower fork was not used.

## Pose heading

`MowMapPose.get-theta` in `ESIotMegaKit`, at `0x1103d50`, reads the integer at
object offset `0x8`. The corresponding `x` and `y` getters read `0xc` and
`0x10`. This resolves the fields independently of guessed memory layout.

`MowMapDataParse.transferMowMapPose2CommonPositionData`, at `0x83d9f0`, reads
that same `theta`, divides it by 1000 and converts radians to degrees with
180 divided by pi. It wraps negative angles for display and truncates the
result to an integer degree. The constant at `0x1c3e190` is pi. The station
branch of `transferOriginMowData2MowMapData`, starting at `0x83cb38`, applies
the same conversion to `stationPose.theta`.

This establishes **app-sourced milliradians for `Pose.theta`**. It does not
establish a compass reference, a global coordinate frame, an accuracy bound or
a unit for other fields such as `mainDirectionAngle`, `mapViewRotateAngle` and
`Ellipse.rotationAngle`. The decoder still returns raw `theta`, not degrees.

## Navigation file meaning

The complete filename is not a literal in the app. Its file classification uses
prefixes. In the main executable:

1. `ThingSmartSweeperP2PUtil.sweeper_type:data:`, at `0x1015f71dc`, takes the
   last path component and checks its prefix. `map` produces `type` 0,
   `cleanPath` produces 1, and `navPath` produces 3, each with the supplied
   `data`. This includes `navPath.bin.stream`.
2. The callback at `0x1001813c0` reads the payload's `type` and `data` and
   passes that type as `channelId` to
   `reportMapDataSection:receiver:event:channelId:clearType:offset:len:data:`.
   The call is at `0x1001818e0`.
3. In `ESIotMegaKit`, `MowMapDataMonitor.parseData` dispatches `channel_id` 3
   to `ecl_decode_location_info`. The `channel_id` getter at `0x11c3fa8`
   confirms the tested field. The call to `parseMapByAction` is at `0x861d58`.
4. `T2880.js` maps that action to `decodePose`, which uses the same `Pose`
   fields as the station. The native consumer calls the heading conversion
   at `0x861ec4` and stores the result as `MapCommonData.mRobovacLocation`.
   The location getter at `0x11e52ac` confirms the destination field.

This establishes **app-sourced location/pose input**, rather than a route
polyline, for the E15 file. The app may combine it with cleaning-path data:
when `pathDataList` is non-empty, it uses the last point's coordinates and the decoded
pose's heading for the displayed location. Otherwise it uses the pose position.
This is display behavior, not a statement that the file alone always contains
the freshest or physically accurate mower location.

[Tuya's generic sweeper SDK documentation](https://developer.tuya.com/en/docs/iot-device-dev/Sweeper_SDK?id=Kay13p0gl0hzq)
calls this file family navigation-route transfer. That describes the transport
category. The installed E15 product parser and consumer establish the more
specific pose interpretation above.

## Coordinate unit: negative result

The native `MowMapDataParse` conversion preserves the coordinate integers and
the grid metadata. The Swift
`CleanMapBridge.EHMegaMowerMapParseHelper.parseMowerMapData`, at
`0x10020a668`, converts geometry coordinates to grid positions by dividing by
`BaseMapInfo.resolution`. For example, the reads at `0x10020d424` through
`0x10020d4b8` resolve to `x`, `y`, `baseMapInfo` and `resolution` through the
Objective-C selector references. `EHMegaMowerMapDrawTool`'s
`convertPointFromDataToView:mapRoomModel:`, at `0x10044ba50`, then subtracts
the drawing offsets. These operations establish a relative grid scale.

The additional metric-label check found an independent display scale:
`EHMapForbiddenRectElementItem.updateSizeLabel`, at `0x10040a9ec`, multiplies
its size by `resPixWidth` and passes it to
`EHMapChangeUnitsHelper.transformedFloatMeter:deviceType:`. Mower styles 13
and 17 carry `pixWidth` 0.02 and `isMowerUnit` 1. No inspected operation ties
that style value to the wire `resolution` as a physical-unit contract. A fixed
UI scale, or agreement with one captured resolution, is insufficient to claim
that all coordinate integers are millimetres.

**No physical coordinate unit was established.** The next candidate primary
source is Eufy's original T2880 map-format specification or firmware serializer
for `Point.x`, `Point.y` and `Map.resolution`, with an explicit length unit and
coordinate-frame definition. That source is not in the retained research
material. [#215](https://github.com/keesmod/eufy-mega-client/issues/215)
originally blocked on that source. The later
[availability check and owner decision](E15_COORDINATE_ASSUMPTION_2026-09-29.md)
replaced that acceptance condition with an explicit millimetre assumption.
Re-reading the same drawing divisions or assuming the unit from the polygon
area does not close the source evidence gap.

## Capture check and acceptance boundary

Both retained 2026-09-10 captures were replayed through the unchanged 0.27.0
decoder built from `e80b04903fbe15afea1c1ee17524e66b88c45b6a` on Node 24.
All three files decoded in each capture. The navigation pose position matched
the station and its heading had the opposite sign. Interpreted as milliradians,
the docked heading magnitudes were within 0.001 radians of a quarter turn.

The boundary shoelace area divided by `totalArea` was within one percent of
100,000 in each capture. The earlier statement that it equalled 100,000 was
rounded too strongly and is corrected here. This remains consistent with a
millimetre hypothesis if `totalArea` is in tenths of a square metre. Neither
part of that hypothesis is established by the ratio itself.

The source observations establish heading units and the app's pose routing.
The capture replay checks consistency only. There was no live mower session,
physical command, settings write, new app account use or latest-good-map read.
The coordinate unit and frame remain display only. No control capability,
selectable zone, E18 support or new hardware acceptance is claimed.
