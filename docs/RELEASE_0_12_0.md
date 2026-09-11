# Library 0.12.0

[Version 0.12.0](https://github.com/keesmod/eufy-mega-client/releases/tag/v0.12.0)
was published on 11 September 2026 from commit
`6fbf2dcb493b6c37739187294211d0545ee1f156`. It combines SoloCam work with
additional camera families and a review of remaining camera connections.
[#63](https://github.com/keesmod/eufy-mega-client/issues/63) records preparation.
[The publication run](https://github.com/keesmod/eufy-mega-client/actions/runs/34631852445)
passed all checks and verified the downloaded public assets.

## Included camera profiles

| Family                                      | Discovery, observed state and events                                                        | Media on the existing H3 profile                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [eufyCam C35](EUFYCAM.md)                   | T8110/10035, with the existing general camera implementation                                | Existing H3 media profile                             |
| [SoloCam](SOLOCAM.md)                       | Ten exact pairs, including the existing T8134                                               | Nine additional pairs, with T8134 admission preserved |
| [Indoor](INDOOR.md)                         | T8400/30, T8410/31, T8401/34, T8411/35, T8441/45, T8442/46, T8414/100, T8416/104, T8417/105 | The same nine pairs                                   |
| [Floodlight](FLOODLIGHT.md)                 | T8425/47 and T8426/87                                                                       | The same two pairs                                    |
| [Wall-light](WALLLIGHT.md)                  | T84A1/151 and T81A0/10005                                                                   | T81A0 only. T84A1 media remains unverified            |
| [4G/Wi-Fi camera](LTE.md)                   | T86P2/111 with an actual H3 parent                                                          | Wi-Fi/H3 mode only. LTE remains unimplemented         |
| [Integrated cameras](INTEGRATED_CAMERAS.md) | T8530/55, T8790/90 and T85V0/203, camera features only                                      | The same three pairs. No lock or parcel actuation     |

Media includes stored snapshots, live video/audio, recording history and downloads.
New admission requires an actual matching T8030/type 18 parent and the existing
additional-H3 owner-firmware guard. Empty/self parents remain standalone
descriptors without a connection. H3 storage compatibility cannot establish
command ownership. Exact model and firmware limits are in the family documents.

Existing attributed camera classes and command branches are reused. No vendor
protocol is added. Motion/person events are filtered and correlated by the
existing owner and property checks. Missing battery or availability data stays
unknown. New light settings, PTZ, talkback and standalone transport are excluded.

## Evidence and open work

Automated checks exercise the real protocol classes with synthetic inventory,
messages and media bytes. They cover exact commands, codecs, acknowledged
stop/cancel, bounded cleanup, independent owners and existing family regressions.
They do not prove physical streams, audible sound or hardware recovery.

The dated T8160/T8213 through T8030 hardware evidence on client 0.10.0 and
bridge/integration 0.7.1 in
[#55](https://github.com/keesmod/eufy-mega-client/issues/55) and
[#58](https://github.com/keesmod/eufy-mega-client/issues/58) retains its original
tested versions. It is not promoted to a hardware test of this candidate.
SoloCam [#56](https://github.com/keesmod/eufy-mega-client/issues/56), Indoor
[#57](https://github.com/keesmod/eufy-mega-client/issues/57), Floodlight
[#60](https://github.com/keesmod/eufy-mega-client/issues/60) and Wall-light
[#61](https://github.com/keesmod/eufy-mega-client/issues/61) retain physical
validation. The original [T8134 audio report](https://github.com/keesmod/ha-eufy-cam/issues/10)
remains unresolved. This candidate makes no audio-fix claim.

The remaining catalogue is accounted for under the existing
[camera epic](https://github.com/keesmod/eufy-mega-client/issues/9):

| Area                                                                    | Delivered in this candidate                                                                    | Remaining obligation                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Wired doorbells](WIRED_DOORBELLS.md)                                   | T8200/5, T8201/5, T8202/5 and T8203/93 inventory descriptors with explicit connection blockers | #27/#28 and #36 retain authentication, active state/events and media. Hardware #59 stays separate               |
| [Garage cameras](GARAGE.md)                                             | T8452/132 and T8453/133 descriptors, with standalone and H3 rejection where appropriate        | #33/#34 and #36 retain active connection/events/media. Type 131 remains unresolved, hardware #62 stays separate |
| [Standalone and older owners](research/CAMERA_TRANSPORTS_2026-09-11.md) | An offline redacted descriptor inspector and the explicit H3 ownership guard                   | #36/#35 retain exact descriptor, authentication, command and recording evidence                                 |
| [LTE](LTE.md)                                                           | T86P2 Wi-Fi/H3 software coverage                                                               | #37 retains the actual LTE/relay authentication and media route, including T8150                                |
| [PoE/NVR](research/NVR_TRANSPORT.md)                                    | Pinned protocol research and offline rejection probes                                          | #38 retains T8N00/T8E00 Mega signaling, WebRTC/framing, ownership and media lifecycle                           |
| [Integrated and unresolved models](INTEGRATED_CAMERAS.md)               | The exact camera profiles above                                                                | #39 and E2 retain T8531, unresolved model/type aliases, other owners and physical validation                    |

Mower code, map lifecycle, credentials and session formats are unchanged.
The programme and map acceptance remain open. Unresolved battery-doorbell,
SoloCam and Indoor aliases remain visible in the model matrix. Recognized
models, implemented functions and physical results are separate claims.

## Installation and rollback

Node 24 is required. The final source commit, successful CI, Release rehearsal
and package evidence are recorded in #63. A rehearsal supplies a compiled tarball
and a manifest with source commit and hashes. Follow the
[release verification procedure](RELEASING.md) before using that exact artifact.
The [README installation command](../README.md#install-and-upgrade) uses the published
0.12.0 tarball.

Before upgrading, retain the previous package and lockfile and back
up private session data. Install the verified tarball in an isolated consumer,
keep one controller per device and check the features you use. No session or API
migration is required. Restore the retained package, lockfile and private store
to roll back. Library preparation alone does not upgrade a Home Assistant bridge.

Consumers must inspect discovery issues and `getCameraCapabilities()`. A listed
camera or a successful expected-ID comparison does not prove a working connection.
The camera bridge at `7a145e9315bdc4f0cddf855758fc072df8dadb05` retains capability
checks for live/recording operations, while its migration inventory check compares
identities only. New wired/garage recognition does not provide those devices'
missing standalone features.
Report scoped results through the [community process](COMMUNITY_VALIDATION.md).
Missing hardware feedback alone does not block ordinary upgrades.

Publication does not establish deployment or new hardware validation. Existing MIT
and Apache-2.0 attribution remains packaged. It adds no mower licensing claim.
