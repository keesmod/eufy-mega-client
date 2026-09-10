# E15 signaling validation receipt

The [authorized follow-up observation](E15_MAP_OBSERVATION_2026-09-10.md)
supersedes the remaining-evidence status below. The owner confirmed firmware
6.9.28, two bounded helper cycles verified the RTC method and credential
binding, and primary-artifact analysis established the native authorization
buffer. The older findings below are retained as historical evidence.

Read-only follow-up to [#47](https://github.com/keesmod/eufy-mega-client/issues/47)
and merged [PR #68](https://github.com/keesmod/eufy-mega-client/pull/68), observed
2026-09-10. Change class: documentation patch. The
[signaling dossier](E15_MAP_SIGNALING.md) remains the protocol assessment.

## Result and evidence boundary

The installed Android helper is now identified by a dated APK digest, Android
properties and matching native libraries. Current mower firmware and the exact
mobile RTC/authentication contract remain unresolved. #47 stays open, blocked
on evidence that the available read-only sources do not contain. Neither #48
nor the functional [E4 map goal](https://github.com/keesmod/eufy-mega-client/issues/11)
is completed or started by this receipt.

All observations below were collected independently from runtime metadata,
archive digests and existing log buffers. No unlicensed implementation was read
to infer a protocol, copied or translated. No vendor binary or log payload is
included. Archive filenames describe locally retained artifacts. Their names
and hashes do not independently establish their original download provenance.

## Current runtime inventory

Both existing systemd services were active/running. Each reported an activation
time of `2026-09-08 19:45:32 UTC`. This is process evidence, not proof of a fresh
authenticated map transfer. Direct SSH to the helper rejected the default key.
The existing hypervisor container-management route provided read-only access.
No access settings were changed.

Final read-back found both services still active/running with the same
activation timestamp. The helper restart counter was 0 and the emulator counter
was 5. These are cumulative counters, not restarts caused by this inspection.
The unchanged activation timestamps show no service restart during this review.

| Item                      | Observation on 2026-09-10                          | Scope of proof                                                         |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| Running emulator          | x86_64 headless QEMU, existing x86_64 AVD          | Active process, not just an installed image                            |
| Android                   | Release 11, API 30                                 | Properties read from the running Android guest                         |
| ARM translation           | `libndk_translation.so`, ARM ABIs advertised       | Guest property, not independent compatibility testing                  |
| Active image installation | Google APIs x86_64, API 30, revision 16            | Installed `source.properties` associated with the selected AVD         |
| Android emulator package  | 36.6.11, build 15507667                            | Installed package metadata                                             |
| Android platform tools    | 37.0.0                                             | Installed package metadata                                             |
| Build tools               | 34.0.0                                             | Installed package metadata, not proof of original build tooling        |
| Command-line tools        | 22.0                                               | Installed package metadata                                             |
| Helper Python             | 3.14.6                                             | Existing virtual environment executable                                |
| Installed helper APK      | `versionCode=0`, `versionName=null`, target SDK 34 | Package-manager metadata. Use the digest instead of a semantic version |
| APK last update           | `2026-07-27 07:24:55`, as reported by Android      | Guest-reported timestamp, timezone not independently established       |

An API 31 ARM64 image is also installed. It is not the image selected by the
running emulator. Installed alternatives must not be reported as active.

The SHA-256 of the installed APK equals that of the retained helper build:

`251fab5be8ebaf8abb71e1a462d696d090115270a5fae8bbf8e42181f7674540`

The retained build file has mtime `2026-07-27T07:24:53.497977Z`. File mtimes and
package-manager timestamps are observations, not signed build attestations.
No source commit or complete reproducible build attestation was established.

| Retained artifact                         | SHA-256                                                            | Native-library comparison with matching APK |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `thingsmart-p2p-sdk-7.5.1.aar`            | `6271b08f479d6408758a1373e874bc7ffd4c88ad960dbd5e37bc07cbe02f679a` | 1 of 1 compared library matched             |
| `thingsmart-p2p-file-trans-sdk-7.5.1.aar` | `70b22b37675ed7ef4d05fc97d5aeda7ea58b5bb5f7e53c8d698d5cbb06089ef0` | 1 of 1 compared library matched             |
| `thingsmart-avlogger-sdk-7.5.1.aar`       | `957f9e93b0c2ea77a561b448befde3cee1f5ad8f74e6559e61a9a0c1f6de5355` | 1 of 1 compared library matched             |
| `tuyasmart-3.34.6.aar`                    | `01c39fdebbdce064e65409061bfe4b349f2636a709164c8ac77b4b12331df3b2` | 1 of 1 compared library matched             |

These AARs have retained file mtimes on 2026-07-24. Comparison maps each present
`jni/` native-library entry to its `lib/` APK entry and compares SHA-256. This
proves those included native bytes match. It does not attest every Java class,
the whole dependency graph, original Maven provenance or protocol compatibility.
It must not be conflated with the older 3.2.4/3.4.15 artifacts in the July report.

Installed Python distribution metadata reported `paho-mqtt 2.1.0`, `requests
2.34.2`, `urllib3 2.7.0`, `certifi 2026.7.22`, `charset-normalizer 3.4.9`, `idna
3.18`, `tinytuya 1.20.0`, `cryptography 48.0.1`, `cffi 2.1.0`, `pycparser 3.0`
and `colorama 0.4.6`. This is an environment inventory, not proof that every
distribution was loaded by the running service.

## Firmware and existing logs

Both HA E15 device records still have null software and hardware versions.
No firmware value was found in the mower config-entry version fields, the
version attributes of 25 matching HA entities, or helper configuration metadata.
Consequently `6.9.28` remains historical July evidence. The running helper and
its July installation date do not establish unchanged mower firmware.

The existing helper journal since September 8 contained 2,207 lines in the
read window. An allowlist search found no mobile API name or firmware/version
entry and no RTC, connectV3, authorization or protocol-302 marker. A bounded
read of the existing Android log buffer contained RTC/authorization markers,
but no mobile API name or retained JSON structure with the known signaling
fields. A second structural pass found only a disconnect word. Numeric version
strings from unrelated Android components were excluded from mower evidence.

These are negative findings for the inspected windows and filters. They do not
prove the events never occurred or that every possible logging format was
recognized. No log buffer was cleared, no logging level changed and no new
session requested. Raw logs were processed in memory on their owning host.

## Primary-source comparison

The [current sweeper API](https://developer.tuya.com/en/docs/app-development/android-sweeper-p2p-kit?id=Ke0et8k1te1k3),
updated 2025-01-13, and its [official sample](https://developer.tuya.com/en/docs/app-development/android-sweeper-p2p-kit-demo?id=Ke0etytca2ejx),
updated 2025-01-07, were re-read on 2026-09-10. They establish UID initialization,
device connection, callbacks and cleanup. They delegate the lower-level session
contract to the SDK. They do not specify the mobile RTC API/version, credential
derivation preimage or peer-authentication frame.

The [IPC WebRTC contract](https://developer.tuya.com/en/docs/iot/webrtc?id=Kacsd4x2hl0se),
updated 2024-11-01, documents
`GET /v1.0/users/{uId}/devices/{deviceId}/webrtc-configs`. This is an OpenAPI IPC
endpoint. It is not evidence of the E15 mobile API or its version. Its `auth`
field does not define the historical helper's MD5 derivation.

The [TuyaOS connection and authentication documentation](https://developer.tuya.com/en/docs/iot-device-dev/tuyaos-package-ipc-device?id=Kcn1px33iptn2)
corroborates protocol-302 request, answer and candidate roles and distinguishes
connection establishment from SDK-managed password/activation authentication.
It supplies no complete E15 authorization-frame encoding. Documentation advice
to clear an app cache was not executed. Such a change would disturb the retained
session baseline.

## Reproduction without changing operation

Use the private workspace handover to identify the owning HA and helper hosts.
Public readers can reproduce the primary-source comparison. Repeating device
observations requires access to the owner's existing deployment.

1. Read the current issue, PR #68 and #48 before collecting anything. Resolve
   the helper host from the existing HA integration, then verify the container
   and service identities through the established management route.
2. Read only version fields from HA registry, config and entity metadata.
   Report absent fields explicitly. Do not export registry/config files.
3. Read service activation times, selected emulator process/AVD and SDK
   `source.properties`. Use the already-running ADB server to read Android
   properties and package-manager version metadata. Do not start a new server
   if the established one is absent.
4. Hash the installed APK using its package-manager path. Hash the retained APK
   and AAR files on the helper host. Compare native entries in memory, without
   extracting or copying binaries into the library repository.
5. Read installed distribution `METADATA` name/version fields and the existing
   virtual environment's Python version. Keep installation and loaded-runtime
   claims separate.
6. Read existing journal/Android buffers with bounded windows. Emit only fixed
   known field names, types, counts and outcome categories. Never emit values
   from credentials, IDs, SDP, candidates or map data. An absent parsed shape
   is not an empty protocol message.
7. Re-read service state, PID, restart count and activation timestamps. Leave
   helper files, sessions, logging configuration and map acquisition untouched.

## Remaining bounded obligations

| Obligation              | Exact missing evidence                                                                                    | Next step and limit                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1, current firmware    | Dated firmware displayed for the owned E15                                                                | Owner reads firmware in the existing app's device-information view. Record only model, version and date. Do not initiate update or map acquisition. Budget 30 minutes                                            |
| V2, mobile RTC          | Exact API method/version, request field types, response field types and connection-ID binding             | First obtain an authoritative vendor contract or independently sourced existing sanitized transcript. Otherwise prepare the observation window below. Budget one active day within #47's remaining two-day total |
| V3, peer authentication | Credential input roles, derivation/encoding and outgoing frame structure tied to a successful peer result | Requires permitted evidence beyond the SDK lifecycle and MD5 label. Do not guess a formula, extract it from the unlicensed fork or treat IPC video auth as E15 proof. Shares V2's bounded window                 |

V1 through V3 remain in #47 and block the existing
[#48 handover](https://github.com/keesmod/eufy-mega-client/issues/48#issuecomment-5620546640).
No new product story is selected. A failure to obtain the evidence must leave
these obligations linked before any later research-closure decision.

If no authoritative contract or retained transcript is available, the proposed
operational change is temporary allowlist-only instrumentation at the existing
helper's cloud request/response and outgoing authentication boundary. It needs
separate approval because this task explicitly forbids helper changes and
disruption of existing connections. Preparation must identify exact files,
backups, a rollback command and whether instrumentation requires a restart
before approval. Do not presume a restart-free hook is possible.

The proposed approved window is at most 15 minutes including recovery, with at
most one ordinary read-only acquisition, no second session owner and no motion
or map writes. Record API name/version, structural types, ephemeral correlation
labels and success/failure. Credential values must never enter logs. A passive
packet capture of encrypted traffic cannot by itself establish derivation or
plaintext frame encoding. If instrumentation still cannot expose a permitted
derivation contract, stop at that boundary rather than extending the trial.
Restore original files and logging, then verify service identity and subsequent
normal helper acquisition. This proposal was not executed.

Album transfer [#49](https://github.com/keesmod/eufy-mega-client/issues/49),
lifecycle [#50](https://github.com/keesmod/eufy-mega-client/issues/50), source
preservation [#53](https://github.com/keesmod/eufy-mega-client/issues/53) and
Linux acceptance [#54](https://github.com/keesmod/eufy-mega-client/issues/54)
remain open functional obligations. This inventory does not establish a
portable session or justify replacing Android.
