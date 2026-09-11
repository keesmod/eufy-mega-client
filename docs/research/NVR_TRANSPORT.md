# PoE/NVR transport evidence

Issue [#38](https://github.com/keesmod/eufy-mega-client/issues/38), reviewed
11 September 2026 for the unpublished 0.12.0 batch. The functional obligation
remains open. This report does not enable NVR cameras or claim hardware support.

## Exact scope and result

The catalogue identifies `T8N00`, type `300`, as the NVR and `T8E00`, type `301`,
as its PoE camera. `E8P10` is a system code, not an assumed discovery model.
Eufy's [setup instructions][setup] place cameras directly on the NVR or behind
a PoE switch connected to it. The NVR connects to the router through its LAN
port. Eufy explicitly [excludes HomeBase 2 and 3][homebase]. These statements
establish physical topology, not the Mega inventory fields or command channel.

The current library has no admitted NVR transport. Adding these models to the
existing H3 profile would misrepresent the authentication and media evidence.
This is an architecture dependency, not a missing model-name entry.

## Reproducible source audit

The library baseline for this investigation is batch commit
`76b965e`. The adapted camera source comes from bropat/eufy-security-client
`d75e7996d4cbce3839a6075bed95b752ccc3ee43`, attributed in [NOTICE](../../NOTICE.md).

- `vendor/src/http/types.ts` defines the two types, possible properties and
  command names. Camera entries include live start/stop and download/cancel.
  NVR station entries include image and database operations.
- `vendor/src/http/device.ts` classifies the PoE camera and the NVR separately.
  `vendor/src/http/station.ts` has NVR identity predicates, but its live media
  implementation uses the inherited P2P command machinery.
- The upstream [NVR registration PR][registration] describes catalogue,
  properties and command registration. It does not demonstrate a complete
  authenticated stream lifecycle through this library.
- `src/discovery.ts` rejects both exact pairs. `src/camera-media.ts` does not
  admit the camera. `src/device-transport.ts` has no NVR WebRTC session owner.
  The package has no WebRTC datachannel transport dependency.

Command names and metadata are useful clues. They do not prove credential
availability, channel mapping, successful start, audio, recordings or stop.

## Additional primary research

[HallyAus/Eufy-Home-Assistant][research] at
`4278ed93628d1321e2795447e9bdaf15cd999d4f` is MIT-licensed. Its author reports
T8N00 firmware 1.3.3.0 with T8E00 channels 0–3 using a Mega-authenticated signaling
session and WebRTC datachannels. The report distinguishes empty classic P2P
provisioning from NVR signaling, and describes an additional reliable framing
layer. Its implementation uses Python aiortc and an Eufy WASM framing module.

That is a concrete alternative to investigate, not proof of equivalence to our
H3 LAN transport. We did not reproduce that hardware result. No code, packet
constants, fixtures or downloaded binaries from that project were imported.
Its MIT repository license does not by itself establish redistribution rights
for a separately fetched Eufy binary. A reusable implementation needs its own
verified framing dependency or independently implemented framing path.

Eufy's [NVR web portal documentation][portal] provides an official entry point
for further owned-device observation. It does not specify a public protocol API.

## Offline admission probe

From a checkout with Node 24 and installed dependencies:

```sh
npm run build
node --test test/nvr-boundary.test.mjs
```

The independently authored synthetic probe submits an NVR and camera through
the existing mocked Mega API. It varies the camera channel and checks discovery,
connection, snapshot, live start and recording-list rejection. It verifies that
no device transport objects or live sessions are created and that a PoE model
cannot inherit H3 media admission. The channel values are test inputs, not
verified mappings for a user's installation. No network or physical device is
used. A passing probe proves the current boundary, not protocol impossibility.

## Remaining work in #38

1. Obtain a privacy-preserving, owned or contributed Mega descriptor observation
   for the exact NVR/camera pair. Establish parent ownership, camera channels,
   administrator identity and the regional signaling route without publishing
   account data or identifiers.
2. Verify how the existing Mega session obtains the NVR signaling credential.
   Keep this within the Mega authentication boundary. Do not use legacy security
   cloud login as a fallback.
3. Select and validate a distributable WebRTC and reliable-framing implementation
   compatible with the library's Node 24 package. Add bounded signaling, media
   ownership and cleanup with an acknowledged stop path.
4. Establish snapshot, live video, audio, events and recording query/download
   independently. A successful live video session does not close other features.
5. Run compiled-package and lifecycle tests, then record exact hardware evidence
   separately. Preserve software-only claims until that validation is available.

No new follow-up story is created. These implementation and evidence obligations
remain in [#38] and [E2](https://github.com/keesmod/eufy-mega-client/issues/9).
An unavailable descriptor or an unverified framing dependency must not be
replaced by guessed credentials or an assumed HomeBase connection.

[setup]: https://service.eufy.com/article-description/How-do-I-set-up-my-PoE-NVR-Security-System
[homebase]: https://service.eufy.com/article-description/Does-the-PoE-NVR-Security-System-work-with-HomeBase-2-and-HomeBase-3
[portal]: https://service.eufy.com/article-description/What-is-the-purpose-of-the-web-portal-designed-for-the-PoE-NVR-Security-System
[registration]: https://github.com/bropat/eufy-security-client/pull/854
[research]: https://github.com/HallyAus/Eufy-Home-Assistant/blob/4278ed93628d1321e2795447e9bdaf15cd999d4f/docs/PROTOCOL.md
[#38]: https://github.com/keesmod/eufy-mega-client/issues/38
