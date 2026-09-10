# Camera model, topology and feature evidence

Reviewed 2026-09-10 for [story #15][Story]. This is an evidence inventory for the
[programme][Programme], not a list of supported products. Product implementation
belongs to [E2] and hardware acceptance to [E6]. Current work status stays in GitHub.

The camera bridge and integration belong in `ha-eufy-cam`. The separate mower
bridge and integration belong in `eufy-robomow-ha`. Both consume this library
independently, as described in [PROGRAMME.md](PROGRAMME.md).

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

Model/type associations outside the four recognized camera models are catalogue
associations for investigation, not observations from a Mega inventory. Eufy's
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
| W              | Standalone Wi-Fi camera with its own transport/storage owner. Optional HomeBase storage does not prove HomeBase command ownership.             | Product sources per row. No standalone owner is implemented. [#36], [#17], [E2], [E6].                                               |
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
| 30            | `INDOOR_CAMERA`                        | T8400                                        | Indoor Cam 2K / C120                                                          | indoor     | W, H3                                       | [Indoor], [HB-guide]                         | C           |
| 31            | `INDOOR_PT_CAMERA`                     | T8410. T8410C variant unresolved             | Indoor Cam 2K Pan & Tilt / E220                                               | indoor     | W, H3                                       | [Indoor], [HB-guide]                         | C           |
| 32            | `SOLO_CAMERA`                          | T8130                                        | SoloCam E20                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                    | C           |
| 33            | `SOLO_CAMERA_PRO`                      | T8131                                        | SoloCam E40                                                                   | solo       | W, H3. HM candidate                         | [Solo], [HB3], [HB-guide]                    | C           |
| 34            | `INDOOR_CAMERA_1080`                   | T8401                                        | Indoor Cam 1080p                                                              | indoor     | W, H3                                       | [Indoor], [HB3]                              | C           |
| 35            | `INDOOR_PT_CAMERA_1080`                | T8411                                        | Indoor Cam 1080p Pan & Tilt / E210                                            | indoor     | W, H3                                       | [Indoor], [HB-guide]                         | C           |
| 37            | `FLOODLIGHT_CAMERA_8422`               | T8422                                        | Floodlight Cam E 2K / E220                                                    | flood      | W, H3 storage only in HB3 source            | [Flood], [Display], [HB3]                    | C           |
| 38            | `FLOODLIGHT_CAMERA_8423`               | T8423                                        | Floodlight Cam 2 Pro / 2K Pro / S330                                          | flood      | W, H3                                       | [Flood], [Display], [HB3]                    | C           |
| 39            | `FLOODLIGHT_CAMERA_8424`               | T8424                                        | Floodlight Cam 2K / E221                                                      | flood      | W, H3 storage only in HB3 source            | [Flood], [Display], [HB3]                    | C           |
| 44            | `INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT` | T8440 candidate                              | OutdoorCam E                                                                  | indoor     | W. H3 unresolved for this variant           | [Display], [Predicates]                      | C           |
| 45            | `INDOOR_OUTDOOR_CAMERA_2K`             | T8441                                        | Outdoor Cam Pro / C24                                                         | indoor     | W, H3, HM candidate                         | [Display], [HB-guide]                        | C           |
| 46            | `INDOOR_OUTDOOR_CAMERA_1080P`          | T8442                                        | Outdoor Cam / C22                                                             | indoor     | W, H3, HM candidate                         | [Display], [HB-guide]                        | C           |
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
| 100           | `INDOOR_COST_DOWN_CAMERA`              | T8414                                        | Indoor Cam Mini 2K / Solo IndoorCam P44                                       | indoor     | W, H3. HM candidate                         | [Indoor], [Display], [HB-guide]              | C           |
| 101           | `CAMERA_GUN`                           | Unknown                                      | Unresolved catalogue label. No verified marketing name                        | unresolved | Unknown                                     | [Catalogue]                                  | C           |
| 102           | `CAMERA_SNAIL`                         | Unknown                                      | Unresolved catalogue label. No verified marketing name                        | unresolved | Unknown                                     | [Catalogue]                                  | C           |
| 104           | `INDOOR_PT_CAMERA_S350`                | T8416                                        | Indoor Cam S350                                                               | indoor     | W candidate, H3, HM candidate               | [Display], [HB-guide]                        | C           |
| 105           | `INDOOR_PT_CAMERA_E30`                 | T8417                                        | Indoor Cam E30                                                                | indoor     | W candidate, H3, HM candidate               | [Display], [HB-guide]                        | C           |
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

| Code | Meaning                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H    | Historical hardware observation in [H0] on the exact tuple below. It does not establish current health, every firmware or every event type.                                                      |
| P    | Partial reporter success in [R1], on [R0]'s tuple. Installed versions and full lifecycle checks remain unconfirmed.                                                                              |
| X    | Experimental software path only. [C0] and [Adapter] expose the function. [Discovery-tests] checks S220 discovery. [S1] checks its live command selection. No full per-model hardware acceptance. |
| F    | Reported failure in [R1]. [R2] separately reports reproduced consumer defects. The cause of the hardware black screen is not yet confirmed by retest.                                            |
| B1/U | Proven client entry barrier: model absent from the allowlist in [C0]. Underlying feature behavior is unknown, not proven impossible.                                                             |
| B2/U | Proven client owner barrier: a recognized camera requires a discovered T8030 parent in [C0]. Behavior on other owners is unknown.                                                                |
| U    | Unknown or no sufficiently specific observation. An enum or generic test cannot turn U into H.                                                                                                   |
| N/A  | No camera function on an owner-only device. This does not exclude its station status or recording ownership.                                                                                     |

For R rows, H3 results apply only to the exact model stated in the evidence
column. Candidate suffixes remain B1/U. For C rows, B1/U applies to every listed
topology. State covers available identity, firmware and availability. Battery is
shown separately. Discovery initially returns battery null. The adapter reads a
valid observed percentage or leaves it null. No battery lifetime claim is made.

| Type  | Model / evaluated topology                              | Discovery | Available state | Battery     | Stored snapshot | Live video | Live audio | Events   | Recordings    | Evidence                           | Remaining work      |
| ----- | ------------------------------------------------------- | --------- | --------------- | ----------- | --------------- | ---------- | ---------- | -------- | ------------- | ---------------------------------- | ------------------- |
| 1     | T8111 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 3     | T8420 / T8420X / listed topologies                      | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#29], [#30], [#60] |
| 4     | T8112 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 5     | T8200 / T8201 / T8202 / listed topologies               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#27], [#28], [#59] |
| 7     | T8210 / T8212 candidates / listed topologies            | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#25], [#26], [#58] |
| 8     | T8113 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 9     | T8114 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 14    | T8140 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 15    | T8142 / H3 only                                         | X         | X               | X           | X               | X          | X          | X        | X             | [S1], [C0]                         | [#19], [#20], [#55] |
| 16    | T8220 / T8221 / T8222 candidates / listed topologies    | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#25], [#26], [#58] |
| 19    | T8160 / H3 only                                         | H         | H               | U per-model | H               | H          | H          | H person | H             | [H0], [C0]                         | [#19], [#20], [#55] |
| 23    | T8161 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 24    | T8600 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 26    | T8162 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 30    | T8400 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 31    | T8410 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 32    | T8130 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 33    | T8131 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 34    | T8401 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 35    | T8411 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 37    | T8422 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#29], [#30], [#60] |
| 38    | T8423 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#29], [#30], [#60] |
| 39    | T8424 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#29], [#30], [#60] |
| 44    | T8440 candidate / listed topologies                     | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 45    | T8441 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 46    | T8442 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 47    | T8425 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#29], [#30], [#60] |
| 48    | T8170 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 49    | T8144 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 55    | T8530 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#39], [E2], [E6]   |
| 60    | T8122 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 61    | T8123 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 62    | T8124, T8124V/R variants unresolved / listed topologies | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 63    | T8134 / H3 only                                         | P         | P identity      | P reading   | P               | F          | U          | P person | P video/audio | [R0], [R1], [R2], [R3], [S1], [C0] | [#21], [#22], [#56] |
| 64    | T8B00 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 87    | T8426 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#29], [#30], [#60] |
| 88    | T8171 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 89    | T8172 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |
| 90    | T8790 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#39], [E2], [E6]   |
| 91    | T8213 / H3 only                                         | H         | H               | U per-model | H               | H          | H          | H ring   | H             | [H0], [C0]                         | [#25], [#26], [#58] |
| 93    | T8203 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#27], [#28], [#59] |
| 94    | T8214 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#25], [#26], [#58] |
| 95    | T8224 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#25], [#26], [#58] |
| 96    | T8223 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#25], [#26], [#58] |
| 98    | T8173 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#21], [#22], [#56] |
| 100   | T8414 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 101   | Unknown / listed topologies                             | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#39], [E2], [E6]   |
| 102   | Unknown / listed topologies                             | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#39], [E2], [E6]   |
| 104   | T8416 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 105   | T8417 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 110   | T8150 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#37], [E2], [E6]   |
| 111   | T86P2 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#37], [E2], [E6]   |
| 131   | T8453 candidate / listed topologies                     | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#33], [#34], [#62] |
| 132   | T8452 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#33], [#34], [#62] |
| 133   | T8453 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#33], [#34], [#62] |
| 151   | T84A1 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#31], [#32], [#61] |
| 189   | T8531 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#39], [E2], [E6]   |
| 203   | T85V0 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#39], [E2], [E6]   |
| 301   | T8E00 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#38], [E2], [E6]   |
| 10005 | T81A0 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#31], [#32], [#61] |
| 10008 | T8W11C candidate / listed topologies                    | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 10009 | T8419 / T8W11P candidate / listed topologies            | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 10010 | T8W11C candidate / listed topologies                    | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 10011 | T8419N per catalogue only / listed topologies           | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#23], [#24], [#57] |
| 10035 | T8110 / listed topologies                               | B1/U      | B1/U            | B1/U        | B1/U            | B1/U       | B1/U       | B1/U     | B1/U          | [C0], [Catalogue]                  | [#19], [#20], [#55] |

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
`BatteryDoorbellCamera` for T8213. It does not yet instantiate a new SoloCam
family factory. That obligation remains [#21].

For excluded models, available vendor predicates, properties or command tables
are protocol leads only. They are not experimental public-client coverage.
Battery-less products also say B1/U because their current client status route is
unreachable. Do not read that as a claim that a mains-powered product has a battery.

## Dated device evidence and failures

| Evidence                   | Date, software and hardware tuple                                                                                                                                                                                                  | Positive observations                                                                                                                                                                                                                                                                                           | Limits and owner                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0 baseline                | 2026-09-09 to 2026-09-10. Client 0.1.0-dev.8 on isolated HA, then 0.1.0 with audio timing fix on production. T8030 firmware 3.8.6.0, three T8160 firmware 3.4.3.0, one T8213 firmware 0.2.1.8. H3 local LAN, exclusive controller. | Authentication/discovery, available state, stored snapshots, live video/audio and confirmed STOP. Recording history, playback, seek and cancel. Real person and doorbell events. A short battery observation exists, but the summary does not assign it to each model. Per-model battery proof remains unknown. | [H0] records the acceptance. Overnight idle evidence preceded the active-stream timing fix and covered 11h26m, not 24h. Event counts are installation-wide. Non-person motion was disabled. [#55], [#58], [E6] retain untested variants. |
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
