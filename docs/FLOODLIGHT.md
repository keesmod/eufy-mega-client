# Floodlight cameras

Version 0.12.0 adds experimental software coverage for exact **T8425/type 47
(E340)** and **T8426/type 87 (E30)**. This does not confirm operation on physical
cameras. [#29](https://github.com/keesmod/eufy-mega-client/issues/29) owns discovery,
state and events. [#30](https://github.com/keesmod/eufy-mega-client/issues/30) owns
media on the selected connection profile.

## Model and connection boundary

The [official HomeBase 3 table](https://service.eufy.com/article-description/S380-HomeBase-HomeBase-3-Compatibility),
checked 2026-09-11, distinguishes storage compatibility from AI, modes and
automation. Product compatibility alone is not evidence of a Mega command route.

| Model/type                  | Scope in this client                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8425/47, T8426/87          | Exact classification and existing commands through an actual T8030/type 18 parent. Empty or self parent remains a standalone descriptor with `standalone_transport_unverified`. Other owners return `unsupported_station`. |
| T8420/3 and T8420X variant  | `unsupported_device`. The original model excludes H3. The X variant identifies a serial variant, not an interchangeable command profile. Its listed H3 compatibility is storage only.                                      |
| T8422/37, T8424/39          | `unsupported_device`. Storage compatibility does not establish H3 command ownership.                                                                                                                                       |
| T8423/38                    | `unsupported_device`. H3 storage is listed, AI/modes remain under evaluation. Its existing live envelope alone does not establish the selected owner profile.                                                              |
| Unknown or mismatched pairs | `unsupported_device`, without disabling other cameras.                                                                                                                                                                     |

The original T8420 and X variant are not merged or inferred from their common
type. No new model alias or guessed serial discriminator is introduced.
Remaining Floodlight models stay in #29/#30 and the matrix.
[#35](https://github.com/keesmod/eufy-mega-client/issues/35) owns other HomeBases,
[#36](https://github.com/keesmod/eufy-mega-client/issues/36) standalone transport,
and [#60](https://github.com/keesmod/eufy-mega-client/issues/60) hardware evidence.

## Discovery, state and events

The existing attributed `FloodlightCamera` class has its own decoder for native
motion/person pushes (3101/3102). Selecting it preserves those events that generic
`Camera` alone would not decode. It does not introduce a second connection or a
new protocol implementation. Source: `vendor/src/http/device.ts` and
`vendor/src/http/station.ts` at commit
`34863d81eb3bc50dbc095ff537fe156640f7042e`, with provenance in `NOTICE.md`.

The actual parent and channel remain authoritative. Public identifiers and
observed firmware are preserved. The pinned property tables have no battery or
device-availability property for these two models. Those values remain `null`,
even if unrelated synthetic parameters contain plausible numbers. A HomeBase
connection is not proof that a child is online.

Motion/person events use the existing supported-property checks. Ring events
are unavailable. Local callbacks, native pushes and H3 companion notifications
share the existing correlation and replay suppression. Wrong-owner events and
inactive property resets cannot create detections.

The independently authored [Floodlight tests](../test/floodlight.test.mjs) use
synthetic inventory and events with the real adapter. They check exact adapter
selection, preserved ownership, unknown state, standalone blocking, family
isolation and event correlation. Synthetic events do not prove physical delivery.
No lights, PTZ, talkback or settings are enabled.

No physical test, consumer upgrade or publication is performed. The
[community process](COMMUNITY_VALIDATION.md) records voluntary results per model,
firmware, topology and feature. Missing hardware feedback alone does not block
ordinary upgrades. There is no session-store migration. Keep the preceding
package, lockfile and private store for rollback.
