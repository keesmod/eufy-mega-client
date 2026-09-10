# E15 map signaling research

The [authorized follow-up observation](E15_MAP_OBSERVATION_2026-09-10.md)
supersedes the remaining-evidence status below. The owner confirmed firmware
6.9.28, two bounded helper cycles verified the RTC method and credential
binding, and primary-artifact analysis established the native authorization
buffer. The older findings below are retained as historical evidence.

Research for [#47](https://github.com/keesmod/eufy-mega-client/issues/47), reviewed
2026-09-10. Change class: documentation patch. No transport is implemented here.

The retained experiment proves that an Android helper obtained three E15 map
streams through Tuya P2P. It does not establish a portable Linux session. The
next experiment is [#48](https://github.com/keesmod/eufy-mega-client/issues/48),
subject also to independent mower authentication in
[#40](https://github.com/keesmod/eufy-mega-client/issues/40).
The functional [E4 obligation](https://github.com/keesmod/eufy-mega-client/issues/11)
remains open.

The [read-only validation receipt](E15_MAP_VALIDATION_2026-09-10.md) identifies
the currently installed helper and matching native artifacts. It records the
remaining firmware and protocol blockers and bounded follow-up obligations.

## Evidence levels and version boundary

- **Observed, historical** means a retained description of an owned-device
  experiment. This review checked the description, not a fresh packet capture.
- **Documented** means a primary Tuya API contract. IPC/WebRTC documentation is
  comparison evidence, not proof of E15 compatibility.
- **Hypothesis** means an experiment is still needed before implementation.
- **Unresolved** means the available evidence cannot specify that boundary.

The historical baseline is E15 firmware `6.9.28`, iOS app `6.0.50`, build
`260612140706`, and Home Assistant `2026.7.3`. The initial map observation was
2026-07-23. The file also records a 2026-07-27 streaming canary and identifies
its Android callback version as `7.5.1`. That callback label must not be treated
as the version of every dependency in the earlier probe.

On 2026-09-10, a read-only check of the current HA device registry returned two
E15 records with null software and hardware versions. A version-field-only
inspection of the existing mower config entry returned no firmware value.
These metadata checks do not establish current firmware or current helper
health. No session was opened, helper restarted, app instrumented or device
command issued. Current-firmware equivalence therefore remains unvalidated.
The follow-up receipt moves #47 to Blocked until a dated firmware baseline and the remaining
signaling evidence have been reconciled. A documentation merge alone does not
satisfy that gate.

## Sources and reproduction

Primary pages were read on 2026-09-10. Recheck their displayed update dates when
reproducing this review. No vendor source or binary was copied into the client.

| ID  | Source                                                                                                                        | Version or locator                                                                          | What it supports                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| T1  | [P2P Download from Robot Vacuums](https://developer.tuya.com/en/docs/app-development/android-sweeper-p2p?id=Kceuhdm0gboep)    | Updated 2023-03-09, connection, download and destruction sections                           | SDK lifecycle and automatic reconnect control                   |
| T2  | [P2P Capabilities (New)](https://developer.tuya.com/en/docs/app-development/android-sweeper-p2p-kit?id=Ke0et8k1te1k3)         | Updated 2025-01-13, initialization, connection, download and listener sections              | UID initialization, album and continuous file transfer          |
| T3  | [WebRTC](https://developer.tuya.com/en/docs/iot/webrtc?id=Kacsd4x2hl0se)                                                      | Updated 2024-11-01, configuration and signaling API tables                                  | Public IPC configuration and message structure, not E15 support |
| T4  | [Live Preview and Two-Way Talk](https://developer.tuya.com/en/docs/iot-device-dev/tuyaos-package-ipc-device?id=Kcn1px33iptn2) | Updated 2026-06-29, authentication and connection troubleshooting                           | Proprietary P2P distinction and protocol-302 exchange           |
| H1  | Private `2026-07-23-e15-map-transport.md`                                                                                     | Last modifying commit `3e156056a65437249c0955f67fe3299f345e612d`, includes July 27 addendum | Historical E15 acquisition and callback observations            |
| H2  | Private `p2p_helper/README.md` and ADR 0003                                                                                   | Re-read 2026-09-10                                                                          | Existing helper ownership, lease and recovery contract          |

H1 SHA-256 is
`ef85b96e083163c14c5a422e880a61e336ae19097f7aacd7daf145490f13da7a`.
H2 README SHA-256 is
`41433ac56050091e6ae327a717ef2cccce3bfe5515070476a1d205ec46514d43`.
These identify prose evidence, not private captures or map payloads. The private
workspace handover locates them. Public readers can reproduce the documentation
comparison but cannot independently inspect the original device trial from
these hashes alone. Its raw gateway capture was deleted after the original
analysis, so byte-for-byte replay is unavailable.

H1 records these Tuya Maven coordinates and artifact digests. They identify the
historical inspection only. This review did not download or re-hash the AARs.
Obtain any needed artifacts through Tuya's authorized distribution and verify
both provenance and permitted use before inspection. Do not substitute newer
artifacts or redistribute them.

| Historical artifact                                 | Recorded SHA-256                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `com.tuya.smart:tuyasmart-sweeper-p2p:3.2.4`        | `5d0f815fdbe17f5d7a51291f5d5cd4a1f2ad8646f909e3dacbf5ed6a6ac2b8f8` |
| `com.tuya.smart:tuyasmart-p2p-file-trans-sdk:3.2.4` | `aab9d0a9227be4376aebdb04bbb15c833e850d0538d929b69cd6f636b0dbb9ea` |
| `com.tuya.smart:tuyasmart-p2p-sdk:3.4.15`           | `e40c44daf5c53a86d7a6cf257ea5ffd9d0f0fd7036d9665d2f375176a96fab4f` |
| `com.tuya.smart:tuyasmart-p2p-sdk-api:3.4.15`       | `6da4316a49b65041b026b4e0c2a28c8e5811fda28ba4f04e4b3b2d01d7c64828` |

No unlicensed mower implementation, schema, fixture or constant table was used
to write client code. The following is a fresh assessment of recorded behavior
and primary documentation. It is not a translated implementation specification.

## Roles and boundaries

The client is the session initiator and owns its connection identifier and
cleanup. The mower is the peer and map-file producer. The authenticated mobile
cloud connection relays signaling. Successful broker login proves access to that
relay, not peer authentication. The native Android SDK historically performed
the transport negotiation and peer authorization. The file-transfer client then
attached to the established session handle. These are distinct success gates.

The existing helper exposes a private authenticated map source to HA. Its HTTPS
bearer/HMAC and certificate pin belong to the helper-to-HA boundary. They are
not evidence for the mower's P2P authentication and must not be sent as RTC
credentials. Camera Mega credentials and sessions have no role here.

## RTC configuration and authentication inputs

H1 records a generated connection identifier, RTC configuration retrieval,
account UID, device ID, skill, P2P configuration and an MD5-derived session
credential. The credential was required both at `connectV3` and in a later
authorization frame. An early probe reversed the identifier and credential.
Correcting that boundary preceded the successful album/download result.

H1 does **not** record the exact RTC mobile endpoint/version, full input order,
credential preimage/encoding, authorization frame bytes, integrity protection or
success response. Naming MD5 does not supply those missing facts. Do not guess
a local-key derivation or implement a hash from this description. These are
explicit prerequisites for a clean portable implementation.

T3 documents an IPC cloud API at
`GET /v1.0/users/{uId}/devices/{deviceId}/webrtc-configs` with `auth`, `moto_id`,
`skill`, `p2p_config` and `supports_webrtc`. Its ICE entries contain `urls`,
`username`, `credential` and `ttl`. The separate MQTT configuration contains
connection credentials, topics and expiration. This public API is not proven
to replace the Eufy Home mobile RTC call.

| Input category                  | Handling for the experiment                                                   | Evidence status                                    |
| ------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| Account UID and device binding  | Obtain through the independently owned mower auth module, keep values private | H1 historical, T2 UID contract                     |
| Connection/session identifier   | Fresh per attempt, correlate only within that attempt                         | H1 historical, exact E15 representation unresolved |
| RTC skill and P2P configuration | Validate types and expiry, preserve privately without inventing defaults      | H1 historical input roles                          |
| Peer authorization material     | Keep only in memory, document provenance and encoding before use              | H1 names derivation but does not specify it        |
| Cloud and ICE credentials       | Keep separate from peer authorization and helper bearer                       | T3 comparison, E15 mapping unresolved              |
| Device activation information   | Never infer from camera or helper credentials                                 | T4 SDK-managed input, E15 mapping unresolved       |

## Message order and signaling

H1 supports this partial order. It is not a complete E15 wire transcript.

1. Generate the connection identifier and request RTC configuration using the
   authenticated mower account.
2. Initialize native P2P and file transfer, using the account UID.
3. Make the signaling relay available before initiating the native connection.
4. Invoke `connectV3` with the correctly mapped identifier, credential, skill
   and configuration. Relay SDK-generated protocol-302 messages through the
   authenticated mobile MQTT channel.
5. Send the session credential in the peer authorization frame. Require session
   success before attaching the transfer client.
6. Query `ipc_sweeper_robot` and request only the returned allowlisted files.
   H1 reports completion for `map.bin.stream`, `cleanPath.bin.stream` and
   `navPath.bin.stream`.
7. End the owned download and release its session and library resources.
   A download stop alone is not proof that the peer channel has closed.

T4 describes connection configuration, a client connection request, a device
answer and candidate messages in both directions. Its troubleshooting names
`tcp_token`, `token` and `sdp` in requests, and `answer`, `tcp_token` and `sdp`
in replies. It treats authentication after connection as a separate gate using
SDK-managed P2P password and activation information. This corroborates the
layer separation, not the missing E15 frame encoding.

T3's comparison envelope uses `protocol`, `pv`, `t` and `data`. The latter has
`header` and `msg`. Header fields include `from`, `to`, `sessionid`, `moto_id`
and `type`. Types cover offer, answer, candidate and disconnect. Offer fields
include `mode`, `sdp`, `stream_type` and `auth`. Do not copy a video offer into
a mower session. Its timestamp table says seconds while examples look like
milliseconds. Resolve units against independent evidence before serializing.

No retained sanitized E15 transcript demonstrates exact offer/answer bodies,
candidate ordering, retransmission rules or identifier binding. Candidate
traffic may interleave with the answer. A state machine must not impose an
unevidenced total ordering. The historical UDP 3478 and high-port exchanges
support a NAT-negotiation hypothesis. They do not prove DTLS/SCTP, a WebRTC data
channel, encryption choices, or Tuya file-transfer framing on Linux.

## Transfer and lifecycle implications

T2 documents UID initialization, a device connection with mode and timeout,
then album query and download. `.stream` remains open until the producer stops
or the consumer cancels. Disconnect and deinitialization are separate actions.
T1 likewise separates download stop from P2P destruction and exposes a switch
for automatic reconnect. The experiment must disable implicit reconnect and
own every retry explicitly.

H1's native channel-5 result is historical evidence, not a portable transport
constant ready for import. Its callback observations concern data after native
transport processing. Packet-index and stream-delta findings cannot substitute
for an independently evidenced wire decoder.

H2 retains a 30-second demand lease, slower idle acquisition, bounded latest
values and last-good-map preservation. That lease is a helper policy. It must
not be confused with a device heartbeat timeout. Preserve the helper and its
cache until transfer, lifecycle and migration acceptance pass.

## Portable-session experiment for #48

This is a proposed experiment, not executable protocol code or a completed
hardware test. It fits a two-active-day research budget. Stop at the first
boundary for which permitted evidence is missing and record that boundary.
Do not spend the timebox guessing credentials or importing the unlicensed fork.

### Preconditions

- #40 supplies independent Eufy Home/Tuya account discovery and device binding.
- Reconcile the actual firmware, helper build and dependency manifest with H1.
  Do not claim that the July baseline is current. Record absent evidence.
- Resolve RTC endpoint/version, credential derivation and frame encoding from
  permitted sources or a separately authorized structural observation before
  transmitting a replacement handshake.
- Use an isolated Linux amd64 process with Node 24, exact dependency versions,
  source commits and licenses recorded. It must load no Android runtime,
  vendor native library or remote helper transport.
- Keep the Android source installed and recoverable. A future test needs an
  agreed single-owner window. Do not stop the helper or contend for the same
  device while preparing this documentation.

### Procedure and proposed limits

The limits below are experiment policy, not measured E15 protocol values.

1. Run offline state-machine checks using newly authored synthetic events.
   Exercise answer-before-offer, duplicate/stale session messages, timeout,
   cancellation and missing configuration. Reject an unrelated peer/session.
   Verify that secret-bearing inputs never reach the logger.
2. In an authorized read-only test window, obtain fresh account/RTC inputs.
   Record only field names, coarse types, expiry validity and success/failure.
   Do not print endpoint addresses, identifiers, SDP, candidates or credentials.
3. Make one connection attempt with a fresh identity, a 15-second negotiation
   deadline and a 60-second overall wall-clock budget. Cap the signaling queue
   at 64 messages and each accepted message at 64 KiB. Exceeding a limit aborts
   the attempt. No automatic reconnect or uncertain-message replay.
4. Exchange only independently specified session signaling. Measure separately
   cloud access, correlated peer answer, transport establishment and peer
   authorization. A socket or ICE success must not mark authorization passed.
   If the next frame is unknown, stop before sending it.
5. Require an authenticated peer response to a documented read-only session
   operation. Name that operation and its permitted provenance before the live
   attempt. If none can be specified, report an unusable session boundary.
   Album and payload transfer remain the separate #49 obligation.
6. On success, failure, deadline or cancellation, close every owned socket,
   subscription, timer and session. Allow at most 5 seconds for cleanup, then
   terminate the isolated process and report remote cleanup as unconfirmed
   unless there is evidence for it. Verify zero owned local handles and a
   successful subsequent Android acquisition during the agreed recovery window.

A result record contains the experiment revision, runtime/platform versions,
firmware, source manifest, monotonic event offsets, phase, outcome category and
cleanup confirmation. Use per-run labels such as `peer-A`, never stable hashes
of device IDs. Do not retain raw messages, map geometry or vendor artifacts.
Logs are constructed from an allowlist, not redacted after writing payloads.

### Decision gates and linked work

| Result                                                | Claim allowed                                              | Next obligation                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login and RTC configuration only                      | Cloud bootstrap observed                                   | #48 must identify the missing peer boundary                                                                                                                             |
| Correlated answer or transport only                   | Signaling or transport observed                            | #48 must prove authorization and a usable read-only session                                                                                                             |
| Authorized read-only peer response plus cleanup       | Portable session research passes for the recorded baseline | [#49](https://github.com/keesmod/eufy-mega-client/issues/49) proves album and file transfer                                                                             |
| Missing derivation, unknown framing or failed cleanup | Exact research blocker, not Linux support                  | Keep the boundary linked under #48 before any research closure                                                                                                          |
| Successful file transfer                              | Acquisition evidence for that baseline                     | [#50](https://github.com/keesmod/eufy-mega-client/issues/50) lifecycle and [#54](https://github.com/keesmod/eufy-mega-client/issues/54) architecture/cleanup acceptance |

The existing map-source compatibility obligation remains in
[#53](https://github.com/keesmod/eufy-mega-client/issues/53). None of these results
permits removing Android, deploying a new bridge or claiming E18 support.

## Story acceptance read-back

The review delivers roles, known inputs, partial message ordering, primary
source versions, explicit uncertainty and a concrete experiment. Current
firmware equivalence and the missing E15 RTC/authentication structure remain
unvalidated. #47 stays open pending that evidence. #48 receives this plan and
keeps its #40 dependency. No next product story was started.
