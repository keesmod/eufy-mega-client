# E15 portable session research

Progress evidence for [#48](https://github.com/keesmod/eufy-mega-client/issues/48),
2026-09-10, based on main `1489c62610998ab92535f5326674eec3d02034c2`.
Change class: research patch. The experiment policy is original offline code,
not a portable transport implementation. The story remains open.

## Evidence and prerequisites

[#47](https://github.com/keesmod/eufy-mega-client/issues/47) is Closed / Done.
Its [latest observation](E15_MAP_OBSERVATION_2026-09-10.md) supersedes the older
firmware and RTC-input blockers. E15 firmware 6.9.28 is owner-reported on this
date, not independently read from HA telemetry.

[#40](https://github.com/keesmod/eufy-mega-client/issues/40) was Open with no
implementation handover at this session's start. The owner subsequently selected
it in a separate task. Its independently verified account/device binding still
gates a live Linux attempt. No implementation from that task was consumed here.
The two tasks agreed that #40 coordinates exclusive live account ownership.
A proposed private scoped callback supplies account UID, device identity,
local-key access, region and cancellation within the same account session.
This is coordination, not a completed interface or authenticated input proof.

The original helper and emulator were active with no service drop-ins. Their
activation times matched the #47 recovery receipt. Cache file metadata showed
continued normal publication. No helper mutation or new acquisition was executed
by this story. A proposed temporary observation was rejected before execution
by the automatic approval control. Its live slot was released immediately.
Direct user confirmation is required to resolve that tool-level block.

## Offline experiment policy

[SessionTrial](../../scripts/research/e15-session-policy.mjs) is a deliberately
network-free policy model. Its events are synthetic semantic labels. They are
not E15 wire types, parsed peer responses or a decoder specification. It is
outside the public package API and has no Android, native library, SDK emulator,
helper or transport dependency.

[Ten tests](../../test/e15-session-policy.test.mjs) passed in Node 24.21.0 on
Linux x64, using an isolated amd64 container with no network, a read-only mount,
no capabilities and bounded resources. The host uses a different architecture.
This is Linux amd64 execution under the container platform, not a physical
amd64 mower acceptance test. Container image manifest digest:

`sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`

Run with Node 24:

```sh
node --test test/e15-session-policy.test.mjs
```

The checks establish the following policy behavior:

- Any missing account binding, identifier binding, wire transport or peer-response
  evidence stops the model before negotiation. Caller-supplied flags are test
  inputs, not evidence that these prerequisites actually passed.
- Each instance consumes one attempt. Cancellation and closure cannot restart it.
- Attempt, peer and signaling-session roles must all match. The model does not
  derive these identifiers or equate them with an authorization identifier.
- Candidates can precede an answer. Duplicate, stale, foreign and out-of-order
  events cannot authenticate the model. Candidate, message and diagnostic
  storage have fixed limits.
- Negotiation ends at 15 seconds. Total active work ends at 60 seconds without
  extending the deadline after progress. Cleanup has a separate 5-second budget.
  Cleanup timeout remains unconfirmed even if a late completion arrives.
- Diagnostics contain allowlisted event names and outcomes. They exclude opaque
  identifiers, payloads, caller error text and credentials. Closing clears the
  model-owned secret buffer and drops retained correlation/message references.

Time is supplied explicitly by tests. There are no real sockets, owned live
sessions, background timers or abortable I/O in this model. Zeroing its buffer
does not erase caller-owned memory or immutable JavaScript strings. A future
runtime must implement actual deadlines, cancellation and transport disposal
before any live attempt. `portablePeerProven` always remains false, including
in the complete synthetic sequence.

## Identifier binding and response correlation

The #47 observation proves that the authorization identifier passed unchanged
to Android and differed from RTC `id`, RTC `p2pId` and outgoing
`header.sessionid`. It does not prove which field is generated where or how an
incoming answer is matched to that attempt.

A private, independently authored observer is prepared to compare those roles
in memory, check generated-UUID equality and compare incoming `from`/`to`,
`sessionid` and `moto_id` against the outgoing offer. It emits only types and
booleans. Its syntax was checked, but the live run was blocked before execution.
Consequently no new binding or incoming-message equality is claimed.

The next observation requires one normal helper cycle, a unit backup, bounded
runtime, automatic restore and subsequent normal snapshot publication. It must
use an exclusive window confirmed by the #40 task. The helper remains a
research source and cannot become a dependency of the portable prototype.

## Primary source and artifact assessment

The following primary sources were re-read on 2026-09-10:

- [Tuya P2P capabilities](https://developer.tuya.com/en/docs/app-development/android-sweeper-p2p-kit?id=Ke0et8k1te1k3),
  displayed update 2025-01-13, defines SDK connection and disconnection callbacks.
  It does not specify the bytes of an E15 authentication response.
- [Tuya IPC troubleshooting](https://developer.tuya.com/en/docs/iot-device-dev/tuyaos-package-ipc-device?id=Kcn1px33iptn2)
  describes protocol-302 offer/answer/candidate signaling and distinguishes
  receiving authentication information from authentication failure. This is
  comparison evidence, not a firmware-specific E15 protocol contract.
- [Tuya WebRTC](https://developer.tuya.com/en/docs/iot/webrtc?id=Kacsd4x2hl0se)
  documents an IPC WebRTC signaling profile. Sharing envelope field names does
  not establish that E15 uses that transport or its data channels.

The primary Tuya P2P SDK 7.5.1 AAR was re-hashed and matched the #47 SHA-256
`6271b08f479d6408758a1373e874bc7ffd4c88ad960dbd5e37bc07cbe02f679a`.
A private script used ELF dynamic symbols, PLT relocations and ARM64 direct
branch targets to inspect selected call boundaries. It did not execute the SDK,
copy its implementation into the client or create packet fixtures.

| Selected symbol                            | Direct branch target observation                                 | Limit                                                        |
| ------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `ThingSmartP2PV3::thing_p2p_rtc_send_data` | Calls `imm_p2p_rtc_send_data`                                    | The application send buffer enters another native layer      |
| `imm_p2p_rtc_send_data`                    | Contains mutex and logging calls in the direct-target projection | This projection cannot resolve indirect transport dispatch   |
| `ThingSmartP2PV4::thing_p2p_rtc_send_data` | Calls `sts_signaling_send`                                       | A distinct implementation also exists in the artifact        |
| `sts_reliable_stream_send`                 | References `sts_crypto_encrypt` and `sts_ikcp_send_mbuf`         | Does not establish this path is selected for the E15 session |
| `__sts_p2p_connection_generate_keys`       | References `sts_hkdf` and `sts_crypto_ctx_init`                  | Does not determine E15 key inputs or negotiated parameters   |
| `__sts_p2p_connection_check_auth`          | References `sts_connection_generate_auth` and `strcmp`           | Does not identify a successful E15 peer response             |

These are static branch observations. They do not establish reachability,
execution order, active backend selection, key derivation parameters or on-wire
encoding. In particular, the STS functions must not be joined to the V3 IMM
path merely because they occur in the same AAR. The native 104-byte buffer from
#47 still cannot be sent directly to an assumed TCP/UDP socket. Its returned
length remains unrelated to peer-authentication success.

## Exact remaining boundary and next action

There is still no independently specified E15 mapping from the RTC/bootstrap
and signaling identifiers to the selected transport session, no complete
transport framing/encryption contract, and no independently specified read-only
peer response that proves successful authentication. Offline policy tests and
native branch symbols cannot fill that gap. No Linux peer attempt was made.

Complete the prepared structural observation once the tool-level approval block
is resolved. Then isolate the selected native transport boundary using permitted
structural evidence, including incoming-message correlation and a known response
criterion. Do not transmit an unknown frame. Consume only the verified #40
binding before considering the bounded Linux live trial.

#48 stays open pending that evidence. Before research closure, create and link
bounded follow-ups for any unresolved protocol obligations. Do not treat this
progress PR as closing #48 or delivering portable maps. Transfer #49, lifecycle
#50, source compatibility #53 and Linux acceptance #54 remain outside this
implementation scope. [E4](https://github.com/keesmod/eufy-mega-client/issues/11)
remains open until its functional map goal is proven.
