# Authenticated E15 read-only response from standalone Linux

Story [#78](https://github.com/keesmod/eufy-mega-client/issues/78), programme #7,
epic #11. Change class: Architecture research with an isolated executable probe.

## Result

On 2026-09-10, a standalone Node **24.16.0** process on Linux x64 received a
correlated E15 application version response after fresh authenticated signaling,
carrier authentication and application authorization. The successful attempt
completed in **560 ms**, including confirmed resource cleanup. This satisfies
#78. It does not establish portable map or file transfer, which remains #49.

The device is the previously verified E15 on owner-reported firmware **6.9.28**.
The same private account/device/local-key binding as #40 was used. Firmware was
not independently read by this probe. The selected route was a TCP relay with
MQTT over verified TLS for signaling. The normal Android probe was stopped
before each standalone attempt and restarted afterwards. No movement, settings,
map writes, album requests or file transfers were issued.

The runtime consisted of the six `e15-*.mjs` probe modules listed below and
Node built-ins. It loaded no Android code, vendor native library, SDK emulator
or remote helper. The official Linux Node archive was verified against its
published SHA256 list. Android and native emulation were used only in separate,
prior protocol research and normal-source recovery checks.

## Provenance established before transmission

Read the prerequisite [key/carrier contract](E15_KEY_CARRIER_CONTRACT_2026-09-10.md)
for SDP key setup, signaling identity binding, selected F400 carrier handshake,
F600 data records, CBC/HMAC and the receive inverse.

The additional original primary artifact is
[`thingsmart-p2p-file-trans-sdk:7.5.1`](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-p2p-file-trans-sdk/7.5.1/thingsmart-p2p-file-trans-sdk-7.5.1.aar).
Its SHA256 is `70b22b37675ed7ef4d05fc97d5aeda7ea58b5bb5f7e53c8d698d5cbb06089ef0`.
The ARM64 `libThingP2PFileTransSDK.so` SHA256 is
`a07531b31f4a224d65e6595fb4325864b6c57c100a72a70b22789d920b71490a`.

The independently authored offline
[`e15_application_oracle.py`](../../scripts/research/e15_application_oracle.py)
executes this separately supplied artifact with synthetic inputs and mocked I/O.
It checks original `SendCommand` and receive callback behavior. The
`SendAuthorizationInfo` layout was separately established from the original
artifact and the preceding native authorization observation. Four request counters, four version responses and an invalid marker
were exercised. The artifact is never redistributed. No code, constants,
schemas or fixtures were copied or mechanically translated from the unlicensed
mower fork. No vendor implementation is included in the Node runtime.

KCP framing was checked against the primary author's
[protocol implementation](https://github.com/skywind3000/kcp/blob/master/ikcp.c).
The probe independently implements a bounded channel-zero subset, rather than
including native code. MQTT uses the standard 3.1.1 wire protocol. Current
signaling profiles and account/device binding were independently observed with
bounded, reversible instrumentation. Raw observations remain private.

Before the first Node transmission, the private pretransmission receipt recorded
this application contract, fresh-key/session requirements, acceptance predicate,
owned budgets, exact requests and recovery procedure. The first trial exposed a
reserved internal channel. Original native receive routing was inspected before
the second trial. It maps conversation `0x010000f3` to internal JSON signaling.
The probe ignores only this known internal channel, never counts it as application
proof, and rejects other unexpected conversations.

## Exact application contract

Application payloads are separately AES-CBC encrypted under the fresh SDP key,
carried as bounded KCP messages inside the authenticated F600 data envelope.
Fields below are little-endian. Strings are UTF-8 with zero padding.

| Message                             | Fields                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authorization, 104 bytes            | marker `0x12345678`, request counter, 32-byte username `admin`, 64-byte credential                                                                                       |
| Version request, 24 bytes           | marker u32, current request ID u32, reserved u32 `0`, main u16 `10`, sub u16 `0`, payload length u32 `4`, version u32 `0x00010000`                                       |
| Accepted version response, 24 bytes | same marker and current request ID, response flag u32 `1`, main u16 `10`, sub u16 `0`, length u32 `4`, nonzero major version in upper 16 bits and minor in lower 16 bits |

The credential is lowercase hex MD5 of UTF-8 `RTC password + "||" + local key`,
independently confirmed against the original SDK authorization path. The native
receive callback splits the version payload into major and minor values. The
probe checks every header field, exact message length and current request ID.

There is no invented standalone authentication-ack opcode. The positive
criterion is the **current-request version response after authorization**,
received under the fresh, correlated authenticated session and SDP key. A native
send return value, broker connection, carrier completion, internal signaling or
uncorrelated bytes cannot satisfy it. Only these two application requests are
sent. Neither is replayed, including after uncertain failure.

## Provisioning and execution boundary

This is an isolated research executable, not a public library API or product
installation. It consumes a private, expiring JSON input provisioned beforehand
from the independently verified account/device and current RTC/MQTT profiles.
Reusable cloud provisioning remains outside this story's peer-response scope.
The file is read locally once. The runtime does not call an Android process,
helper endpoint or emulated SDK to acquire inputs or produce the response.

The private input has these fields. Values must never be committed or logged.

| Field                                        | Meaning                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `expiresAt`                                  | Unix milliseconds, integer, with at least 60 seconds remaining          |
| `accountUid`, `peer`, `localKey`, `password` | verified private account/device binding and current RTC password        |
| `motoId`, `preconnect`, `iceTokens`          | observed current RTC signaling profile                                  |
| `tcpToken`                                   | current relay credential, username, domain and one `tcp4:host:port` URL |
| `mqtt`                                       | TLS broker host/8883, account-bound client ID, username and password    |
| `subscribeTopics`, `publishTopic`            | exact account/device topics, no wildcards or foreign targets            |
| `mqttHeader`                                 | private observed 12-byte GCM AAD profile encoded as 24 hex digits       |

The opaque header profile is supplied explicitly. Its observed sequence at
byte 7 is advanced once. No interpretation of the other opaque metadata is
claimed. Each attempt creates new signaling and carrier session IDs, SDP AES key,
ICE strings, trace ID, GCM nonce and CBC IVs. A received answer must have the
expected peer/account direction, session, moto ID, security level, current token
and SDP key. GCM authentication and a 60-second timestamp window are enforced.
Retained/duplicate MQTT deliveries and foreign or stale answers are rejected.
Token comparison is semantic and independent of JSON member ordering.

Run only with explicit live ownership, a stopped competing probe and a checked
restore procedure:

```sh
node scripts/research/e15-linux-peer.mjs /private/path/peer-inputs.json
```

The CLI refuses platforms other than Linux and Node majors other than 24. It
prints only bounded outcome names, timing and cleanup status. Malformed private
input is reported without including file contents or raw exception messages.

## Owned budgets and negative validation

[`e15-owned-trial.mjs`](../../scripts/research/e15-owned-trial.mjs) registers
resources before I/O, tracks producer promises and uses real abort timers:
15 seconds negotiation, 60 seconds total active work, 5 seconds cleanup. Test
budgets may shorten these values but cannot increase them. Negotiation finishes
only at authenticated carrier completion. Total timing continues through the
application response. Success is withheld until sockets actually emit closure
and all tracked producers settle. External cancellation during cleanup overrides
a positive candidate. Unconfirmed cleanup is always failure.

The socket, MQTT, record and KCP readers have explicit byte/message/fragment
bounds. TCP record splits and coalescing are handled. KCP deduplicates and orders
channel-zero fragments, acknowledges accepted packets and sends at most the two
application messages. There is no application/KCP retry or reconnection loop.

Regression tests cover application header and request correlation, every-byte
HMAC corruption, CBC length/padding failures, every TCP split, malformed and
oversized records, KCP duplicate/out-of-order/wrong-channel handling, stale and
wrong signaling identities, GCM tampering, invalid private routing/expiry, actual
TCP closure on timeout, active-work timeout, cancellation during cleanup and an
uncooperative producer preventing success. Synthetic tests establish rejection
behavior, not hardware support.

## Live receipt and recovery

| Stage                    | Outcome                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt 1                | Broker, fresh answer and carrier authenticated. Auth/version sent. Reserved internal KCP channel rejected. Failure and cleanup confirmed, no retry inside the attempt                                         |
| Attempt 2                | Fresh broker/signaling/carrier session, authorization and version sent once, correlated version response received. `success=true`, `reason=authenticated-read-only`, `cleanupConfirmed=true`, `elapsedMs=560` |
| Restoration              | Original APK and service unit byte-equal, native library hash verified, observation hooks/overrides removed, emulator unchanged                                                                               |
| Later normal acquisition | Normal helper restarted at `2026-09-10T21:42:46Z`, later map bundle acquired at `2026-09-10T21:42:56.564854523Z`                                                                                              |

Each live window had an independent restore timer and an EXIT restore path.
The competing Android application was force-stopped and absence of its process
was checked before the Node session. The normal source was proven usable after
both attempts. Map bytes and geometry were not published.

The successful pre-format main probe SHA256 was
`02ac5e9f3ee70bff5d285454da4e84004217b52e25332190090fdef74eb4c185`.
The retained private receipt records hashes of all six runtime modules and the
redacted result. Subsequent changes only strengthened input admission, removed
JSON ordering dependence, sanitized input errors and formatted code. The exact
observed input profile passes the stronger structural checks offline. Final
Linux tests cover the checked-in modules without another hardware session.
The final Node suite passed all 184 tests, the Linux protocol/lifecycle subset
passed all 24 tests, and the release tooling passed all 25 Python tests. The
original-artifact oracle passed four encoder and four receiver cases plus the
invalid-marker check. Temporary Linux binaries and credentials were removed
after confirming no remaining trial process or active restore timer.

Portable maps, path files, integration APIs and product deployment remain
unproven here. #49 owns the existing map-transfer acceptance, and epic #11 stays
open until the portable map capability is delivered.
