# Cameras in integrated products

Version 0.12.0 adds experimental camera software coverage for three exact
model/type pairs. [Issue #39](https://github.com/keesmod/eufy-mega-client/issues/39)
retains the unresolved models and protocols. No physical hardware was tested for
this contribution. Successful software checks do not establish hardware support.

| Exact pair  | Product               | Existing private camera implementation    | Observed state and events                                                           |
| ----------- | --------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| T8530 / 55  | Video Smart Lock S330 | DoorbellCamera, without the lock subclass | Battery and availability when reported, motion, person and ring                     |
| T8790 / 90  | SmartDrop             | SmartDrop                                 | Battery when reported, availability unknown, person and H3 motion. Ring unsupported |
| T85V0 / 203 | FamiLock S3 Max       | BatteryDoorbellCamera                     | Battery and availability when reported, motion, person and ring                     |

The actual inventory must name an admitted T8030/type 18 parent. Matching a
product to a compatibility list cannot assign that parent. Empty or self-parent
descriptors remain recognized with `standalone_transport_unverified`. An
unrecognized parent returns `unsupported_station`. Neither creates a public
HomeBase or opens a connection. Unknown firmware and unavailable state remain
unknown. Model suffixes and marketing bundles do not inherit admission.

## Camera-only boundary

The public device remains a camera. No lock state, PIN, user management, door
opening, lid control or parcel mechanism is added to the public API. The existing
private SDK classes stay behind the library boundary. The S330 uses the existing
doorbell camera class because only its camera behavior is needed.

Only motion, person and ring detections are eligible for these profiles, subject
to model properties. Native lock, parcel-state, battery-alert and unknown push
types are ignored. A package-state change is not reported as a camera detection.
Actual owner matching and the existing duplicate suppression apply before
delivery. SmartDrop native person notifications and H3 companion notifications
share one detection. Native motion decoding beyond that inherited H3 path is not
claimed for SmartDrop.

## H3 media profile

The existing additional-H3 admission requires an exact T8030/type 18 owner whose
identifier begins with T8030, matching the camera parent, and a numeric four-part
owner firmware of at least 2.0.9.7. This inherited conservative software guard is
not a measured minimum firmware for any of these products. Camera firmware in
fixtures is synthetic. LAN-derived credentials are the only admitted encryption
mode. No standalone authentication or legacy security-cloud fallback is added.

The attributed vendor code already contains three different live branches:

| Exact pair  | Existing live envelope                                                             | Scope of the software check                                                                                             |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| T8530 / 55  | Integer `CMD_START_REALTIME_MEDIA` with device channel and RSA public key          | The existing branch does not encode the requested codec. Tests preserve that behavior without promising codec selection |
| T8790 / 90  | `CMD_SET_PAYLOAD`, nested live command, `mChannel: 0`, actual outer device channel | Android marker, camera type, entry type, RSA key and H264/H265 stream type                                              |
| T85V0 / 203 | Generic `CMD_SET_PAYLOAD` live command                                             | Android marker, RSA key and H264/H265 stream type                                                                       |

No new wire implementation is introduced. Per-model tests exercise the actual
vendor command methods and verify their full envelopes, owner rejection and
channel. Stored snapshot lookup, database listing/counting, H3 download and
cancel reuse the existing owner path. Fixtures separately cover image bytes,
video/audio forwarding, recordings, rejected commands, cancellation and resource
cleanup. STOP and download cancellation still require matching acknowledgements.
This is software coverage of the inherited H3 route, not a measured device or
cloud recording result.

## Evidence and remaining obligations

The protocol source is the attributed MIT camera adaptation of
`bropat/eufy-security-client` 4.1.1-1, upstream commit
`d75e7996d4cbce3839a6075bed95b752ccc3ee43`, recorded in [NOTICE](../NOTICE.md).
The inspected client baseline is
`34863d81eb3bc50dbc095ff537fe156640f7042e`. This contribution leaves vendor code
unchanged. Reproducible checks are in [integrated regressions](../test/integrated.test.mjs),
[media profiles](../test/fixtures/integrated-media.mjs),
[native command/media checks](../test/eufycam-media.test.mjs) and
[lifecycle checks](../test/family-lifecycle.test.mjs).

Primary product sources reviewed on 11 September 2026 are Eufy's
[H3 compatibility list](https://service.eufy.com/article-description/S380-HomeBase-HomeBase-3-Compatibility),
[complete HomeBase guide](https://service.eufy.com/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide)
and [Video Smart Lock setup](https://service.eufy.com/article-description/How-to-set-up-the-Video-Smart-Lock).
They establish product/topology associations, not numeric protocol identifiers,
Mega descriptors or a successful command round trip.

| Remaining item                                           | Concrete evidence gap                                                                                                                                                                                                | Existing owner   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T8531 / 189 Video Smart Lock E330                        | The pinned `DeviceProperties` and `DeviceCommands` entries contain lock behavior but no camera detection metadata or media commands. `Device.isCamera` also excludes it. Do not borrow S330 commands to fill the gap | #39 and E2       |
| E85V0 and other suffix or bundle variants                | A marketing relationship does not establish their exact Mega model/type descriptor                                                                                                                                   | #39 and E2       |
| CAMERA_GUN / 101 and CAMERA_SNAIL / 102                  | The source contains enum labels only, without a model association, camera metadata or command registration                                                                                                           | #39 and E2       |
| INDOOR_PT_CAMERA_C220_V3 / 10011                         | Vendor alias tables exist, but an alias is not a verified exact model/topology descriptor. This remains an Indoor obligation                                                                                         | #23 and E2       |
| Standalone Wi-Fi, Wi-Fi bridge and older HomeBase owners | Their actual descriptor, authentication and recording route need separate evidence. H3 storage compatibility cannot supply it                                                                                        | #36, #35 and #39 |
| Hardware acceptance for each admitted tuple              | Exact firmware, real discovery/owner, each feature, stop/reopen and recovery observations are still needed                                                                                                           | #39 and E6       |

These obligations stay on the existing issues. The user requested no new stories.
Issue #39 and the parent family goal remain open while required coverage is
missing. A later community report can provide hardware evidence without the
maintainer buying each device, under the [community policy](COMMUNITY_VALIDATION.md).

No session migration is required. Keep the prior package, dependency lockfile
and private session store for rollback. Version 0.12.0 is an unpublished candidate.
