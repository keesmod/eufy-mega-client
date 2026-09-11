# SoloCam software evidence

Story [#21](https://github.com/keesmod/eufy-mega-client/issues/21) adds discovery,
observed state and event routing in unreleased 0.11.0. The
[per-model regressions](../test/solocam.test.mjs) exercise the actual private
SoloCamera adapter. They establish software behavior, not physical support.

## Model and connection scope

| Model | Protocol type | Product            |
| ----- | ------------- | ------------------ |
| T8130 | 32            | SoloCam E20        |
| T8131 | 33            | SoloCam E40        |
| T8170 | 48            | SoloCam S340       |
| T8122 | 60            | SoloCam L20        |
| T8123 | 61            | SoloCam L40        |
| T8124 | 62            | SoloCam S40 / S230 |
| T8134 | 63            | SoloCam S220       |
| T8B00 | 64            | SoloCam C210       |
| T8171 | 88            | SoloCam E30        |
| T8173 | 98            | SoloCam E42        |

Each exact model/type pair uses its actual T8030/type 18 inventory parent and
camera channel. No new HomeBase protocol is added. The pinned
[model matrix](MODEL_MATRIX.md) links identity and topology sources. The existing
MIT-attributed `SoloCamera` implementation and `DeviceProperties` come from the
vendor source at client commit `1c4d8e381aa33ce8ab8585d8e9a7fc62e9694e38`, with
[upstream attribution](../NOTICE.md). No vendor protocol code changes.

Adapter selection uses our exact family registry. The broader vendor
`isSoloCameras` predicate also includes eufyCam S4 and LTE variants, so using it
for this change would alter unrelated family behavior. eufyCam and battery
doorbell adapters are preserved.

An empty or self parent retains a camera descriptor with itself as connection
owner and `standalone_transport_unverified`. It creates no HomeBase entity,
station connection or event/media route. Other owners remain
`unsupported_station`. Unknown model/type pairs and unresolved T8124V/R suffixes
remain `unsupported_device`. An initialization failure remains local to that
camera and reports `device_initialization_failed`.

## State and events

All ten H3 profiles expose firmware when provided and battery/availability only
from validated observations. Missing or malformed values remain unknown. Zero
battery is an observed value, not a missing value. Device status does not come
from the bridge's connection flag. Local updates must match the owning HomeBase
and camera channel. Changing the owner replaces the private adapter and clears
its old observations and listeners while preserving the camera's public ID.

Motion and person events require the adapter's corresponding properties. A
SoloCam cannot emit a doorbell ring merely because an incoming event uses a ring
code. Pushes must name the camera's actual owner. Native SoloCam payloads and HB3
companions use the existing event decoder and duplicate suppression, preserving
person names when supplied. False property resets do not create detections.

Tests cover all ten actual adapters, public discovery/state, both parent forms
for standalone descriptors, wrong owners/channels, malformed observations,
per-property event rejection, native push state updates, local/push/HB3 event
correlation, replay suppression and coexistence with eufyCam S4 and doorbells.
Existing S220 command and shared family lifecycle tests remain required.
Synthetic firmware and events are test inputs, not observed hardware results.

## Media and remaining work

T8134 keeps its existing snapshot, live and recording admission, with unchanged
[S220 command regression coverage](../test/s220.test.mjs). The other nine models
return `camera_media_unverified`. Selecting SoloCamera does not enable media,
settings or physical controls.

- [#22](https://github.com/keesmod/eufy-mega-client/issues/22) owns further SoloCam
  media software on an explicitly selected, evidenced transport profile.
- [#36](https://github.com/keesmod/eufy-mega-client/issues/36) owns standalone
  transport and [#35](https://github.com/keesmod/eufy-mega-client/issues/35) other
  HomeBase owners. Candidate and unresolved variants remain in the matrix and
  those existing family/validation obligations.
- [#56](https://github.com/keesmod/eufy-mega-client/issues/56) owns scoped hardware
  confirmation. [Camera #10](https://github.com/keesmod/ha-eufy-cam/issues/10)
  retains the T8134 reporter investigation, missing audio, requested retest and
  recovery confirmation. Earlier successful discovery/state/events and recordings
  remain dated partial evidence. This software change does not resolve that issue.

Use the [community process](COMMUNITY_VALIDATION.md) for voluntary results.
Missing hardware evidence alone does not block ordinary upgrades. No hardware
trial, consumer upgrade or release publication is performed for #21.
Version 0.11.0 requires no session-store migration. Retain the preceding package,
lockfile and private store for rollback.
