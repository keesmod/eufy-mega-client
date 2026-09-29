# E15 coordinate-unit assumption, 2026-09-29

Issue [#215](https://github.com/keesmod/eufy-mega-client/issues/215) checked
whether an original Eufy T2880 map-format specification or firmware serializer
was available to establish the physical coordinate unit. No usable source was
found within the search below. No firmware package was obtained, so its
readability could not be assessed.

On 2026-09-29 the owner authorized this availability check and accepted
millimetres as the working assumption if no usable source was available. This
replaces the issue's original source-only acceptance condition. It does not
turn the assumption into a sourced unit or new hardware evidence.

## Availability and readability check

| Checked source                                                                               | Result and limit                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Official E15 support page](https://service.eufy.com/product-description/a08J1000000YhxDIAS) | The retrieved page links a user guide and two EU declarations. No firmware package or map-format specification link was found.                                                                                                                                                                                                                                            |
| [Official E15 product page](https://www.eufy.com/uk/products/t28802a2)                       | The retrieved page links `QSG-E15_gen2.pdf`. No firmware package or map-format specification link was found.                                                                                                                                                                                                                                                              |
| Targeted public searches                                                                     | Searches combining Eufy, Anker, E15 or T2880 with firmware, bin, GPL, open source, map, protobuf and version 6.9.28 found no matching original unit specification or firmware download. A GitHub repository search for T2880 found no relevant repository. Generic Tuya sweeper documentation and other manufacturers' E15 firmware do not establish the Eufy T2880 unit. |
| Retained original app and research material                                                  | Filename and archive-entry checks covered the retained #51 and #213 material, the earlier original Android app research and the installed iPad app bundle. No identifiable T2880 firmware image was found. Matching Android archive entries were update UI assets. This was a bounded inventory, not an examination of every opaque binary.                               |
| Retained `T2880.zip`, `T2880.js` and `T2880_thing.json`                                      | The ZIP contains one product script, `T2880Handle.mix.js`. The product metadata links that script and its ZIP. Firmware references describe version fields, status and upgrade UI availability. No T2880 firmware payload or download response was found in these files.                                                                                                  |
| Retained original Android OTA helper                                                         | `TuyaOtaHelper.requestOtaInfo` delegates to the generic SDK method `getFirmwareUpgradeInfo`. The separate `startOta` method invokes `startFirmwareUpgrade`. These names are not a retained T2880 firmware response or a verified standalone read-only download path. Neither method was called.                                                                           |
| Current macOS app data and update cache                                                      | The app container's `Data` directory returned `Operation not permitted`. Its current cache was not inspected. Existing private copies remained readable. No permission change or access bypass was attempted.                                                                                                                                                             |

Both official pages returned HTTP 200 on 2026-09-29. Private HTML snapshots
have SHA-256 `706477803254dc7d42caeed48e0a19fd560fb2b850de7f2100dacf6bafe560df`
for the support page and
`a5f6c03421944acb41ff29fa7487271abfa3fa40c9ab6f1401535073363b11a9`
for the product page. The retained product script is the same artifact pinned
in the [#213 source report](E15_MAP_SEMANTICS_2026-09-29.md). Its ZIP has SHA-256
`45337b828a1012906c3a96da6d51483f8c40b78d9389d7a5eefc0fde95285a84`, and its
product metadata file has SHA-256
`888ec2542e97539d9b9ee49ba732d97435c1d83d37db498f366da2fc0fcac5b2`.
The retained original Android helper text has SHA-256
`9c4f2af990e21ab013f1ac40989c3c70d4e0552e02909c4c0915e9e97a402453`.

This result means that the checked sources did not supply a usable unit
definition. It does not establish that firmware is unavailable everywhere or
unreadable. No authenticated firmware endpoint was called, no new app session
was started and no OTA was triggered. The earlier app drawing analysis was
not repeated.

## Accepted interpretation and evidence level

The E15 T2880 working assumption is **one coordinate unit equals one
millimetre**. It applies consistently to `Point.x` and `Point.y`, including
map origin, polygon vertices and path positions, and to `Pose.x` and `Pose.y`
in the station pose, cleaning-path `endPose` and navigation pose.
`Map.resolution` consequently means assumed millimetres per grid cell.
Grid `width` and `height` remain cell counts. For example, a difference of
1000 coordinate units is assumed to represent one metre.

| Semantic                                                                    | Evidence level                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Coordinate lengths and `Map.resolution` scale                               | Owner-accepted millimetre assumption, unconfirmed by a primary unit source or physical measurement |
| `Pose.theta` in milliradians                                                | App-sourced by #213, unchanged                                                                     |
| `navPath.bin.stream` as location/pose input to the app                      | App-sourced by #213, unchanged. It does not establish freshness or physical accuracy               |
| `totalArea` unit, coordinate frame, heading reference and physical accuracy | Unconfirmed                                                                                        |

The library still exposes all wire integers unchanged. This documentation
adds no conversion, unit field, API guarantee or runtime behavior. All geometry
remains display only and must not drive control. A display using a metric
label must identify the millimetre scale as assumed. This does not validate
distance accuracy or square-metre output, and it establishes no unit for other
angle or area fields. E18 and other firmware are not covered.

## Retained capture consistency

The [#213 replay](E15_MAP_SEMANTICS_2026-09-29.md#capture-check-and-acceptance-boundary)
already decoded all three files in both retained 2026-09-10 captures. Its
private result receipt was read again for this decision. No new replay or
live capture was needed for this documentation change.

In each capture, the boundary shoelace area divided by `totalArea` was within
one percent of 100,000. That is consistent with millimetre coordinates only
if `totalArea` is measured in tenths of a square metre. Neither unit follows
from the ratio alone. The owner accepted the coordinate assumption, without
accepting a `totalArea` conversion or changing any hardware confirmation level.

The source evidence gap remains recorded here and in the model matrix. A
future permitted specification, readable original firmware serializer or
separately authorized physical measurement can revise the assumption. It is
no longer an unfinished acceptance condition of #215.

## Scope and privacy

This is a documentation patch. App artifacts, archive inventories, cached
metadata and search receipts remain private. No app implementation, raw
captures, coordinates, device identifiers or lawn geometry were copied into
the repository. The unlicensed mower fork was not used. There was no live
mower session, firmware installation, physical command, settings write,
protected-binary decryption, deployment or product release.
