# E15 session binding and remaining transport boundary

Research outcome evidence for [#48](https://github.com/keesmod/eufy-mega-client/issues/48),
2026-09-10. Change class: documentation patch. This follows the
[offline policy checkpoint](E15_PORTABLE_SESSION_2026-09-10.md) and resolves its
observation-authorization blocker. It does not implement portable map transport.

## Scope and source

The owner directly authorized full #48 execution in the executing task,
including the prepared temporary helper observation, restart, backup, automatic
recovery and subsequent normal acquisition check. #40 explicitly confirmed idle
and granted one exclusive five-minute observation window. No competing login,
refresh or Linux peer attempt was started by this story.

[#40 authentication evidence](E15_AUTH_VALIDATION_2026-09-10.md) establishes the
independent private account/device binding. Native Tuya `uid` is distinct from
the Home login name. This story did not reauthenticate through that adapter or
export its sessions. The existing helper was used only as a research source.

The device is the owned E15. Firmware 6.9.28 remains the owner's dated report,
not fresh telemetry. The APK/emulator source was preserved. The prior exact
SDK 7.5.1 artifact inventory and its evidence limits remain in
[#47's receipt](E15_MAP_OBSERVATION_2026-09-10.md).

## One bounded structural observation

An independently authored Python profiler ran around one normal helper
acquisition. Only operational function names and argument names were inspected
to locate hook points. No unlicensed implementation, schema or test was copied.
The observer evaluated equality in memory and emitted only fixed field names,
types, elapsed times and booleans. It retained no identifier values or hashes,
credentials, raw signaling, map data or geometry.

The service unit was backed up before a temporary runtime drop-in selected the
wrapper. The wrapper used the existing Python environment and service credential
boundary. A root-owned restore script and 120-second automatic timer were armed
before restart. The temporary service had a 60-second runtime limit and no
restart policy. The controller watched for acquisition return for at most
45 seconds, then restored the original service immediately.

| Elapsed          | Observed event                                                       |
| ---------------- | -------------------------------------------------------------------- |
| 2.433 s          | Bootstrap and RTC identifier-role comparisons became available       |
| 4.793 s          | Outgoing candidate observed before the outgoing offer                |
| 4.794 s          | Outgoing offer observed                                              |
| 5.428 s          | Incoming answer matched the outgoing offer's session and relay roles |
| 5.497 to 6.086 s | Incoming candidates matched the same offer roles                     |
| 9.370 s          | Helper snapshot publication returned                                 |
| 9.456 s          | Observed acquisition returned                                        |

Nested wrappers can produce repeated callback records. The receipt does not
count them as unique packets, retransmissions or independent trials. It captures
ordering at helper callback boundaries, not a complete network transcript.

## Identifier relationships

Every retained outgoing signal and incoming signal passed the relevant equality
checks below. These are observations from this one successful helper cycle.
They are not a universal schema or an independently authenticated peer identity.

| Role                                         | Observed equality                                 |
| -------------------------------------------- | ------------------------------------------------- |
| Outgoing `header.from`                       | Helper bootstrap `uid`                            |
| Outgoing `header.to`                         | Configured device ID and RTC `id`                 |
| Outgoing `header.moto_id`                    | RTC `p2pId`                                       |
| Incoming answer/candidate `header.from`      | Outgoing `header.to`                              |
| Incoming answer/candidate `header.to`        | Outgoing `header.from`                            |
| Incoming answer/candidate `header.sessionid` | Outgoing offer `header.sessionid`                 |
| Incoming answer/candidate `header.moto_id`   | Outgoing offer `header.moto_id`, also RTC `p2pId` |

The outgoing signaling `sessionid` differed from the authorization identifier,
bootstrap UID, configured device ID, RTC `id` and RTC `p2pId`. None of the retained
header-role values equalled the authorization identifier. Thus the RTC device
identity, relay identity, signaling session and authorization identifier must
remain separate roles.

The observer compared the authorization identifier with string-form results
of intercepted `uuid4` calls. The comparison was false. This does not prove its
generation method: hexadecimal formatting, another generator or an earlier
creation point were not ruled out. The transformation from that authorization
identifier to a native session handle remains unresolved.

Offer and answer projections both contained string `sdp`, list `token` and
object `tcp_token`. Candidate projections contained string `candidate`. Their
values and internal schemas were not retained. These field types do not prove
WebRTC compatibility, ICE completion, selected transport, encryption or peer
authentication. The new evidence establishes callback-level answer correlation.

## Recovery and preservation

After acquisition returned, the controller removed the story-specific runtime
drop-in and restarted the original helper. A byte comparison of the service
unit against the pretrial backup passed. The automatic timer was stopped after
restoration. The profiler, observation output and restore script were removed
from the runtime host after evidence retrieval. The unit backup remains.

- Restored helper active since `2026-09-10T19:04:08Z`.
- Subsequent normal snapshot timestamp `2026-09-10T19:04:18.443868695Z`.
- Emulator remained active since `2026-09-08T19:45:32Z`.
- Both services had no runtime drop-ins after restoration.

This proves normal helper acquisition after restoration. It does not claim
manual visual validation of the HA map. No motion, settings change, map mutation,
product deployment or publication occurred. #48 released its exclusive slot
after recovery and temporary-file cleanup.

## Research result and exact unresolved boundary

The offline checkpoint's ten synthetic policy checks passed on Linux amd64 /
Node 24.21.0 without networking. They cover ordering, stale and duplicate events,
budgets, cancellation, bounded storage and privacy. They are not real transport
deadlines or proof of disposal of a live Linux session. No Linux peer session
was created in this research.

The new observation closes the missing callback-level answer and identifier-role
correlation. The remaining barrier is below this boundary:

1. The selected native backend and mapping from authorization identifier to
   native session handle are not independently established. Static V3 IMM and
   V4 STS symbols coexist in the artifact. Symbol presence does not identify
   the path selected by this E15 session.
2. The mapping from the native 104-byte authorization buffer to encrypted,
   integrity-protected network framing is not specified. The buffer must not
   be sent directly through an assumed TCP/UDP transport.
3. No independent byte-level peer-authentication acknowledgement or read-only
   response criterion exists yet for a standalone implementation. An Android
   snapshot and native send length 104 do not supply this criterion.

Accordingly this story takes its explicit acceptance alternative: record the
exact unresolved protocol boundary. It does not claim Linux peer authentication
or a usable portable session. Sending an unknown frame would violate the agreed
experiment constraints, so no speculative Linux transmission was attempted.

## Linked obligations and completion gate

Two bounded follow-ups preserve the missing functional work:

- [#77](https://github.com/keesmod/eufy-mega-client/issues/77), at most two active
  days, identifies the selected backend, remaining native identifier binding
  and native-buffer-to-network framing/encryption contract.
- [#78](https://github.com/keesmod/eufy-mega-client/issues/78), at most two active
  days after #77, specifies authentication and read-only response criteria and
  tests an independent Node 24 Linux peer session with real timing and cleanup.

Neither follow-up is started by this research. The proposed native parent/Project
links and #49 dependency on #78 were rejected before execution by automatic
approval review as changes outside the #48 authorization. The issues exist and
are linked here, but those tracking mutations remain pending. Keep #48 open
until #49 is explicitly gated on #78, so research closure cannot mark transfer
ready. This is a tracking-authorization block after the research outcome, not a
remaining helper-recovery problem. #50, #53 and #54 retain
lifecycle, source-preservation and Linux-acceptance obligations.
[E4](https://github.com/keesmod/eufy-mega-client/issues/11) stays open until the
functional map goal is proven. Keep the existing Android map source recoverable
until that acceptance and controlled migration pass.
