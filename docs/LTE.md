# 4G camera evidence

Version 0.12.0 adds experimental software coverage for **T86P2 / type 111 in
Wi-Fi mode with its actual T8030 HomeBase 3 parent**. This is not cellular
support. Research [#37](https://github.com/keesmod/eufy-mega-client/issues/37)
remains open for the LTE transport and hardware obligations below.

## Exact scope

| Model and type      | Connection                                    | Result                                                                                                       |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| T86P2 / 111         | Actual T8030 / 18 inventory parent, H3 LAN    | Experimental discovery, observed battery/status, H3 events, stored snapshot, live video/audio and recordings |
| T86P2 / 111         | Empty or self parent, standalone Wi-Fi or LTE | Recognized inventory with `standalone_transport_unverified`. No station, connection, events or media enabled |
| T86P2 / 111         | Missing, unknown or older owner               | Explicit unsupported owner. No inferred H3 route                                                             |
| T8150 / 110         | Cellular only                                 | Not admitted. No evidenced Mega cellular credentials or recording route                                      |
| T8151, T8152, T8153 | Regional LTE variants                         | No inferred model/type admission. Regional mapping and descriptors remain unverified                         |

The admitted media profile requires the exact model/type pair and a matching
T8030 / 18 owner whose serial starts with T8030. The inherited additional-H3
guard requires numeric four-part owner firmware at least 2.0.9.7. This is a
conservative software boundary, not a physically measured minimum firmware.
Firmware 1.2.3 for the camera and 3.8.6.0 for the owner in tests are synthetic.
An inventory parent is necessary for admission. A product label or storage
compatibility alone does not supply that relationship.

## Sources and implementation

Reviewed on 11 September 2026 against batch baseline
`76b965e` and the attributed MIT vendor source pinned in [NOTICE](../NOTICE.md),
bropat/eufy-security-client 4.1.1-1 commit
`d75e7996d4cbce3839a6075bed95b752ccc3ee43`.

- Eufy's [HomeBase 3 compatibility table](https://service.eufy.com/article-description/S380-HomeBase-HomeBase-3-Compatibility)
  explicitly limits T86P2 HomeBase support to Wi-Fi mode and excludes cellular-only
  T8150. Its [complete guide](https://service.eufy.com/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide)
  also excludes T8151 and T8152 from HomeBases. These establish product topology,
  not Mega credentials or a tested device.
- `vendor/src/http/types.ts` maps type 111 to T86P2 and supplies observed state,
  battery, motion/person/vehicle properties and media command declarations.
- `vendor/src/http/device.ts` identifies type 111 as an outdoor pan/tilt camera.
  Its generic `Camera` already handles H3 `msg_type: 18` notifications. No new
  adapter is needed for this H3 scope and no standalone event format is claimed.
- `Station.startLivestream()` selects `CMD_DOORBELL_SET_PAYLOAD` with command
  1000, accountId, camera_type 0, entrytype 0, encryptkey and streamtype for this
  exact type. Stop uses the existing channel-bound acknowledgement. H3 download
  uses the existing account/key envelope and cancel acknowledgement.
- Stored images, recording queries, stream lifecycle and download completion
  reuse the existing H3 code. No vendor protocol, credential provider, retry,
  session format, bridge or firmware setting changes were made.

## Reproducible software evidence

Use Node 24, install the locked dependencies and run:

```sh
npm ci --ignore-scripts
npm test
python3 scripts/check_model_matrix.py
python3 scripts/release.py build
```

`test/lte.test.mjs` checks exact model/type recognition, actual parent ownership,
observed and absent state, generic adapter reuse, H3 person notifications,
duplicate correlation, unsupported events, standalone public capability reasons
and isolation from rejected LTE-only models. `test/fixtures/lte-media.mjs`
extends the shared media, capability and lifecycle suites. They check the real
vendor command envelopes, stored images, live video/audio metadata, bounded
streams, owner/channel rejection, acknowledged stop/cancel, recordings and
independent-owner cleanup. The station boundary is synthetic and opens no
hardware connection. No test proves physical audio, video or LTE operation.

## Cellular blocker and remaining acceptance

The current client explicitly selects `P2PConnectionType.ONLY_LOCAL` and provides
LAN-derived command credentials. This is a concrete implementation boundary,
not a failed network probe or a claim that LTE support is impossible:

1. `vendor/src/p2p/session.ts` renews a DSK before non-local connection through
   `CloudProvider.getP2pKey()`. The library provider rejects that operation and
   has no evidenced Mega endpoint for obtaining and renewing the required key.
2. The gateway credential path rejects LAN-derived credentials in non-local
   mode. A cipher-based provider and its authorized Mega source are not
   implemented. Switching the transport mode cannot establish authentication.
3. No owned or contributed T8150/T86P2 LTE Mega descriptor or relay transcript
   was supplied for this task. Camera versus owner identity, usable credentials,
   key lifetime, relay handshake and recording ownership cannot be validated
   from the enum, advertised connectivity or a synthetic H3 fixture.
4. Standalone recording may require a cipher identifier and private key through
   `Station.startDownload()`. The existing provider rejects `getCipher()`.
   H3 storage/download tests do not establish that cellular route.

Keep #37 and [E2](https://github.com/keesmod/eufy-mega-client/issues/9) open for
these obligations. A consented, private LTE descriptor and read-only relay
observation must establish the exact model, firmware, owner, credential source
and media route. Raw identifiers, tokens, keys and footage must remain private.
Then implement the proven Mega credential path and validate snapshot, live
video/audio, recording and acknowledged cleanup independently on hardware.
Standalone Wi-Fi is coordinated with [#36](https://github.com/keesmod/eufy-mega-client/issues/36),
other owners with [#35](https://github.com/keesmod/eufy-mega-client/issues/35).
Do not create a replacement story or close the cellular obligation because
this H3 contribution passes software checks.

Upgrades remain available without a maintainer hardware test. Runtime
capabilities retain the explicit unverified reason. No migration is required.
For rollback retain the previous package, lockfile and private session store.
