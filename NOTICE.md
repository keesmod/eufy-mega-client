# Attribution

MIT-licensed protocol code and research are reused from bropat/eufy-security-client
4.1.1-1, commit `d75e7996d4cbce3839a6075bed95b752ccc3ee43`.

- `vendor/src/` contains adapted device, station, P2P, image and FCM protocol
  modules from the same commit. Its HTTP module is an injected interface; the
  upstream HTTP client and orchestrator are excluded. Raw logging is disabled.
- `src/detections.ts` adapts the notification correlation logic from
  keesmod/ha-eufy-cam commit `2dd8639dc28ba34f6539c4f3999e07f55e295d40` (MIT), preserving its supported event types.
- `src/crypto.ts` derives from `src/http/megaCrypto.ts`.
- Mega request signing, login encryption, authentication payloads and discovery
  are based on `src/http/megaApi.ts`, `megaInterfaces.ts` and `http/utils.ts`.
- Original copyright: Copyright (c) 2021-2024 bropat.
- Mega protocol implementation and research: lenoxys, with upstream review and
  integration by martijnpoppen. See upstream PR #939 and its follow-up fixes.

Source: https://github.com/bropat/eufy-security-client/tree/d75e7996d4cbce3839a6075bed95b752ccc3ee43

The inherited Firebase client API key used by the FCM transport is documented
in [Firebase key provenance and security assessment](docs/FIREBASE_KEY.md).

The original MIT notice is preserved in LICENSE. New implementation copyright
2026 keesmod, also under the MIT license. This project is independent of Eufy,
Anker, and the community's separate Mega successor effort.

The adapted transport changes are maintained here: explicit LAN-derived command
credentials; no cloud DSK lookup in local mode; bounded UDP disposal; explicit
STOP recovery; repeated P2P parameter observations; a distinct device download
completion event; native Node AES; verified FCM TLS with bounded login/parsing;
push listener/timer cleanup across reconnect and shutdown; and cancellation of
old media timers before a P2P state reset; closing the actual UDP socket on
device END; renewing the UDP endpoint after confirmed STOP recovery; and
sharing concurrent transport-close operations; and a separate startup deadline
that preserves the shorter timeout for stalled media; and a three-second
audio-discovery window for delayed first AAC packets. A `livestream no data`
event reports a video stream that the library ends before it started. Version
0.28.0 adds the Wired Cam C31 as `DeviceType.WIRED_CAM_C31` (10031, T817L), with
detection states, four media commands, camera push normalization and the
existing HomeBase-controlled S350 live branch, as described in [INDOOR.md](docs/INDOOR.md#wired-cam-c31-0280). Version
0.29.0 decodes no cloud addresses for a P2P session whose row has no `app_conn`,
so a local session can start without them. Version 0.30.0 adds a lookup
observation to the P2P session: bounded counts of its local lookup rounds,
failed lookup sends, received datagrams and lookup replies by DID class, which
the client reads at most once per connection attempt. The session classifies each reply
when it arrives, against the station's own DID and a copy of the other inventory
DIDs that the client sets before the attempt, and stores no DID of a replying
device. Its counters last, also across a close, until the session starts its
next connection. The observation does not change the lookup. Version 0.30.1
makes the P2P session emit `database unhandled` for a CMD_DATABASE reply that
it drops, either because no handler takes its inner command or because parsing
it fails. The event carries the reply's inner command and result code when they
are integers and the reason, never payload text, and the Station forwards it.
The reply is still dropped. The session and Station also list the custom data of
sent commands of one name whose result is still pending, read-only.
The Station also gains `databaseQueryLocalNewest`, a client-written builder for
one read-only CMD_DATABASE_QUERY_LOCAL request for the newest 20 records of a
day on channel 0, next to the unchanged upstream `databaseQueryLocal`. Version
0.30.2 adds a key setup observation to the P2P session: bounded counts and
protocol numbers of what the session receives between its handshake and its
command key, without identifiers or payload, which the client reads at most once
per connection attempt. It also adds `setKeyWithoutAnswer` to the session and
the Station. When the owner enables it, a session whose key request gets a
successful command result holds its queued commands. Without a key answer within
5 seconds it asks the caller for credentials and, only for LAN-derived
credentials on local transport, goes on without a command key, reports the mode
`none` and sends its commands unencrypted. Otherwise it releases the commands
unchanged, or closes when the credentials fail. After it goes on without a key, a later key
answer on that connection is ignored.
Those changes must not be attributed to the original upstream release.

## Home and Tuya adapter

`src/mowers/home.ts` and `src/mowers/protocol.ts` adapt Apache-2.0 protocol work
from 8none1/robovac, commit `2e3280609e469f37a7b7d312b587841213367a9c`.
Copyright 2022 Brendan McCluskey. The source credits original work by Andre Borie.
Modified 2026 by keesmod for bounded, private, independent module ownership.
The app profile also uses MIT-licensed 8none1/eufy-x8, commit
`98e0d6506f457a2e2119e09a12cb7824d945804b`. Copyright 2026 Will Cooke.

The complete [Apache-2.0 licence](docs/licenses/Apache-2.0.txt) and
[x8 MIT notice](docs/licenses/eufy-x8-MIT.txt) are distributed with this package.
The adapted files retain Apache-2.0 terms. Other existing files retain their
MIT terms. See [component provenance and validation limits](docs/MOWER_AUTH_PROVENANCE.md).

## Local mower transport

`src/mowers/local/` is a new MIT implementation of the publicly documented Tuya
LAN protocol 3.5, copyright 2026 keesmod. Its protocol facts were established from
Tuya's Apache-2.0 TuyaOpen device SDK and cross-checked with the MIT tinytuya and
tuyapi clients. No code from those projects is included. Pinned revisions, file
digests and the reproduction record are in
[Mower transport provenance](docs/MOWER_TRANSPORT_PROVENANCE.md).
