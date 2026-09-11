# Standalone cameras and older camera owners

This records the 0.12.0 research for [#36] and [#35]. The inspected client
baseline is `76b965e5ef6d938bbb5f9e2aaeee2b0d730e6c61`. The permitted upstream
source is MIT-licensed bropat/eufy-security-client
`d75e7996d4cbce3839a6075bed95b752ccc3ee43`, attributed in [NOTICE].

## Result

The sources establish protocol branches and a Mega inventory endpoint, but do
not establish an authenticated standalone or older-base connection through
this client. No live standalone or older-base descriptor and command-response
receipt was available in this investigation. No devices were contacted.
This is a missing evidence boundary, not a claim that these devices cannot work.

The implemented contribution is an offline descriptor inspection tool and an
explicit discovery guard against assigning an unproven H3 command owner.
It adds no media or authentication admission. [#36] and [#35] retain their
unfulfilled implementation and validation obligations. Research completion
does not close those functional obligations or [E2]. No new stories are needed.

## Standalone representative and family dependencies

T8134 / type 63 is the representative for [#36]. The existing discovery
contract recognizes empty or self `parent_sn` as a private standalone owner,
with `standalone_transport_unverified`. This relationship is covered by
synthetic fixtures. It does not prove what a real standalone Mega response
contains or which command credentials the camera accepts.

The same evidence boundary affects wired T8200/T8201/T8202 / type 5 and
T8203 / type 93, and garage T8452 / type 132 and T8453 / type 133. Their family
stories own exact recognition and event/media behavior. T8453 / type 131 is an
unresolved common-type association and is not interchangeable with type 133.
An H3 storage option is not evidence that H3 owns camera commands.

The optional discovery profile flag `h3: false` prevents a family profile from
inheriting a station relationship from an H3 parent row. It produces the
existing `unsupported_station` reason. Existing profiles retain their admission
rules. The flag does not grant standalone transport, events, media, or actuation.

## Source findings

| Boundary                     | Reproducible source observation                                                                                                                                                                                                | Consequence                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mega inventory               | Pinned upstream `MegaHTTPApi.getDevsListDecrypted()` calls `/app/house/get_devs_list` and returns `Promise<unknown>`. Its companion interface file defines session and MQTT credentials, not standalone owner descriptors.     | An endpoint and a guessed fixture are not a descriptor contract. Obtain one contributed exact model/firmware/topology receipt.                                              |
| Mega credential routes       | The reviewed upstream Mega API has no command-cipher or P2P DSK retrieval method. Its generic signed call primitive can call endpoints, but supplies no evidence of the missing endpoint or response contract.                 | Do not guess an endpoint or call the legacy security cloud. This finding is limited to the reviewed revision.                                                               |
| Connection owner             | The vendor `Station.isIntegratedDevice()` recognizes standalone families. `getChannel()` distinguishes station and integrated channels. The private client currently builds transport stations only for admitted station rows. | Retain the actual device owner, channel and inventory relationship. Do not fabricate an alarm station.                                                                      |
| Local command authentication | Adapted `P2PClientProtocol` handles `CMD_GATEWAYINFO` through injected `getCommandCredentials()`. The client provider selects `lan-derived`, and the session restricts it to `ONLY_LOCAL`.                                     | This project-specific H3 path is not evidence that another model accepts the same credentials. A successful local key calculation is not an authenticated command response. |
| Remote authentication        | The vendor session renews a DSK via `getP2pKey()` outside `ONLY_LOCAL`. The client provider rejects that operation.                                                                                                            | A remote/relay path also needs an evidenced Mega credential route and expiry behavior.                                                                                      |
| Recording encryption         | `Station.startDownload()` has a separate HB3 envelope. Other owners use `CMD_DOWNLOAD_VIDEO`, with `getCipher()` when `cipher_id` is supplied, or a no-cipher branch otherwise.                                                | Do not assume every older recording is encrypted or unencrypted. Observe which route applies. The current provider deliberately rejects `getCipher()`.                      |
| Snapshots and history        | Client `RecordingAccess` and `DeviceTransport.latest()` associate database rows and covers with the admitted parent owner.                                                                                                     | Authentication alone would not prove snapshot/history/download ownership or formats.                                                                                        |
| Stream termination           | Client `confirmStop()` requires a matching channel and device command acknowledgement. Download cleanup distinguishes local finish from confirmed completion.                                                                  | Keep those obligations when adding a new owner. A timeout or local close is not an acknowledgement.                                                                         |

These are source observations, not experiments against physical devices.
The existing source references are [upstream Mega API], [upstream Mega interfaces],
[client discovery], [client transport], [adapted station], [adapted P2P],
[recordings] and [download lifecycle].

## Older bases and chimes

[#35] keeps each variant separate. The [model matrix] remains authoritative for
catalogue provenance and unresolved retail/model associations.

| Candidate                                                   | Pinned protocol branch                                                                                               | Missing evidence                                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8001 HomeBase, T8002 HomeBase E, T8010 HomeBase 2 / type 0 | `STATION`, `isStationHomeBase2OrOlder()`. Station property handling has firmware-specific behavior around `2.1.1.6`. | Exact Mega descriptor, firmware, child owner/channel mapping, authenticated command response and applicable recording route. Type 0 does not prove identical firmware behavior. |
| T8023 MiniBase Chime / type 25                              | `MINIBASE_CHIME`, separate `isStationMiniBaseChime()` predicate and command branches.                                | Exact descriptor, whether it owns the selected camera commands, authentication and media/recording evidence.                                                                    |
| T8025 HomeBase Mini / type 28                               | `HOMEBASE_MINI`. `isDeviceControlledByHomeBase()` includes Mini alongside H3.                                        | A shared predicate is not shared authentication or recording proof. Exact descriptor and accepted command/media routes remain missing.                                          |
| T8020 Wi-Fi Chime and T8021 Wi-Fi Bridge                    | No dedicated enum mapping in the pinned catalogue.                                                                   | Establish exact inventory type and function before classification. A sound-only device must not become an alarm station or camera owner.                                        |

No candidate is added to runtime station admission by this research.

## Reproducible offline inspection

From a source checkout with Node 24, pass a private JSON array of the decrypted
Mega device rows to:

```sh
node scripts/inspect-camera-transport.mjs /private/path/devices.json
```

The tool reads one regular file of at most 2 MiB. It rejects arrays of 100 or
more rows because this inventory API's completeness is not established at the
page limit. It performs no network requests, device operations or file writes.
Its output contains only allowlisted candidate model names, expected protocol
types, row positions, relationship observations and field-presence booleans.
It omits serials, aliases, firmware values, addresses, credential values and
unknown input fields. Invalid JSON and filesystem errors produce a fixed
message without echoing private input or paths.

All output says `transportAcceptance: not-established`, including structurally
complete rows. A present DID, license or administrator field proves neither
validity nor authentication. `parent-row` means only that a unique matching
inventory row was found. It is not command ownership proof. The probe is a
source-checkout research helper, not a new public library API or packaged CLI.

The synthetic regression tests in `test/transport-evidence.test.mjs` cover
credential redaction, duplicate identities, mismatched model/type associations,
separate owner variants, parent observation, malformed JSON and bounded input.

## Remaining work in the existing issues

1. In [#36], obtain an owner-contributed T8134 standalone descriptor receipt with
   exact firmware and topology. Run the offline inspection privately and retain
   only sanitized findings. Raw captures and identifiers stay out of GitHub.
2. Establish the authentication and command-owner contract using permitted
   primary evidence. If LAN-derived credentials apply, prove an authenticated
   response. If cipher/DSK credentials apply, establish their Mega route and
   expiry behavior. Never infer that one successful model covers another.
3. Add the smallest bounded transport implementation and independently verify
   snapshot, live video/audio, history/download, stop/cancel and recovery.
   Wire the proven route into existing family stories [#28] and [#34] as applicable.
4. Repeat the exact-owner assessment for each [#35] variant. Keep each unresolved
   capability attached to [#35], [#36] and [E2]. Hardware acceptance remains
   separate from software coverage. No failed probe is proof of impossibility.

[#35]: https://github.com/keesmod/eufy-mega-client/issues/35
[#36]: https://github.com/keesmod/eufy-mega-client/issues/36
[#28]: https://github.com/keesmod/eufy-mega-client/issues/28
[#34]: https://github.com/keesmod/eufy-mega-client/issues/34
[E2]: https://github.com/keesmod/eufy-mega-client/issues/9
[NOTICE]: ../../NOTICE.md
[model matrix]: ../MODEL_MATRIX.md
[upstream Mega API]: https://github.com/bropat/eufy-security-client/blob/d75e7996d4cbce3839a6075bed95b752ccc3ee43/src/http/megaApi.ts
[upstream Mega interfaces]: https://github.com/bropat/eufy-security-client/blob/d75e7996d4cbce3839a6075bed95b752ccc3ee43/src/http/megaInterfaces.ts
[client discovery]: ../../src/discovery.ts
[client transport]: ../../src/device-transport.ts
[adapted station]: ../../vendor/src/http/station.ts
[adapted P2P]: ../../vendor/src/p2p/session.ts
[recordings]: ../../src/recordings.ts
[download lifecycle]: ../../src/download.ts
