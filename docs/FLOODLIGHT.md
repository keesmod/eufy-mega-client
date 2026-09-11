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
Remaining Floodlight model and command-owner work stays in
[epic #9](https://github.com/keesmod/eufy-mega-client/issues/9) and the matrix.
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

## H3 media profile

#30 adds stored snapshots, live video/audio and recordings for the two exact
pairs. Admission requires the matching T8030/type 18 parent, a T8030 owner serial
prefix, LAN-derived credentials and numeric four-part owner firmware at or above
2.0.9.7. This is the existing conservative additional-H3 profile, not a newly
measured Floodlight minimum. Unknown, malformed or earlier owner firmware keeps
`camera_media_unverified`. The tests use synthetic camera firmware 1.2.3 and owner
3.8.6.0, with a separate check at the admission boundary 2.0.9.7.

Both models reuse `Station.startLivestream`, but the existing envelopes differ:

| Model    | Existing live payload                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| T8425/47 | `CMD_DOORBELL_SET_PAYLOAD`, command 1000, `accountId`, `camera_type=0`, `entrytype=0`, public `encryptkey` and `streamtype` 0/1 |
| T8426/87 | `CMD_DOORBELL_SET_PAYLOAD`, command 1000, `account_id`, public `encryptkey` and `streamtype` 0/1                                |

Tests assert the complete vendor payload for H.264 and H.265 and the actual
channel. No vendor source or transport implementation changes are needed.

Stored snapshots use the latest HomeBase cover query and `CMD_DATABASE_IMAGE`.
They do not request a fresh exposure. Recordings use the existing date/count
queries and H3 `CMD_DOWNLOAD_VIDEO` payload with path and public download key.
The historical upstream H3 download TODO remains in source. Synthetic tests
establish that the branch is reachable, not that these cameras produce playable
recordings on hardware.

Live stop requires matching `CMD_STOP_REALTIME_MEDIA` acknowledgement and local
stop. Recording cancellation requires `CMD_DOWNLOAD_CANCEL` acknowledgement.
Local EOF alone is not recording completion. Existing time/byte limits,
cancellation ownership, late-event cleanup and isolation between HomeBases stay
in place. No legacy-cloud fallback or uncertain command replay is added.

[Media fixtures](../test/fixtures/floodlight-media.mjs) extend the existing
[command/media suite](../test/eufycam-media.test.mjs),
[capability suite](../test/capabilities.test.mjs) and
[lifecycle suite](../test/family-lifecycle.test.mjs). Each model gets snapshot
bytes, separate audio/video bytes, full recording metadata, thumbnail/download,
completion/cancellation and exact command checks. Missing/rejected stop or cancel
acknowledgements cannot report success. A failed stream must leave a simultaneous
second HomeBase's audio working. Unsupported firmware/model/owner is rejected
before media commands. The two snapshot regressions fail with
`camera_media_unverified` before #30 admission and pass after it.

No physical stream, decoded video, audible track, device stop or recovery has
been confirmed for either model. Those feature-specific results remain #60.
The other Floodlight model barriers remain under epic #9. They are not counted
as delivered by this bounded profile.
