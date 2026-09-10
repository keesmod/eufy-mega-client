# Eufy platform programme

The goal is one modular Eufy client for all known camera families and the E15
mower, including settings and portable maps without Android. Each purpose has
its own bridge and Home Assistant integration. Both bridges consume the library.

The [programme issue](https://github.com/keesmod/eufy-mega-client/issues/7) owns
scope coverage. GitHub issues and the [Eufy platform Project](https://github.com/users/keesmod/projects/1) own current work
status. This document records decisions and working rules, not a second backlog.

## Accepted product decisions

- Keep the `eufy-mega-client` repository and `@keesmod/eufy-mega-client` package.
  Preserve the existing `EufyMegaClient` API. Add `EufyClient` with independent
  `security` and `mowers` modules.
- Share public error, lifecycle and diagnostics conventions. Keep Mega security
  authentication and Eufy Home/Tuya authentication and sessions separate.
  Camera-only, mower-only and combined library clients must work independently.
  A combined library API does not require a combined bridge service.
- Camera scope is discovery, available status and battery, stored snapshots,
  live video/audio, supported events and recordings. PTZ, talkback and the full
  set of app settings are outside this first expansion.
- Cover the full known camera catalogue, including eufyCam, SoloCam, indoor,
  battery and wired doorbells, floodlight, wall-light, garage, integrated camera
  products, 4G and PoE/NVR topologies. Camera-bearing locks or parcel boxes do not
  authorize lock, door or parcel actuation.
- Classify by protocol type, model and actual topology. A marketing name such as
  S220 does not uniquely identify a device. A standalone transport owner is not
  a fabricated HomeBase alarm entity.
- Record capabilities per model, topology, firmware and feature. Recognition,
  experimental software coverage, hardware validation and an explicit blocker
  are different states. Experimental capabilities may be available, clearly
  marked. Tests with fixtures do not establish physical support.
- Unknown security credentials, stronger encryption or a missing Mega route
  remain explicit blockers. Do not silently use legacy security-cloud fallback.
- E15 includes observation, opt-in start/pause/return, independently validated
  local and cloud settings, and read-only maps. E18 remains unclaimed without
  hardware validation. Zone mowing, map editing, remote driving and automatic
  planner activation are outside the first delivery.
- Mower control requires explicit opt-in and fresh telemetry. A sent command,
  cloud response or inactive task is not proof of physical completion. Never
  automatically replay an uncertain physical command or setting write, including
  retries hidden in a transport dependency.
- Replace the Android map acquisition runtime with a portable Linux transport.
  Retain the current public map-source contract and recovery path until native
  acquisition is accepted. Completing a research story does not complete this
  feature.
- Preserve HA entity identities, dashboards, observed session history, planning
  behavior, separate session stores and explicit rollback. One selected backend
  owns a device during a transition.

## Separate bridges and integrations

The user confirmed this boundary on 2026-09-10. Each purpose owns its complete
bridge and Home Assistant integration. The shared component is the
`@keesmod/eufy-mega-client` library.

| Repository         | Responsibility                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `eufy-mega-client` | Reusable client API, security and mower protocol adapters, capability evidence and library tests |
| `ha-eufy-cam`      | Camera bridge, camera API, camera integration and camera installation/release artifacts          |
| `eufy-robomow-ha`  | Dedicated mower bridge, mower API, mower integration and mower installation/release artifacts    |

Each bridge instantiates the library independently. Camera and mower installations
have separate endpoints, credentials, sessions, persistent data, lifecycle and
upgrade/rollback paths. Either installation must work when the other is absent
or stopped. The library does not host an HTTP service or Home Assistant entities.
Mower routes and runtime dependencies belong in the mower repository.

[E5](https://github.com/keesmod/eufy-mega-client/issues/12) covers the separate
consumer paths. E5-01 through E5-03 create the dedicated mower bridge and its
API. E5-08 packages that bridge independently. Camera work remains in E5-04.
The mower integration connects to its own bridge in E5-05 through E5-07.

## Ownership and goal coverage

| Goal                                                           | Owner                         | Tracking                                                    |
| -------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| Shared public API, independent modules and capability evidence | Client                        | [E1](https://github.com/keesmod/eufy-mega-client/issues/8)  |
| Camera family and topology coverage                            | Client                        | [E2](https://github.com/keesmod/eufy-mega-client/issues/9)  |
| E15 discovery, telemetry, control and settings                 | Client                        | [E3](https://github.com/keesmod/eufy-mega-client/issues/10) |
| Portable Linux map acquisition, decoding and lifecycle         | Client                        | [E4](https://github.com/keesmod/eufy-mega-client/issues/11) |
| Separate bridges and Home Assistant integrations               | Camera and mower repositories | [E5](https://github.com/keesmod/eufy-mega-client/issues/12) |
| Hardware claims, migration and release preparation             | Owning repository             | [E6](https://github.com/keesmod/eufy-mega-client/issues/13) |

Implementation stories live in the repository that owns the change. All epics
live in the client repository and are children of the programme issue. The
existing [S220 report](https://github.com/keesmod/ha-eufy-cam/issues/10) remains
the original reporter's issue and is linked into E2 without a duplicate.

The [model/topology/feature evidence matrix](MODEL_MATRIX.md) records the pinned
catalogue, primary model sources and outstanding obligations from
[E1-02](https://github.com/keesmod/eufy-mega-client/issues/15). Every row must link
implementation, evidence and any blocker. Newly discovered protocol work gets
bounded follow-up stories rather than silently dropping the affected model.

## Story contract

Every story must state its outcome, parent epic, owning repository, exact scope,
exclusions, prerequisite issues, one- or two-day active-effort estimate,
acceptance criteria, required evidence and references. Estimates are engineering
effort, not a promise about elapsed time or autonomous-agent speed. Hardware and
access waits are tracked separately.

Ready means material design choices and prerequisites are resolved. A camera
media story must name the exact evidenced transport profile before Ready. Split
work exceeding two days by transport, behavior or validation result. Keep the
remaining obligation linked to the parent.

Research is timeboxed to at most two days. It delivers reproducible observations,
source and version references, conclusions and linked follow-up work. A proven
blocker can complete a research question while the intended feature stays open.
Do not close a parent goal just because its research children are closed.

Use these Project statuses:

| Status      | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| Backlog     | Scoped obligation with unresolved prerequisites or not yet selected  |
| Ready       | Dependencies resolved and safely executable within the stated effort |
| In progress | One explicitly selected item is being worked                         |
| Review      | The change and applicable software evidence are ready for review     |
| Validation  | Required integration, hardware or observation evidence is pending    |
| Done        | All acceptance criteria and evidence requirements are satisfied      |
| Blocked     | A specific external or protocol blocker prevents meaningful progress |

At the start of each session, read the live issue, dependencies, programme
decisions and nearest repository instructions. Check the exact current head.
At the end, update the issue and Project with completed work, remaining work,
blockers, next action and PR/evidence links. Do not start another product story
implicitly. No daily background monitoring is requested.

PRs reference their story. Avoid automatic closing keywords while hardware
validation remains pending. A merge moves work to Validation when more evidence
is required, not directly to Done. Preserve required CI and do not introduce
workflow bypasses or a second status source in local files.

## Evidence, provenance and rollout

The MIT camera protocol adaptation remains private behind library-owned public
types. Preserve its attribution and existing lifecycle/security fixes.

The existing mower fork has no declared upstream software license. It remains
the HA consumer and a functional reference. Do not copy or mechanically
translate unlicensed source, constants, schemas, fixtures or tests into this MIT
client. Use permitted sources and independently reproduced observations with
clear provenance. Do not relicense the fork or publish it through HACS as part
of this programme setup.

Keep raw captures, credentials, local keys, complete device identifiers, footage
and private lawn geometry out of GitHub, packages and diagnostics. Public evidence
uses synthetic data, redacted outcomes and source references.

Validate the exact model, firmware, topology and requested behavior. Report
unverified effects and observation gaps. Temporary live work has backups,
bounded timing, cleanup and a checked recovery path. Safety interlocks remain
enabled. Local documentation and tracking work does not require HA reloads or
physical tests.

The setup phase changes tracking, documentation and the development workspace
only. Product work proceeds per story. Release-preparation stories do not grant
publication, deployment, purchases or destructive cleanup. Apply existing
task-specific approvals, required checks and acceptance gates to those actions.

## Starting evidence

- [E15 map signaling research](research/E15_MAP_SIGNALING.md) records the
  historical helper evidence, primary Tuya contracts and proposed #48
  experiment. The [authorized observation](research/E15_MAP_OBSERVATION_2026-09-10.md)
  adds owner-confirmed firmware, runtime credential binding and the native
  authorization buffer. Portable peer authentication remains unvalidated. The E4 map capability remains open.
- [Client compatibility](COMPATIBILITY.md), [public API](API.md),
  [diagnostics](DIAGNOSTICS.md) and [attribution](../NOTICE.md).
- [Existing mower functionality](https://github.com/keesmod/eufy-robomow-ha/blob/main/README.md),
  [provenance policy](https://github.com/keesmod/eufy-robomow-ha/blob/main/docs/protocol-provenance.md)
  and [unresolved zone evidence](https://github.com/keesmod/eufy-robomow-ha/blob/main/docs/zone-control-research.md).
- [Tuya P2P map transfer documentation](https://developer.tuya.com/en/docs/app-development/android-sweeper-p2p?id=Kceuhdm0gboep)
  establishes the SDK behavior, not a complete portable E15 wire specification.
- Local deployment evidence and source conversations are indexed in the private
  Codex workspace context. They remain historical evidence until revalidated.
