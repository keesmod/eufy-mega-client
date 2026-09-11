# Wired doorbell evidence

Version 0.12.0 recognizes the exact catalogue pairs T8200/5, T8201/5, T8202/5
and T8203/93. Discovery and listing preserve their received identity, firmware
and valid availability observations for T8203/93. Type 5 has no numeric
DeviceState parameter in the pinned metadata, so its availability stays null.
Battery remains null because these wired types have no battery property. This is experimental inventory recognition,
not a functioning standalone transport or hardware support claim.

An empty or self-referencing parent identifies the camera as its own standalone
owner. It does not create a HomeBase or open a connection. A HomeBase 3 or any
foreign parent is rejected with `unsupported_station`. The catalogue explicitly
excludes these wired models from H3. Unknown model/type pairs remain unsupported.

## Existing protocol knowledge

The attributed MIT protocol source is pinned in this repository. These source
observations use client commit `34863d81eb3bc50dbc095ff537fe156640f7042e`:

- `vendor/src/http/device.ts`, `WiredDoorbellCamera` and `DoorbellCamera` contain
  wired device properties and motion, person and ring push processing.
- `Device.isWiredDoorbell` recognizes type 5. `Device.isWiredDoorbellDual`
  recognizes type 93. The broader battery-doorbell predicate also includes 93,
  so a future live factory must select the exact wired family before that
  predicate. A synthetic factory instance cannot prove a Mega connection.
- `vendor/src/http/station.ts`, `startLivestream` contains a wired type 5
  `CMD_DOORBELL_SET_PAYLOAD` start path. Its account field differs from several
  other camera paths. This is command-construction evidence only.
- The transport provider in `src/device-transport.ts` supplies H3 LAN-derived
  command credentials and deliberately rejects `getP2pKey`, `getCipher` and
  `getPublicKey`. Non-HB3 recording paths can require cipher acquisition.

## Remaining acceptance

[Story #27](https://github.com/keesmod/eufy-mega-client/issues/27) remains open.
The library does not yet admit a wired protocol object with a verified standalone
connection owner. Live state and motion/person/ring routing therefore remain
unverified. `getDeviceState` returns `standalone_transport_unverified`, while
`discoverDevices` and `listDevices` expose the received inventory state.

[Story #28](https://github.com/keesmod/eufy-mega-client/issues/28) remains open.
There is no accepted wired Mega authentication/media profile. Snapshot, live
video/audio and recordings return `standalone_transport_unverified` before
opening a connection. Stop/cancel and recovery cannot be claimed for this
unimplemented path. No media allowlist or protocol factory is expanded here.

[Existing transport research #36](https://github.com/keesmod/eufy-mega-client/issues/36)
owns the missing representative Mega descriptor, owner/authentication evidence
and recording route. A reproducible descriptor-to-authentication-to-command
chain is required before admitting that path. No legacy security-cloud fallback
or inferred keys are permitted. Unresolved work stays on these existing issues.
[Hardware acceptance #59](https://github.com/keesmod/eufy-mega-client/issues/59)
remains separate.

## Validation

`test/wired-doorbell.test.mjs` uses synthetic descriptors through discovery and
the public client. It checks exact pairs, unknown values, self-owned identities,
HomeBase rejection, unaffected sibling discovery and blocked operations without
creating a station or camera transport. `test/family-compatibility.test.mjs`
retains the shared catalogue admission check. These tests make no physical
connection and do not establish functioning event or media support.

No session migration is required. Retain the preceding package, lockfile and
private session store for rollback.
