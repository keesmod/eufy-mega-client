# Camera model, topology and feature evidence

Reviewed 2026-09-10 for [story #15][Story]. This is an evidence inventory for the
[programme][Programme], not a list of supported products. Product implementation
belongs to [E2] and hardware acceptance to [E6]. Current work status stays in GitHub.

The camera bridge and integration belong in `ha-eufy-cam`. The separate mower
bridge and integration belong in `eufy-robomow-ha`. Both consume this library
independently, as described in [PROGRAMME.md](PROGRAMME.md).

## Community evidence, 2026-09-11

The [community policy](COMMUNITY_VALIDATION.md) separates ordinary upgrades from
the evidence below. A model without a maintainer test is not an upgrade exclusion.
Runtime protocol limitations remain. Share results through the
[compatibility form](https://github.com/keesmod/ha-eufy-cam/issues/new?template=compatibility.yml)
or the original issue for an existing defect.

The historical codes remain unchanged: X is unconfirmed implementation, P is
reported working, H is a dated hardware observation, F is a known reported problem,
and U is unknown. B1/U and B2/U describe historical implementation barriers at
their pinned commit. They do not label all newer releases unsupported. Later
software and evidence sections supersede only their stated combinations.
Not implemented requires an identified missing code path. Confirmed behavior
requires the exact combination and reproducible feature evidence described in the
policy. Community evidence can meet that standard without maintainer ownership.

### T8134 follow-up observations

This table supplements the historical R0-R3 rows and type 63 cells. It preserves
the original failures. Known hardware from R0 is T8134 firmware 3.3.6.0 with T8030
firmware 3.8.5.2. Later comments do not independently reconfirm those versions.

| Date and source  | Feature and outcome                                                                                                                                                 | Versions, route and limits                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-10, [R1] | Reported working: discovery, stored snapshots, battery, person events and recording video/audio after reinstall. Reported problems: live view and session recovery. | R0 hardware. Client, bridge and integration versions of the test are unconfirmed. No complete stop/reopen or recovery proof.                                         |
| 2026-09-11, [R4] | Known reported problem: remote live visualization still fails.                                                                                                      | Reporter identifies Cloudflare Tunnel. A 0.6.4 diagnostic test was requested, but the installed component versions are not explicitly confirmed in the comment.      |
| 2026-09-11, [R5] | Reported working: live video in the iOS app. Known reported problem: live audio is absent.                                                                          | Attempt was the previous night. Exact app/component versions and that attempt's route are unspecified. This cannot establish success on every local or remote route. |
| 2026-09-11, [R6] | Reporter confirms sound was enabled. Audio remains a known reported problem.                                                                                        | No cause or fix is established by this comment.                                                                                                                      |
| 2026-09-11, [R7] | Software delivery: bridge/integration 0.7.1 adds video-only JPEG fallback and diagnostics. Reporter retest requested.                                               | No subsequent T8134 result at this review. JPEG fallback carries no audio. Local-audio diagnostics and session recovery remain separate obligations.                 |

Unknown component versions stay unknown. These observations do not upgrade any
feature to confirmed behavior. [Camera-10], [#21], [#22] and [#56] retain their
respective investigation, software and validation obligations. Keep successful and
failed route observations together when processing a new report.

## Discovery relationship evidence, 0.5.0

[Story #17][#17] adds [typed discovery and per-device errors](DISCOVERY.md).
This supersedes the historical C0 whole-inventory rejection behavior below.
Exact recognized model/type pairs retain their identities when a parent is
unsupported. T8134 with an empty or self parent has a private standalone owner
and an explicit `standalone_transport_unverified` operation error. It creates
no HomeBase entity. Unknown pairs remain unadmitted with `unsupported_device`.
[Regression tests](../test/discovery.test.mjs) prove this software boundary.
The dated feature rows and hardware claims below remain unchanged. Other owner
protocols and standalone authentication remain with [#35] and [#36].

## eufyCam software evidence, 0.6.0

[Story #19][#19] adds exact discovery, state and event coverage for all twelve
catalogued eufyCam model/type pairs on the existing T8030 owner profile.
[Per-model feature evidence](EUFYCAM.md) and [regressions](../test/eufycam.test.mjs)
supersede the historical unimplemented discovery/state/event cells for those
exact tuples only. This is software evidence. No hardware cell changes.
T8111/T8112 availability remains unknown and wired T8600 battery is not applicable.
The original 0.6.0 media guard is superseded only by the profile below. Older owners,
unresolved suffixes and hardware acceptance remain with [#35], [#55], [E2] and [E6].

## eufyCam media evidence, 0.7.0

[Story #20][#20] adds [exact per-model media evidence](EUFYCAM.md#h3-core-media-070)
for the twelve eufyCam tuples above on the H3 local LAN-derived profile. The
new model guard also requires the documented owner firmware branch. Generic,
T8600 professional and T8172 outdoor pan/tilt live envelopes are separately
asserted. Snapshot, live video/audio forwarding, recordings and confirmed
stop/cancel have software fixtures. This supersedes the historical media B1/U
cells only for that exact profile. It assigns no new hardware evidence.
Unsupported firmware, models and topologies remain explicit. [#55], [#35],
[#36], [E2] and [E6] retain the remaining obligations.

## Exact T8213 hardware evidence, 2026-09-11

[Story #58][#58] records [dated hardware evidence][H58] for T8213 firmware
0.2.1.8 behind its actual T8030 firmware 3.8.6.0 on client 0.10.0 and
bridge/integration 0.7.1. Discovery, own reported state and battery, stored
snapshot, decoded live video/audio, confirmed stop, recording playback/seek,
in-flight cancellation, a real ring event and restart recovery are measured
separately. Other battery doorbell models retain the open obligations linked
from their rows. No firmware or owner variant inherits this acceptance.

## Battery doorbell software evidence, 0.8.0

[Story #25][#25] adds exact T8214/94, T8224/95 and T8223/96 discovery behind the
existing T8030 H3 owner. T8213/91 retains its existing route. All four select the
private battery doorbell adapter. [Per-model evidence](BATTERY_DOORBELLS.md) and
[regressions](../test/battery-doorbell.test.mjs) supersede the historical B1/U
state, battery, discovery and motion/person/ring cells for these exact H3 tuples
only. Available values are observations, never synthesized from connection state.
No hardware cell changes. The media profile below supersedes the 0.8.0 guard. Candidate
model/type 7/16 associations remain unadmitted. [#58], [#35], [#36] and [E2]
retain those evidence and owner obligations.

## Battery doorbell media evidence, 0.9.0

[Story #26][#26] adds [exact H3 media evidence](BATTERY_DOORBELLS.md#h3-core-media-090)
for T8214/94, T8224/95 and T8223/96 with the documented numeric T8030 owner
firmware branch. T8213/91 retains its existing route and gains regression coverage.
Separate E340 and generic C30/C31 live envelopes, stored snapshots, video/audio
forwarding, recording operations and acknowledged stop/cancel have software tests.
This supersedes historical B1/U media cells only for that exact profile. No H
cells change. [#58], [#35], [#36], [E2] and [E6] retain hardware, other owners,
standalone and candidate inventory obligations.

## SoloCam software evidence, 0.11.0

[Story #21][#21] adds [exact SoloCam discovery/state/event evidence](SOLOCAM.md)
for ten model/type pairs on the existing T8030 owner. The SoloCamera adapter,
observed values, correct owner/channel, native push decoding and duplicate
suppression have [per-model regressions](../test/solocam.test.mjs). T8134 retains
its existing media admission and dated community evidence. Other SoloCam media
remained guarded in 0.11.0. The 0.12.0 profile below supersedes that guard for its
exact connection scope. No hardware claim changes.

The updated SoloCam rows below evaluate H3 only. Standalone descriptors identify
the camera as owner but remain `standalone_transport_unverified`, without a
station or operation path. [#36] retains transport research, [#35] other owners
and [#56] hardware and unresolved model variants. T8124V/R remain unadmitted.
[Camera-10] retains the original reporter investigation and requested retest.

## SoloCam media evidence, 0.12.0

[Story #22][#22] extends the existing H3 media admission to the nine additional
exact SoloCam pairs in [Solo-software]. T8134 retains its established path.
Existing SoloCam and pan/tilt command envelopes, snapshots, separate video/audio
streams, recordings and confirmed stop/cancel have per-model software coverage.
No new adapter or wire implementation is added. The added profiles use the same
conservative numeric owner firmware admission as other additional-H3 cameras.

This supersedes the 0.11.0 media restriction only for that exact H3 profile.
The nine updated rows mark software evidence, not hardware confirmation.
T8134 reporter cells and dated follow-up observations are preserved. [#56],
[Camera-10], [#35] and [#36] retain hardware, recovery, other-owner and standalone
obligations. Software audio forwarding is not proof that the reporter's missing
audio is resolved.

## Source boundary and reading rules

The catalogue is `DeviceType` in [vendor/src/http/types.ts][Catalogue] at client
commit `e69624d79cd43e810a216602cc39eff70a27d046`. The complete file SHA-256 is
`9b14b5e1f89b97131eb3009f6090c8671992f3c84a3ed499ccdc9d97101c1479`.
Its attributed upstream is bropat/eufy-security-client 4.1.1-1,
commit `d75e7996d4cbce3839a6075bed95b752ccc3ee43`, under MIT, as recorded in
[NOTICE.md](../NOTICE.md). Protocol types are numeric Eufy identifiers, not network
transport versions. Do not infer wire compatibility from a shared product name.

All 96 enum entries are accounted for below. Camera rows include integrated
products and unresolved candidates. The owner and exclusion tables account for
the rest. The check compares exact names and numeric values, not just a count.
`Device.isCamera()` alone is insufficient. In this revision it omits
`LOCK_8530`, `LOCK_8531`, `CAMERA_GUN`, `CAMERA_SNAIL` and
`INDOOR_PT_CAMERA_C220_V3`. The first two are camera-bearing products in Eufy's
primary documentation. The other three stay unresolved rather than disappearing.

The original four recognized camera models, the twelve exact eufyCam pairs
and the three additional battery doorbell pairs listed above have discovery software evidence. Other model/type associations
remain catalogue associations for investigation. New fixture admission is not an
observation from a Mega hardware inventory. Eufy's
pages establish product names and possible product topologies, not numeric
protocol types or this client's implementation. A candidate, regional suffix or
bundle code must be resolved with sanitized inventory before enabling it.
Unknown marketing names remain unknown. Family names here assign engineering
ownership. Outdoor wired cameras follow the existing indoor protocol family.

## Topology inventory

| Code           | Product topology and current client boundary                                                                                                   | Evidence and obligation                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| H3             | Camera paired with T8030 HomeBase 3, S380. Only the local LAN-derived credential path is implemented. Host networking was observed.            | [C0], [H0]. Other network/encryption profiles remain with [#17], [#18], [E2], [E6].                                                  |
| H1/E/2         | HomeBase 1, HomeBase E or HomeBase 2 as the connection owner. Model and firmware matter.                                                       | [HB-old], [HB-guide]. Not admitted by the current client. [#35], [#17], [E2], [E6].                                                  |
| HM             | HomeBase Mini, T8025, as a possible owner. This is not MiniBase Chime T8023.                                                                   | [Catalogue], [Display], [HB-guide]. Conflicting regional tables and exact revisions need [#35]. All features remain with [E2], [E6]. |
| W              | Standalone Wi-Fi camera with its own transport/storage owner. Optional HomeBase storage does not prove HomeBase command ownership.             | Product sources per row. A T8134 standalone descriptor is implemented. Transport is unverified. [#36], [#17], [E2], [E6].            |
| L              | Cellular connection. T86P2 also has a distinct Wi-Fi mode. Do not project Wi-Fi evidence onto LTE.                                             | [HB3], [HB-guide]. Route, credentials and media remain unknown. [#37], [E2], [E6].                                                   |
| N              | PoE camera connected directly or through a PoE switch to an NVR.                                                                               | [NVR-setup]. [NVR-HB] explicitly excludes HomeBase 2/3. [#38], [E2], [E6].                                                           |
| Chime / bridge | A Wi-Fi Chime, MiniBase Chime or Wi-Fi bridge may own a device connection. A chime used only for sound is not necessarily its transport owner. | [HB-old], [Lock-setup]. Exact relationships remain with [#35], [#36], [#17], [E2], [E6].                                             |
| Unknown        | Neither the model association nor connection owner is established.                                                                             | Preserve the row under [E2], [E6] and its family/research obligation.                                                                |

H3 product compatibility can mean storage only. [HB3] separates storage from AI.
It does not prove the Mega command route. It excludes original T8420 but lists a
T8420X variant. Keep that distinction without publishing device identifiers.
[Eufy's SoloCam comparison][Solo] still says several SoloCams cannot use H3,
while [HB3] lists them. [Solo-FAQ] says T8134 supports only H3, whereas
[HB-guide] also lists H2 and HM. [HB-old] excludes older HomeBases for T8160 and
T8161, while [HB-guide] lists H2. The English and [German guide][HB-DE] disagree
on Mini support for C210/C220. These are source conflicts, not client failures.
H2/HM claims in those rows remain candidates pending model/firmware evidence.

The primary [HomeBase Professional S1 list][HB-Pro] also names T9000, an owner
absent from the pinned enum. Its possible camera relationships are retained as
an explicit [E2] owner-discovery obligation via [#17] and hardware obligation in
[E6]. Do not map it to `STATION` or H3 without evidence. The optional NVR Wi-Fi
module is described as forthcoming by [NVR-WiFi]. Its availability, owner and
transport remain unknown under [#38]. Neither case enlarges this story into
protocol implementation.

## Wired inventory recognition, 0.12.0

The four exact wired pairs in [Wired-software] now retain received inventory
state and standalone identity. H3 and foreign owners are rejected. The existing
[#27], [#28] and [#36] obligations remain open for live state, event routing,
authentication and media. No wired transport or hardware support is claimed.

## Catalogue rows

`R` means the public client recognizes the exact unsuffixed model through its
allowlist, with [S1] or [H0] evidence. `C` means catalogue-only recognition.
Neither is a hardware claim. Firmware is unknown unless listed in the dated
evidence section. Every row also has a separate feature row below.

| Protocol type | Enum                                   | Model number or unresolved association       | Primary marketing names                                                       | Family     | Possible topology                           | Identity/topology sources                    | Recognition |
| ------------- | -------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- | ---------- | ------------------------------------------- | -------------------------------------------- | ----------- |
| 1             | `CAMERA`                               | T8111                                        | eufyCam                                                                       | cam        | H3, H1/E/2                                  | [Display], [HB-old]                          | C           |
| 3             | `FLOODLIGHT`                           | T8420 / T8420X                               | Floodlight Cam 1080p                                                          | flood      | W, H3 only for X variant                    | [Flood], [HB3]                               | C           |
| 4             | `CAMERA_E`                             | T8112                                        | eufyCam E                                                                     | cam        | H3, H1/E/2                                  | [Cam], [HB-old]                              | C           |
| 5             | `DOORBELL`                             | T8200 / T8201 / T8202                        | Video Doorbell 2K / 1080p / 2K Pro, wired                                     | wired      | W. H3 excluded                              | [HB3]                                        | C           |
| 7             | `BATTERY_DOORBELL`                     | T8210 / T8212 candidates                     | Video Doorbell 2K / S220 / S210                                               | battery    | H3, H1/E/2, chime variant unresolved        | [HB3], [HB-old], [HB-guide]                  | C           |
| 8             | `CAMERA2C`                             | T8113                                        | eufyCam 2C                                                                    | cam        | H3, H1/E/2, HM candidate                    | [Cam], [HB-old], [HB-guide]                  | C           |
| 9             | `CAMERA2`                              | T8114                                        | eufyCam 2                                                                     | cam        | H3, H1/E/2                                  | [Cam], [HB-old]                              | C           |
| 14            | `CAMERA2_PRO`                          | T8140                                        | eufyCam 2 Pro                                                                 | cam        | H3, H1/E/2, HM candidate                    | [Cam], [HB-old], [HB-guide]                  | C           |
| 15            | `CAMERA2C_PRO`                         | T8142. T8142R variant unresolved             | eufyCam 2C Pro / eufyCam S220                                                 | cam        | H3, H1/E/2. HM for R candidate              | [Cam], [S220-Cam], [HB-guide]                | R           |
| 16            | `BATTERY_DOORBELL_2`                   | T8220 / T8221 / T8222 candidates             | Video Doorbell Slim / 2E / C210, 1080p                                        | battery    | H3, H1/E/2, chime variant unresolved        | [HB3], [HB-old], [HB-guide]                  | C           |
| 19            | `CAMERA3`                              | T8160                                        | eufyCam 3 / S330                                                              | cam        | H3. HM, H2 disputed                         | [Cam], [Tracking], [HB-guide]                | R           |
| 23            | `CAMERA3C`                             | T8161                                        | eufyCam 3C / S300                                                             | cam        | H3. H2 disputed                             | [Cam], [Tracking], [HB-guide]                | C           |
| 24            | `PROFESSIONAL_247`                     | T8600                                        | eufyCam E330 Professional                                                     | cam        | H3, HM candidate. W is not established here | [Display], [HB-guide]                        | C           |
| 26            | `CAMERA3_PRO`                          | T8162                                        | eufyCam S3 Pro                                                                | cam        | H3, HM/H2 candidates                        | [Display], [HB-guide]                        | C           |
| 30            | `INDOOR_CAMERA`                        | T8400                                        | Indoor Cam 2K / C120                                                          | indoor     | W, H3                                       | [Indoor], [HB-guide]                         | R           |
| 31            | `INDOOR_PT_CAMERA`                     | T8410. T8410C variant unresolved             | Indoor Cam 2K Pan & Tilt / E220                                               | indoor     | W, H3                                       | [Indoor], [HB-guide]                         | R           |
| 32            | `SOLO_CAMERA`                          | T8130                                        | SoloCam E20                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                    | C           |
| 33            | `SOLO_CAMERA_PRO`                      | T8131                                        | SoloCam E40                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                    | C           |
| 34            | `INDOOR_CAMERA_1080`                   | T8401                                        | Indoor Cam 1080p                                                              | indoor     | W, H3                                       | [Indoor], [HB3]                              | R           |
| 35            | `INDOOR_PT_CAMERA_1080`                | T8411                                        | Indoor Cam 1080p Pan & Tilt / E210                                            | indoor     | W, H3                                       | [Indoor], [HB-guide]                         | R           |
| 37            | `FLOODLIGHT_CAMERA_8422`               | T8422                                        | Floodlight Cam E 2K / E220                                                    | flood      | W, H3 storage only in HB3 source            | [Flood], [Display], [HB3]                    | C           |
| 38            | `FLOODLIGHT_CAMERA_8423`               | T8423                                        | Floodlight Cam 2 Pro / 2K Pro / S330                                          | flood      | W, H3                                       | [Flood], [Display], [HB3]                    | C           |
| 39            | `FLOODLIGHT_CAMERA_8424`               | T8424                                        | Floodlight Cam 2K / E221                                                      | flood      | W, H3 storage only in HB3 source            | [Flood], [Display], [HB3]                    | C           |
| 44            | `INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT` | T8440 candidate                              | OutdoorCam E                                                                  | indoor     | W. H3 unresolved for this variant           | [Display], [Predicates]                      | C           |
| 45            | `INDOOR_OUTDOOR_CAMERA_2K`             | T8441                                        | Outdoor Cam Pro / C24                                                         | indoor     | W, H3, HM candidate                         | [Display], [HB-guide]                        | R           |
| 46            | `INDOOR_OUTDOOR_CAMERA_1080P`          | T8442                                        | Outdoor Cam / C22                                                             | indoor     | W, H3, HM candidate                         | [Display], [HB-guide]                        | R           |
| 47            | `FLOODLIGHT_CAMERA_8425`               | T8425                                        | Floodlight Cam E340                                                           | flood      | W, H3, HM candidate                         | [HB3], [HB-guide]                            | C           |
| 48            | `OUTDOOR_PT_CAMERA`                    | T8170                                        | SoloCam S340                                                                  | solo       | W, H3. H2/HM candidates                     | [Display], [HB-guide]                        | C           |
| 49            | `CAMERA_E40`                           | T8144                                        | eufyCam E40                                                                   | cam        | H3, H2, HM candidates                       | [Catalogue], [Display], [HB-guide]           | C           |
| 55            | `LOCK_8530`                            | T8530                                        | Video Smart Lock S330                                                         | integrated | Wi-Fi bridge, H3                            | [Lock-S330], [Lock-setup], [HB-guide]        | C           |
| 60            | `SOLO_CAMERA_SPOTLIGHT_1080`           | T8122                                        | SoloCam L20                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                    | C           |
| 61            | `SOLO_CAMERA_SPOTLIGHT_2K`             | T8123                                        | SoloCam L40                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                    | C           |
| 62            | `SOLO_CAMERA_SPOTLIGHT_SOLAR`          | T8124, T8124V/R variants unresolved          | SoloCam S40 / S230                                                            | solo       | W, H3. HM candidate                         | [Solo], [HB3], [Display], [HB-guide]         | C           |
| 63            | `SOLO_CAMERA_SOLAR`                    | T8134                                        | SoloCam S220                                                                  | solo       | W, H3. H2/HM disputed                       | [S220-Solo], [Solo-FAQ], [HB-guide]          | R           |
| 64            | `SOLO_CAMERA_C210`                     | T8B00                                        | SoloCam C210                                                                  | solo       | W candidate, H3, HM candidate               | [Display], [HB-guide]                        | C           |
| 87            | `FLOODLIGHT_CAMERA_8426`               | T8426                                        | Floodlight Cam E30                                                            | flood      | W candidate, H3, HM candidate               | [Catalogue], [HB3], [HB-guide]               | C           |
| 88            | `SOLO_CAMERA_E30`                      | T8171                                        | SoloCam E30                                                                   | solo       | W candidate, H3, H2, HM candidate           | [Catalogue], [HB-old], [HB-guide]            | C           |
| 89            | `CAMERA_S4`                            | T8172                                        | eufyCam S4                                                                    | cam        | H3                                          | [S4], [HB-guide]                             | C           |
| 90            | `SMART_DROP`                           | T8790                                        | SmartDrop, parcel box with camera                                             | integrated | W candidate, H3. H2/HM candidates           | [Display], [HB3], [HB-guide]                 | C           |
| 91            | `BATTERY_DOORBELL_PLUS`                | T8213                                        | Video Doorbell Dual / S330, battery                                           | battery    | H3, H1/E/2, HM candidate                    | [HB-old], [HB-guide]                         | R           |
| 93            | `DOORBELL_SOLO`                        | T8203                                        | Video Doorbell Dual / S330, wired                                             | wired      | W. H3 excluded                              | [HB3], [HB-guide]                            | C           |
| 94            | `BATTERY_DOORBELL_PLUS_E340`           | T8214                                        | Video Doorbell E340                                                           | battery    | W candidate, H3, H2/HM candidates           | [HB3], [HB-guide]                            | C           |
| 95            | `BATTERY_DOORBELL_C30`                 | T8224                                        | Video Doorbell C30                                                            | battery    | W candidate, H3, H2/HM candidates           | [HB3], [HB-guide]                            | C           |
| 96            | `BATTERY_DOORBELL_C31`                 | T8223                                        | Video Doorbell C31                                                            | battery    | W candidate, H3, H2/HM candidates           | [HB3], [HB-guide]                            | C           |
| 98            | `SOLOCAM_E42`                          | T8173                                        | SoloCam E42                                                                   | solo       | W candidate, H3, H2 candidate               | [Catalogue], [Display], [HB-guide]           | C           |
| 100           | `INDOOR_COST_DOWN_CAMERA`              | T8414                                        | Indoor Cam Mini 2K / Solo IndoorCam P44                                       | indoor     | W, H3. HM candidate                         | [Indoor], [Display], [HB-guide]              | R           |
| 101           | `CAMERA_GUN`                           | Unknown                                      | Unresolved catalogue label. No verified marketing name                        | unresolved | Unknown                                     | [Catalogue]                                  | C           |
| 102           | `CAMERA_SNAIL`                         | Unknown                                      | Unresolved catalogue label. No verified marketing name                        | unresolved | Unknown                                     | [Catalogue]                                  | C           |
| 104           | `INDOOR_PT_CAMERA_S350`                | T8416                                        | Indoor Cam S350                                                               | indoor     | W candidate, H3, HM candidate               | [Display], [HB-guide]                        | R           |
| 105           | `INDOOR_PT_CAMERA_E30`                 | T8417                                        | Indoor Cam E30                                                                | indoor     | W candidate, H3, HM candidate               | [Display], [HB-guide]                        | R           |
| 110           | `CAMERA_FG`                            | T8150. T8151/2/3 regional mapping unresolved | 4G Starlight Cam / S230. T8153 name unverified                                | lte        | L. H3 excluded for LTE-only models          | [Catalogue], [Predicates], [HB3], [HB-guide] | C           |
| 111           | `CAMERA_4G_S330`                       | T86P2                                        | 4G LTE Cam S330 / 4G & Wi-Fi Spotlight Cam                                    | lte        | L, W, H3 in Wi-Fi mode. HM candidate        | [Catalogue], [HB3], [HB-guide]               | C           |
| 131           | `CAMERA_GARAGE_T8453_COMMON`           | T8453 candidate                              | Garage-Control Cam Plus / Solo Garage Cam C24. Common-type mapping unresolved | garage     | W candidate. H3 under evaluation            | [Catalogue], [Display], [HB3]                | C           |
| 132           | `CAMERA_GARAGE_T8452`                  | T8452                                        | Garage-Control Cam / Solo Garage Cam C22                                      | garage     | W candidate. H3 under evaluation            | [Catalogue], [Display], [HB3]                | C           |
| 133           | `CAMERA_GARAGE_T8453`                  | T8453                                        | Garage-Control Cam Plus / Solo Garage Cam C24                                 | garage     | W candidate. H3 under evaluation            | [Catalogue], [Display], [HB3]                | C           |
| 151           | `WALL_LIGHT_CAM`                       | T84A1                                        | Wired Wall Light Cam S100                                                     | wall       | W candidate, H3 storage. AI unresolved      | [Display], [HB3], [HB-guide]                 | C           |
| 189           | `LOCK_8531`                            | T8531                                        | Video Smart Lock E330                                                         | integrated | W candidate, H3, HM candidate               | [HB-guide]                                   | C           |
| 203           | `LOCK_85V0`                            | T85V0. E85V0 bundle mapping unresolved       | FamiLock S3 Max / S3                                                          | integrated | W candidate, H3, HM variant candidate       | [HB-guide], [Display]                        | C           |
| 301           | `CAMERA_POE_S4`                        | T8E00                                        | PoE Cam S4 / Bullet-PTZ Cam                                                   | nvr        | N. H2/H3 excluded                           | [NVR-setup], [NVR-HB], [Display]             | C           |
| 10005         | `WALL_LIGHT_CAM_81A0`                  | T81A0                                        | Solar Wall Light Cam S120                                                     | wall       | W candidate, H3, HM candidate               | [Catalogue], [Display], [HB-guide]           | C           |
| 10008         | `INDOOR_PT_CAMERA_C220`                | T8W11C candidate                             | Indoor Cam C220. Subtype mapping unresolved                                   | indoor     | W candidate, H3. HM disputed                | [Catalogue], [Display], [HB-guide], [HB-DE]  | C           |
| 10009         | `INDOOR_PT_CAMERA_C210`                | T8419 / T8W11P candidate                     | Indoor Cam C210. T8W11P alias unverified                                      | indoor     | W candidate, H3. HM disputed                | [Catalogue], [Display], [HB-guide], [HB-DE]  | C           |
| 10010         | `INDOOR_PT_CAMERA_C220_V2`             | T8W11C candidate                             | Indoor Cam C220. V2 mapping unresolved                                        | indoor     | W candidate, H3. HM disputed                | [Catalogue], [Display], [HB-guide], [HB-DE]  | C           |
| 10011         | `INDOOR_PT_CAMERA_C220_V3`             | T8419N per catalogue only                    | Unresolved C220 V3 label. No primary model-name confirmation                  | indoor     | Unknown. Do not inherit C210/C220 topology  | [Catalogue]                                  | C           |
| 10035         | `CAMERA_C35`                           | T8110                                        | eufyCam C35                                                                   | cam        | H3, HM candidate. W unresolved              | [Catalogue], [Display], [HB-guide]           | C           |

The C210/C220 subtypes deliberately remain separate. Eufy's display list and
HomeBase guide confirm product names, but not the enum's variant numbering.
The catalogue comment for 10011 says T8419N, while the primary guide lists
T8418N under C220. There is no basis here to correct the enum or merge the rows.
`CAMERA_GARAGE_T8453_COMMON` likewise is not proof of a separate retail model.
Battery-doorbell model sets are candidate associations to the two generic enum
branches. Their exact inventory types remain a [#25] obligation.

## Core features by protocol type

Each cell describes this client on the row's stated topology, not what the Eufy
app can do. Non-H3 topologies never inherit the H3 result. The eight feature columns
are independent. Stored snapshots are previously stored cover images, not a
new exposure or event-specific image.

| Code | Meaning                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H    | Historical hardware observation in [H0] on the exact tuple below. It does not establish current health, every firmware or every event type.                                                                                                      |
| P    | Partial reporter success in [R1], on [R0]'s tuple. Installed versions and full lifecycle checks remain unconfirmed.                                                                                                                              |
| X    | Experimental software path only, including the exact H3 rows in [Solo-software]. [C0] and [Adapter] expose the function. [Discovery-tests] checks S220 discovery. [S1] checks its live command selection. No full per-model hardware acceptance. |
| F    | Reported failure in [R1]. [R2] separately reports reproduced consumer defects. The cause of the hardware black screen is not yet confirmed by retest.                                                                                            |
| B1/U | Proven client entry barrier: model absent from the allowlist in [C0]. Underlying feature behavior is unknown, not proven impossible.                                                                                                             |
| B2/U | Proven client owner barrier: a recognized camera requires a discovered T8030 parent in [C0]. Behavior on other owners is unknown.                                                                                                                |
| U    | Unknown or no sufficiently specific observation. An enum or generic test cannot turn U into H.                                                                                                                                                   |
| N/A  | No camera function on an owner-only device. This does not exclude its station status or recording ownership.                                                                                                                                     |

For R rows, H3 results apply only to the exact model stated in the evidence
column. Candidate suffixes remain B1/U. For C rows, B1/U applies to every listed
topology. State covers available identity, firmware and availability. Battery is
shown separately. Discovery initially returns battery null. The adapter reads a
valid observed percentage or leaves it null. No battery lifetime claim is made.

| Type  | Model / evaluated topology                           | Discovery | Available state     | Battery   | Stored snapshot | Live video | Live audio | Events          | Recordings    | Evidence                                            | Remaining work                    |
| ----- | ---------------------------------------------------- | --------- | ------------------- | --------- | --------------- | ---------- | ---------- | --------------- | ------------- | --------------------------------------------------- | --------------------------------- |
| 1     | T8111 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#96]                             |
| 3     | T8420 / T8420X / listed topologies                   | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]         |
| 4     | T8112 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#97]                             |
| 5     | T8200 / T8201 / T8202 / standalone inventory only    | X         | X inventory         | N/A       | B2/U            | B2/U       | B2/U       | B2/U            | B2/U          | [Wired-software], [Catalogue]                       | [#27], [#28], [#36], [#59]        |
| 7     | T8210 / T8212 candidates / listed topologies         | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#108], [#109]                    |
| 8     | T8113 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#98]                             |
| 9     | T8114 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#99]                             |
| 14    | T8140 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#100]                            |
| 15    | T8142 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [S1], [C0]                                          | [#101]                            |
| 16    | T8220 / T8221 / T8222 candidates / listed topologies | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#110], [#111], [#112]            |
| 19    | T8160 / H3 only                                      | H         | H                   | H         | H               | H          | H          | H person        | H             | [H55], [H0], [C0]                                   | [#19], [#20], [#55]               |
| 23    | T8161 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#102]                            |
| 24    | T8600 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#103]                            |
| 26    | T8162 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#104]                            |
| 30    | T8400 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 31    | T8410 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 32    | T8130 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 33    | T8131 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 34    | T8401 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 35    | T8411 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 37    | T8422 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]         |
| 38    | T8423 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]         |
| 39    | T8424 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#29], [#30], [E2], [#60]         |
| 44    | T8440 candidate / listed topologies                  | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]               |
| 45    | T8441 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 46    | T8442 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 47    | T8425 / H3 only                                      | X         | X                   | N/A       | X               | X          | X          | X               | X             | [Floodlight-software], [Catalogue]                  | [#29], [#30], [#60]               |
| 48    | T8170 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 49    | T8144 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#105]                            |
| 55    | T8530 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#39], [E2], [E6]                 |
| 60    | T8122 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 61    | T8123 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 62    | T8124 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 63    | T8134 / H3 only                                      | P         | P identity          | P reading | P               | F          | U          | P person        | P video/audio | [R0], [R1], [R2], [R3], [S1], [C0], [Solo-software] | [#35], [#36], [#56], [Camera-10]  |
| 64    | T8B00 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 87    | T8426 / H3 only                                      | X         | X                   | N/A       | X               | X          | X          | X               | X             | [Floodlight-software], [Catalogue]                  | [#29], [#30], [#60]               |
| 88    | T8171 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 89    | T8172 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#106]                            |
| 90    | T8790 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#39], [E2], [E6]                 |
| 91    | T8213 / H3 only                                      | H         | H                   | H         | H               | H          | H          | H ring          | H             | [H58], [H0], [C0]                                   | [#25], [#26], [#58]               |
| 93    | T8203 / standalone inventory only                    | X         | X inventory         | N/A       | B2/U            | B2/U       | B2/U       | B2/U            | B2/U          | [Wired-software], [Catalogue]                       | [#27], [#28], [#36], [#59]        |
| 94    | T8214 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#113]                            |
| 95    | T8224 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#114]                            |
| 96    | T8223 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#115]                            |
| 98    | T8173 / H3 only                                      | X         | X                   | X         | X               | X          | X          | X               | X             | [Solo-software], [Catalogue]                        | [#35], [#36], [#56]               |
| 100   | T8414 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 101   | Unknown / listed topologies                          | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#39], [E2], [E6]                 |
| 102   | Unknown / listed topologies                          | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#39], [E2], [E6]                 |
| 104   | T8416 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 105   | T8417 / actual H3 owner only                         | X         | X identity/firmware | U         | X               | X          | X          | X motion/person | X             | [Indoor-software], [Catalogue]                      | [#23], [#24], [#35], [#36], [#57] |
| 110   | T8150 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#37], [E2], [E6]                 |
| 111   | T86P2 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#37], [E2], [E6]                 |
| 131   | T8453 candidate / listed topologies                  | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#33], [#34], [#62]               |
| 132   | T8452 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#33], [#34], [#62]               |
| 133   | T8453 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#33], [#34], [#62]               |
| 151   | T84A1 / H3 state and events, W descriptor            | X         | X                   | U         | U               | U          | U          | X               | U             | [Wall-software], [Catalogue]                        | [#32], [#35], [#36], [#61]        |
| 189   | T8531 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#39], [E2], [E6]                 |
| 203   | T85V0 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#39], [E2], [E6]                 |
| 301   | T8E00 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#38], [E2], [E6]                 |
| 10005 | T81A0 / H3 media, W descriptor                       | X         | X                   | X         | X               | X          | X          | X               | X             | [Wall-software], [Catalogue]                        | [#32], [#35], [#36], [#61]        |
| 10008 | T8W11C candidate / listed topologies                 | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]               |
| 10009 | T8419 / T8W11P candidate / listed topologies         | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]               |
| 10010 | T8W11C candidate / listed topologies                 | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]               |
| 10011 | T8419N per catalogue only / listed topologies        | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#23], [#24], [#57]               |
| 10035 | T8110 / listed topologies                            | B1/U      | B1/U                | B1/U      | B1/U            | B1/U       | B1/U       | B1/U            | B1/U          | [C0], [Catalogue]                                   | [#19], [#20], [#55]               |

For the four R rows, evaluate every listed non-H3 topology as B2/U for each of
discovery, state, battery, snapshot, live video, live audio, events and recordings.
Their separate owner obligations are [#17], [#35], [#36] and [E6]. The H3
implementation explicitly uses local-only P2P and LAN-derived credentials.
Routed LAN/VLAN, remote relay, stronger cipher modes and legacy-cloud credential
retrieval are not established by H. [C0] rejects unavailable credential paths.
These are implementation boundaries, not proof that a product cannot use them.

For T8142, X in the media/state/event columns denotes reachable shared code,
not eight passing model-specific fixture suites. [Discovery-tests] proves the
allowlist/parent rules. [S1] checks the existing live command choice. T8142 uses
`CMD_SET_PAYLOAD`, T8134 uses `CMD_DOORBELL_SET_PAYLOAD` in that test.
The adapter currently instantiates generic `Camera` for both and
`BatteryDoorbellCamera` for T8213 and the three exact pairs in the 0.8.0 section. It does not yet instantiate a new SoloCam
family factory. That obligation remains [#21].

For excluded models, available vendor predicates, properties or command tables
are protocol leads only. They are not experimental public-client coverage.
Battery-less products also say B1/U because their current client status route is
unreachable. Do not read that as a claim that a mains-powered product has a battery.

For T8425/47 and T8426/87, [Floodlight-software] defines the exact experimental
H3 profile. Available state covers identity and observed firmware. Battery is
not applicable, and availability remains unknown because the attributed model
properties have no such field. Standalone recognition retains an explicit
transport blocker and does not inherit H3 media or event coverage. Other owners
remain blocked. T8420/X, T8422, T8423 and T8424 retain their entry barriers.
H3 storage compatibility alone does not establish command ownership. [E2]
retains that model work after scoped software acceptance of [#29]/[#30].

## Dated device evidence and failures

| Evidence                   | Date, software and hardware tuple                                                                                                                                                                                                  | Positive observations                                                                                                                                                                                                                                                                                           | Limits and owner                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0 baseline                | 2026-09-09 to 2026-09-10. Client 0.1.0-dev.8 on isolated HA, then 0.1.0 with audio timing fix on production. T8030 firmware 3.8.6.0, three T8160 firmware 3.4.3.0, one T8213 firmware 0.2.1.8. H3 local LAN, exclusive controller. | Authentication/discovery, available state, stored snapshots, live video/audio and confirmed STOP. Recording history, playback, seek and cancel. Real person and doorbell events. A short battery observation exists, but the summary does not assign it to each model. Per-model battery proof remains unknown. | [H0] records the acceptance. Overnight idle evidence preceded the active-stream timing fix and covered 11h26m, not 24h. Event counts are installation-wide. Non-person motion was disabled. [#55], [#58], [E6] retain untested variants. |
| H55 exact T8160 validation | 2026-09-11. Client 0.10.0, bridge/integration 0.7.1, HA 2026.9.1. One T8160 firmware 3.4.3.0 behind its actual T8030 firmware 3.8.6.0. H3 local LAN, exclusive controller.                                                         | Discovery, reported online state and battery 75 percent, stored snapshot, decoded live video/audio, stop, recording playback/seek, real HA person event, UI cancellation after 4109027 bytes with confirmed device stop, and restart recovery.                                                                  | [H55] provides separate measured results and test limits. Existing identities and configuration preserved. Other models, firmware and owners remain tracked. No family-wide or speaker-listening claim.                                  |
| H1 upgrade observation     | 2026-09-10. Client 0.1.1 and bridge/integration 0.6.2 on the existing T8030/T8160/T8213 installation.                                                                                                                              | Identity preservation, HomeBase/push recovery, stored snapshots and live JPEG frames for all four cameras, clean stream shutdown.                                                                                                                                                                               | [H1] is the public dated summary. Private deployment notes confirm audio and recordings were not physically repeated in this upgrade. H1 does not extend H0's audio/recording acceptance to a fresh 0.1.1 hardware test.                 |
| R0 reporter tuple          | 2026-09-10 10:38 UTC. Four T8134 firmware 3.3.6.0 paired with T8030 firmware 3.8.5.2.                                                                                                                                              | Exact model and parent supplied by reporter.                                                                                                                                                                                                                                                                    | [R0]. Exact installed client, bridge and integration versions for the later test remain unconfirmed. Do not infer local-only transport from pairing alone.                                                                               |
| R1 partial successes       | 2026-09-10 13:07 UTC, reporter's R0 installation after reinstallation.                                                                                                                                                             | Discovery/import, last stored snapshot, displayed battery, person event, recording playback with video and audio.                                                                                                                                                                                               | [R1]. Restart persistence, all-camera coverage, battery updates, recording seek/cancel and live stop/reopen not individually confirmed. Original [camera issue #10][Camera-10] owns remaining investigation and validation.              |
| R1 live failure            | Same report and tuple.                                                                                                                                                                                                             | None for live viewing. Black view followed by automatic closure.                                                                                                                                                                                                                                                | [R1]. Internal go2rtc codec warning is not proof of the camera's native RTSP support or a confirmed root cause. Live audio is U, not a passed test and not independently diagnosed as absent.                                            |
| R1 recovery failure        | Same report, after an unspecified settings change.                                                                                                                                                                                 | Reinstallation recovered discovery.                                                                                                                                                                                                                                                                             | [R1]. Repeating session restore failure reported. Setting, client platform and exact versions are still requested. This is separate from live video.                                                                                     |
| R2 maintainer reproduction | 2026-09-10 13:52 UTC, software report in the original issue.                                                                                                                                                                       | Maintainer reports reproducing audio conversion requested for video-only streams and restore retries blocking corrected login. Reports 60 bridge and 80 HA tests passing on prepared local fixes.                                                                                                               | [R2]. Fixes were described as unreleased in that comment. This is software evidence, not a successful T8134 retest. [R3] records subsequent delivery. This matrix story changes neither defect.                                          |
| R3 delivered fixes         | 2026-09-10 14:13 UTC, maintainer update. Bridge/integration 0.6.3.                                                                                                                                                                 | [R3] announces the fixes and reports T8160/T8213 stored snapshots, live frames, audio metadata, stream cleanup and preserved entities.                                                                                                                                                                          | Audio metadata is not audible playback. No T8134 retest result was posted at this review. Live and recovery validation remain owned by [camera issue #10][Camera-10].                                                                    |
| R2 event semantics         | Same maintainer response.                                                                                                                                                                                                          | The HA event entity retains the last event.                                                                                                                                                                                                                                                                     | [R2] explains why it does not reset to Idle like a motion sensor. The reporter's request is not a proven regression. No inference about event duration or a binary motion state.                                                         |

H cells preserve documented baseline observations. A stored frame, command enum,
mock response, HTTP success or sent STOP alone cannot establish live media or
physical completion. Generic [live tests][Live-tests], [recording tests][Recording-tests],
[event tests][Event-tests] and [protocol lifecycle tests][Lifecycle-tests] cover
software contracts, not another model/firmware/topology tuple.

## Synthetic family regression evidence

[Family fixtures](FAMILY_FIXTURES.md), delivered by [#18], cover each recorded
family at its existing admission boundary. They distinguish public discovery
and H3 lifecycle checks from isolated vendor command selection and unsupported
model rejection. Synthetic firmware cases exercise the existing command branch.
They do not upgrade any feature cell or establish hardware support. Per-row
implementation and hardware obligations below remain unchanged.

## Connection owners in the catalogue

These types remain visible in the accounting even though they are not camera
rows. Station status and media ownership remain in scope where applicable.

| Protocol type | Enum             | Owner model / primary name                                                              | Current evidence and remaining obligation                                                                                                                                                                            |
| ------------- | ---------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0             | `STATION`        | T8001 HomeBase, T8002 HomeBase E, T8010 HomeBase 2 candidates                           | [Display], [HB-old], [Catalogue]. Recognition is catalogue-only. All client functions B1/U. [#35], [#17], [E2], [E6].                                                                                                |
| 18            | `HB3`            | T8030 HomeBase 3 / S380                                                                 | [HB-guide], [H0], [H1], [C0]. Discovery and station availability historically observed. Battery and own camera media N/A. It owns the proven child-camera routes. Other firmware/network profiles remain [E2], [E6]. |
| 25            | `MINIBASE_CHIME` | T8023 MiniBase Chime candidate                                                          | [Display], [Catalogue]. Catalogue-only. All client functions B1/U. [#35], [#17], [E2], [E6].                                                                                                                         |
| 28            | `HOMEBASE_MINI`  | T8025 HomeBase Mini                                                                     | [Catalogue], [Display], [HB-guide]. Catalogue-only. All client functions B1/U. [#35], [#17], [E2], [E6].                                                                                                             |
| 300           | `NVR_S4_MAX`     | T8N00 NVR, catalogue S4 Max label. E8P10 is a system code, not an assumed device_model. | [Catalogue], [NVR-setup]. Catalogue-only. All client functions B1/U. [#38], [#17], [E2], [E6].                                                                                                                       |

T8020 Wi-Fi Chime and T8021 Wi-Fi Bridge appear in [Display] but have no dedicated
enum name here. Preserve their exact inventory-type question in [#35]/[#17].
Do not fabricate a HomeBase entity for a standalone device or sound-only chime.

## Explicit non-camera exclusions

These are exclusions from the camera matrix, not supported-product claims.
The pinned [predicates][Predicates] and property tables classify sensors,
keypads, non-video locks, safes and trackers. Video locks 55, 189 and 203 are
explicitly retained above despite uneven camera predicates. Future camera
variants require reclassification, not inheritance from this exclusion list.

| Protocol type | Enum                       | Reason                                                                             |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| 2             | `SENSOR`                   | Sensor branch in [Predicates], not a camera.                                       |
| 10            | `MOTION_SENSOR`            | Sensor branch in [Predicates], not a camera.                                       |
| 11            | `KEYPAD`                   | Keypad in [Predicates], not a camera.                                              |
| 20            | `WATER_FREEZE_SENSOR_8920` | Sensor branch in [Predicates], not a camera.                                       |
| 50            | `LOCK_BLE`                 | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 51            | `LOCK_WIFI`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 52            | `LOCK_BLE_NO_FINGER`       | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 53            | `LOCK_WIFI_NO_FINGER`      | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 54            | `LOCK_8503`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 56            | `LOCK_85A3`                | Lock keypad branch in [Predicates], not a video lock.                              |
| 57            | `LOCK_8592`                | Lock keypad branch in [Predicates], not a video lock.                              |
| 58            | `LOCK_8504`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 123           | `SIREN_SENSOR_E20`         | Sensor branch in [Predicates], not a camera.                                       |
| 126           | `ENTRY_SENSOR_E20`         | Sensor branch in [Predicates], not a camera.                                       |
| 127           | `PIR_SENSOR_E20`           | Sensor branch in [Predicates], not a camera.                                       |
| 140           | `SMART_SAFE_7400`          | Safe branch in [Predicates], not a camera.                                         |
| 141           | `SMART_SAFE_7401`          | Safe branch in [Predicates], not a camera.                                         |
| 142           | `SMART_SAFE_7402`          | Safe branch in [Predicates], not a camera.                                         |
| 143           | `SMART_SAFE_7403`          | Safe branch in [Predicates], not a camera.                                         |
| 157           | `SMART_TRACK_LINK`         | Tracker in [Catalogue], not a camera.                                              |
| 159           | `SMART_TRACK_CARD`         | Tracker in [Catalogue], not a camera.                                              |
| 180           | `LOCK_8502`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 184           | `LOCK_8506`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 202           | `LOCK_85D0`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 201           | `LOCK_85L0`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |
| 209           | `LOCK_85P0`                | Non-video lock branch in [Predicates]. No camera evidence in the pinned catalogue. |

## Open obligations and update procedure

Every missing core feature remains an [E2] obligation and every missing hardware
tuple remains an [E6] obligation under the [programme's completion gate][Programme].
The per-row family links distinguish discovery/state/events implementation from
snapshot/live/recording implementation and hardware acceptance. Family stories
cover one evidenced profile. Hardware stories #55 through #62 cover one exact
tuple each. Closing one cannot close all rows in that family.

For LTE, PoE/NVR, integrated products and unresolved catalogue labels, [#37],
[#38] and [#39] own bounded research. Their completion must link implementation
follow-ups before closing. [E2] retains all eight feature columns until delivered
or bounded by evidence. [E6] retains separate model, firmware, topology and
feature validation. Camera functions on locks, garages and SmartDrop do not
include unlocking, garage actuation or parcel controls.

No additional implementation story is needed for this inventory. Existing
stories plus the explicit E2/E6 obligations cover the gaps. If research exposes
an additional protocol, split a one- or two-day story before making it Ready.
The catalogued but unresolved labels 101, 102 and 10011 remain obligations.
New models visible in primary sources but absent from this pinned catalogue,
including PoE E40/E41 in [Display], require the same E2/E6 intake. Do not silently
add their product names to an existing numeric type.

To maintain this document:

1. Pin the client commit and catalogue file digest. Compare every enum entry,
   camera predicate and primary camera-bearing product. Keep exclusions explicit.
2. Record product-name and topology sources with a review date. Preserve conflicts
   and unknown subtype associations until sanitized inventory resolves them.
3. Add a separate row or evidence tuple when model, firmware or topology changes.
   Record discovery, state, battery, snapshot, live video, live audio, events and
   recordings separately. Include stop/cancel and observation duration.
4. Link code/tests for software evidence. Hardware evidence needs date, model,
   camera and owner firmware, client/consumer versions, topology, scenario and
   result. Keep private identifiers, keys, captures and images out of the record.
5. Link remaining implementation and hardware obligations before closing work.
   Re-read [camera issue #10][Camera-10] for T8134 changes. Preserve that issue's
   ownership and distinguish prepared fixes, delivered fixes and hardware retests.
6. Run `python3 scripts/check_model_matrix.py`, formatting and mandatory CI.
   The offline check detects omitted/duplicate enum rows, numeric drift, omitted
   feature columns, unbound references and missing local targets. Source truth
   and hardware attribution still require review. Do not run devices for a
   documentation update.

## Source register

Primary product pages were read on 2026-09-10. Their claims describe Eufy's own
products. They do not establish client hardware acceptance. Source conflicts
are recorded above. Code and baseline evidence links use the reviewed client
commit. GitHub discussion links retain their dated authorship.

Software evidence includes [the adapter][Adapter] and [discovery fixtures][Discovery-tests].
S1 alone is not the discovery test. Review both files for the exact assertion.

[Catalogue]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/vendor/src/http/types.ts#L14-L116
[Predicates]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/vendor/src/http/device.ts#L1880-L2632
[Cam]: https://service.eufy.com/article-description/Differences-Between-All-Add-on-eufyCams
[S220-Cam]: https://www.eufy.com/us/products/t81421d1
[S220-Solo]: https://service.eufy.com/article-description/Introducing-eufy-S220-SoloCam
[Solo-FAQ]: https://service.eufy.com/article-description/eufy-S220-SoloCam-FAQ
[Indoor]: https://service.eufy.com/article-description/Differences-Between-eufy-Indoor-Cams
[Flood]: https://service.eufy.com/article-description/Differences-Between-eufy-Floodlight-Cameras
[Solo]: https://service.eufy.com/article-description/Differences-Between-eufy-SoloCams
[Display]: https://service.eufy.com/article-description/Eufy-Smart-Display-E10-T87A0-Compatibility-List
[HB-old]: https://service.eufy.com/article-description/Compatibility-Between-eufy-Devices
[HB3]: https://service.eufy.com/article-description/S380-HomeBase-HomeBase-3-Compatibility
[HB-guide]: https://service.eufy.com/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide
[HB-DE]: https://service.eufy.com/de/article-description/eufy-Security-Vollst%C3%A4ndiger-Kompatibilit%C3%A4tsleitfaden-f%C3%BCr-HomeBase
[HB-Pro]: https://service.eufy.com/article-description/What-eufy-devices-are-compatible-with-HomeBase-Professional-S1
[Tracking]: https://service.eufy.com/article-description/Cross-Camera-Tracking-Function-Compatibility
[Lock-S330]: https://service.eufy.com/product-description/a085g000004xt7kAAA/video-smart-lock-s330
[Lock-setup]: https://service.eufy.com/article-description/How-to-set-up-the-Video-Smart-Lock
[S4]: https://service.eufy.com/article-description/T8172-eufyCam-S4-EU-Declaration
[NVR-setup]: https://service.eufy.com/article-description/How-do-I-set-up-my-PoE-NVR-Security-System
[NVR-HB]: https://service.eufy.com/article-description/Does-the-PoE-NVR-Security-System-work-with-HomeBase-2-and-HomeBase-3
[NVR-WiFi]: https://service.eufy.com/article-description/Can-the-PoE-NVR-Security-System-connect-to-cameras-wirelessly
[C0]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/src/client.ts
[Adapter]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/src/device-transport.ts
[S1]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/s220.test.mjs
[Discovery-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/cloud.test.mjs
[H0]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/docs/COMPATIBILITY.md
[H1]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5617635813
[R0]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5617291132
[R1]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5619177924
[R2]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5619797793
[Camera-10]: https://github.com/keesmod/ha-eufy-cam/issues/10
[Live-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/live.test.mjs
[Recording-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/recordings.test.mjs
[Event-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/events.test.mjs
[Lifecycle-tests]: https://github.com/keesmod/eufy-mega-client/blob/e69624d79cd43e810a216602cc39eff70a27d046/test/protocol-lifecycle.test.mjs
[Story]: https://github.com/keesmod/eufy-mega-client/issues/15
[Programme]: https://github.com/keesmod/eufy-mega-client/issues/7
[E2]: https://github.com/keesmod/eufy-mega-client/issues/9
[E6]: https://github.com/keesmod/eufy-mega-client/issues/13
[#17]: https://github.com/keesmod/eufy-mega-client/issues/17
[#18]: https://github.com/keesmod/eufy-mega-client/issues/18
[#19]: https://github.com/keesmod/eufy-mega-client/issues/19
[#20]: https://github.com/keesmod/eufy-mega-client/issues/20
[#21]: https://github.com/keesmod/eufy-mega-client/issues/21
[#22]: https://github.com/keesmod/eufy-mega-client/issues/22
[#23]: https://github.com/keesmod/eufy-mega-client/issues/23
[#24]: https://github.com/keesmod/eufy-mega-client/issues/24
[#25]: https://github.com/keesmod/eufy-mega-client/issues/25
[#26]: https://github.com/keesmod/eufy-mega-client/issues/26
[#27]: https://github.com/keesmod/eufy-mega-client/issues/27
[#28]: https://github.com/keesmod/eufy-mega-client/issues/28
[#29]: https://github.com/keesmod/eufy-mega-client/issues/29
[#30]: https://github.com/keesmod/eufy-mega-client/issues/30
[#31]: https://github.com/keesmod/eufy-mega-client/issues/31
[#32]: https://github.com/keesmod/eufy-mega-client/issues/32
[#33]: https://github.com/keesmod/eufy-mega-client/issues/33
[#34]: https://github.com/keesmod/eufy-mega-client/issues/34
[#35]: https://github.com/keesmod/eufy-mega-client/issues/35
[#36]: https://github.com/keesmod/eufy-mega-client/issues/36
[#37]: https://github.com/keesmod/eufy-mega-client/issues/37
[#38]: https://github.com/keesmod/eufy-mega-client/issues/38
[#39]: https://github.com/keesmod/eufy-mega-client/issues/39
[#55]: https://github.com/keesmod/eufy-mega-client/issues/55
[#56]: https://github.com/keesmod/eufy-mega-client/issues/56
[#57]: https://github.com/keesmod/eufy-mega-client/issues/57
[#58]: https://github.com/keesmod/eufy-mega-client/issues/58
[#59]: https://github.com/keesmod/eufy-mega-client/issues/59
[#60]: https://github.com/keesmod/eufy-mega-client/issues/60
[#61]: https://github.com/keesmod/eufy-mega-client/issues/61
[#62]: https://github.com/keesmod/eufy-mega-client/issues/62
[R3]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5620098054
[H55]: hardware/T8160_2026_09_11.md
[#96]: https://github.com/keesmod/eufy-mega-client/issues/96
[#97]: https://github.com/keesmod/eufy-mega-client/issues/97
[#98]: https://github.com/keesmod/eufy-mega-client/issues/98
[#99]: https://github.com/keesmod/eufy-mega-client/issues/99
[#100]: https://github.com/keesmod/eufy-mega-client/issues/100
[#101]: https://github.com/keesmod/eufy-mega-client/issues/101
[#102]: https://github.com/keesmod/eufy-mega-client/issues/102
[#103]: https://github.com/keesmod/eufy-mega-client/issues/103
[#104]: https://github.com/keesmod/eufy-mega-client/issues/104
[#105]: https://github.com/keesmod/eufy-mega-client/issues/105
[#106]: https://github.com/keesmod/eufy-mega-client/issues/106
[H58]: hardware/T8213_2026_09_11.md
[R4]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631081488
[R5]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631252411
[R6]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631339423
[R7]: https://github.com/keesmod/ha-eufy-cam/issues/10#issuecomment-5631991682
[#108]: https://github.com/keesmod/eufy-mega-client/issues/108
[#109]: https://github.com/keesmod/eufy-mega-client/issues/109
[#110]: https://github.com/keesmod/eufy-mega-client/issues/110
[#111]: https://github.com/keesmod/eufy-mega-client/issues/111
[#112]: https://github.com/keesmod/eufy-mega-client/issues/112
[#113]: https://github.com/keesmod/eufy-mega-client/issues/113
[#114]: https://github.com/keesmod/eufy-mega-client/issues/114
[#115]: https://github.com/keesmod/eufy-mega-client/issues/115
[Solo-software]: SOLOCAM.md
[Wall-software]: WALLLIGHT.md
[Floodlight-software]: FLOODLIGHT.md
[Indoor-software]: INDOOR.md
[Wired-software]: WIRED_DOORBELLS.md
