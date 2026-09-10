# E15 signaling and native authentication observation

Research completion evidence for [#47](https://github.com/keesmod/eufy-mega-client/issues/47),
2026-09-10. This follows [PR #72](https://github.com/keesmod/eufy-mega-client/pull/72)
and the [read-only receipt](E15_MAP_VALIDATION_2026-09-10.md). Change class:
documentation patch. No portable transport implementation is included.

## Authorization and firmware

The owner explicitly confirmed current E15 firmware `6.9.28` on 2026-09-10 and
approved temporary helper changes and connection interruption for this research.
This supersedes the earlier read-only restriction for the bounded experiment.
The firmware is current owner-reported evidence. HA still does not independently
expose it. The historical July observation remains a separate dated trial.

The installed helper APK and native-library inventory are unchanged from the
read-only receipt. Camera and mower runtimes remain separate. No mower motion,
settings, map mutation, product release or deployment was performed.

## Independently observed helper cycle

The experiment used a temporary Python profiling wrapper around the existing
helper process. It did not replace the Android APK, alter the emulator or run a
second device controller. Helper source was inspected only to locate operational
hook points. No unlicensed source, schema, fixture or implementation was copied
or translated into the client. The observations below come from actual runtime
arguments, in-memory comparisons and a separately verified primary vendor artifact.

A backup of the service unit was made before activation. A temporary systemd
runtime override selected the observer. An automatic restore timer was armed
for five minutes. After the observed acquisition returned, the timer was stopped,
the override removed and the original helper restarted immediately.

| Elapsed time  | Observation                                                                           | Claim supported                                        |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2.517 s       | `tuya.m.rtc.config.get`, version `1.0`                                                | Actual mobile RTC method/version used by this helper   |
| 2.576 s       | MD5 input comparison matched the password prefix and local-key suffix, separated by ` |                                                        | `   | In-memory credential-input composition |
| 2.577 s       | RTC response and bootstrap types observed                                             | Cloud configuration reached the helper                 |
| 3.717 s       | Bootstrap JSON returned to Android                                                    | SDK input delivery                                     |
| 4.701–4.703 s | Outgoing signaling structures observed                                                | SDK-generated signaling passed through the relay       |
| 10.253 s      | Snapshot publication completed                                                        | Android-backed acquisition delivered a helper snapshot |
| 10.330 s      | Acquisition function returned                                                         | The observed helper cycle returned                     |

Duplicate trace records at the same time can come from nested Python wrappers.
They must not be counted as separate cloud requests or wire retransmissions.
A second targeted cycle was then run to close missing equality assertions.
It used the same backup and a fresh five-minute restore timer. It published a
snapshot at 9.211 seconds and returned at 9.281 seconds, after which the helper
was restored again. Each instrumented window contained one acquisition cycle.

A helper snapshot is not proof of a standalone Linux session or independent
validation of map geometry.

### Mobile RTC structure

The request's retained field projection was `devId: string`. The exact observed
method was `tuya.m.rtc.config.get`, with version `1.0`. This is separate from the
IPC OpenAPI endpoint in the earlier dossier.

The allowlisted response projection contained:

- `auth`, `id`, `p2pId`, `password` and `skill`: strings.
- `p2pType`: integer.
- `p2pConfig.auth`: string.
- `p2pConfig.skill.p2p`: integer.
- `p2pConfig.ices`: array of three entries. The first entry had `urls: string`.

The projection deliberately omits unknown keys and secret values. It is not a
complete response schema. The array observation describes its first entry,
not a guarantee that every entry has an identical shape.

### Credential derivation

A wrapper around the actual MD5 call checked its input in memory against the
helper's live `p2p_password` and configured local key. Both comparisons passed.
The observed composition is UTF-8 password bytes, two vertical-bar bytes, then
UTF-8 local-key bytes. The MD5 object exposes a 32-character hexadecimal digest.
The prepared `session_auth` was a 32-character lowercase hexadecimal string.

The second cycle independently confirmed that `p2p_password` equals the RTC
response's `password`, that `session_auth` equals the actual MD5 result, and
that the Android bootstrap carries that same `session_auth`. Every equality
was evaluated in memory and only its boolean result was retained. The resulting
observed derivation is lowercase hexadecimal MD5 of UTF-8
`RTC password || local key`, where `||` is the literal two-byte separator.
No password, local key, digest value or stable device hash was logged.
Do not substitute the separate RTC `auth` field for this credential.

### Roles and signaling

The helper supplies the account UID and per-acquisition bootstrap to Android.
Android initiates the native peer session. The mower supplies map data. The
mobile cloud/MQTT path relays signaling. A successful cloud call alone is not
peer authentication.

The observed Android bootstrap projection had string fields `uid`,
`authorization_id`, `skill`, `p2p_config` and `session_auth`. The signaling
projection contained `header.from`, `header.to`, `header.sessionid`,
`header.moto_id` and `header.type` as strings. One message projection contained
`msg.sdp`, an array `msg.token`, and `msg.tcp_token` with `credential`, `urls`
and `username`. The second cycle retained the allowlisted type values `candidate` and `offer`.
The full candidate sequence and incoming answers were not retained. Empty projected objects mean omitted/unrecognized fields, not empty
wire payloads. The second cycle confirmed that the authorization identifier passed unchanged
to Android. It did not equal RTC `id`, RTC `p2pId` or the observed outgoing
`header.sessionid`. Those identifiers must not be conflated. Their complete
binding, incoming-answer correlation and candidate ordering remain #48 obligations.

## Primary native authentication boundary

The retained `thingsmart-p2p-sdk-7.5.1.aar` was independently downloaded from
[Tuya's Maven distribution](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-p2p-sdk/7.5.1/thingsmart-p2p-sdk-7.5.1.aar).
The bytes matched the installed-helper artifact exactly. SHA-256:

`6271b08f479d6408758a1373e874bc7ffd4c88ad960dbd5e37bc07cbe02f679a`

The public SDK method `sendAuthorizationInfo` is native and has six arguments:
three integers, two strings and a final integer. Java API inspection alone does
not specify its encoding. Independent inspection of the artifact's ARM64
`ThingSmartP2PV3::SendAuthorizationInfo` routine identified a fixed outgoing
buffer at its virtual-send boundary. No vendor implementation is redistributed.

| Byte offset | Size | Native buffer interpretation                                                          |
| ----------- | ---- | ------------------------------------------------------------------------------------- |
| 0           | 4    | Little-endian marker `0x12345678`                                                     |
| 4           | 4    | Third integer argument, copied as a 32-bit word. Its protocol meaning remains unnamed |
| 8           | 32   | Zero-initialized username area. Up to 31 bytes copied                                 |
| 40          | 64   | Zero-initialized credential area. Up to 63 bytes copied                               |

The routine passes 104 bytes to its virtual-send method. The first integer
selects the session, the second is forwarded to the send operation, and the
last integer is forwarded as its timeout argument. These role names describe
the native call boundary. They are not an independently documented network
channel specification.

This is the native authorization buffer before the lower transport processes
it. It is not a captured on-wire frame and does not specify encryption,
encapsulation, session negotiation or an authentication acknowledgement.
Returning `104` from this routine is consistent with its send result. It must
not be interpreted as an authentication-success code.

### Offline reproduction with synthetic inputs

The original ARM64 routine from the hash-verified artifact was executed under
Unicorn 2.1.4 with pyelftools 0.33 and Python 3.14.6 in a temporary Linux environment. The routine entry was `0x840ec` in
this exact artifact. The public symbol, rather than the numeric address alone,
should be used when checking a different build.

The emulator loaded ELF segments, supplied synthetic object/vtable and stack
memory, and intercepted logging, the imported `strncpy` operation and the
virtual-send boundary. ELF relocation inspection confirmed the copy target was
`strncpy`. No sockets, cloud credentials, live keys or mower connection were used.

Synthetic input was session 7, both auxiliary integers zero, username `admin`,
a credential of 32 lowercase `a` characters and timeout 15000. Assertions passed
for the complete 104-byte buffer: marker, zero second word, username at offset 8
with zero padding, credential at offset 40 with zero padding, forwarded integer
zero and timeout 15000. The intercepted send returned 104 and the routine
returned 104 unchanged.

The test establishes this buffer for that synthetic case and artifact. Copy
limits come from artifact inspection. Long-input truncation, alternative P2P
implementations and transport-layer framing were not dynamically tested.
The first macOS Unicorn attempt terminated with an illegal-instruction exit.
The isolated Linux run passed. No production Python dependencies were changed.

## Recovery evidence

After restoring the original service, both helper and emulator were active.
The service unit matched its pre-trial backup and had no runtime override.
The emulator retained its September 8 activation timestamp. The restored helper
started at `2026-09-10T16:50:11Z`. Its normal snapshot cache was updated at
`2026-09-10T16:50:20.445688Z`, after the restored process started. The recent
helper journal had no failure marker in the inspected window. Cache contents
and lawn geometry were not exported.

Temporary observer files and the isolated Linux analysis environment were
removed after final recovery. The original unit backup remains available.

This demonstrates subsequent acquisition by the normal helper. It does not
claim manual visual verification of the Home Assistant map or mower movement.

## Research completion and remaining functional obligations

#47 now has current owner-reported firmware, dated helper versions, a reproduced
mobile RTC method/version, observed input and signaling projections, credential
composition evidence and a primary-artifact authorization-buffer description.
The earlier access and read-only restrictions no longer block this research.

The remaining boundary is explicit and belongs in the already planned
[#48 portable-session research](https://github.com/keesmod/eufy-mega-client/issues/48):
verify connection-ID binding, incoming message
correlation, actual transport encapsulation and authenticated peer response,
with bounded cancellation and cleanup. The SDK buffer and a successful Android
snapshot do not establish any of those for a replacement Linux client. #48
retains #40 and is not started by this research receipt.

Within #48's two-active-day timebox, stop at the first unproven transport boundary
and record a linked follow-up. Do not infer the native-send buffer is directly
writable to a TCP or UDP socket. Keep album transfer in #49, lifecycle in #50,
source preservation in #53 and Linux acceptance in #54. The E4 functional map
goal remains open after research closure.
