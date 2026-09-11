# eufyCam discovery, state and events

Story [#19](https://github.com/keesmod/eufy-mega-client/issues/19) adds software
coverage in unreleased 0.6.0. The independently authored
[regressions](../test/eufycam.test.mjs) exercise the actual private `Camera` factory,
state adapter and event route. They do not establish physical support.

## Exact scope

| Model | Protocol type | Power   | Discovery | Battery        | Availability  | Motion/person  |
| ----- | ------------- | ------- | --------- | -------------- | ------------- | -------------- |
| T8111 | 1             | Battery | Software  | Observed only  | Unknown       | Software on H3 |
| T8112 | 4             | Battery | Software  | Observed only  | Unknown       | Software on H3 |
| T8113 | 8             | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8114 | 9             | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8140 | 14            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8142 | 15            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8160 | 19            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8161 | 23            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8600 | 24            | Wired   | Software  | Not applicable | Observed only | Software on H3 |
| T8162 | 26            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8144 | 49            | Battery | Software  | Observed only  | Observed only | Software on H3 |
| T8172 | 89            | Battery | Software  | Observed only  | Observed only | Software on H3 |

Model/type associations come from the pinned, attributed catalogue and primary
product sources in [MODEL_MATRIX.md](MODEL_MATRIX.md). Fixtures use synthetic
firmware 1.2.3, not firmware acceptance evidence. H3 means an admitted T8030/type
18 inventory owner with valid local connection credentials. No additional
HomeBase or connection profile is enabled. Camera serial, parent serial and
channel remain the actual inventory values. The existing SDK adds HomeBase event
properties for its T8030 serial profile. Unsupported properties remain unavailable.

T8142R and other unresolved suffixes are not aliases. Unknown model/type pairs
report `unsupported_device`. Unsupported parents retain `unsupported_station`.
The same inventory can retain usable cameras from another family. A malformed
camera initialization reports `device_initialization_failed` without a protocol
payload. Older-owner protocols remain in #35 and standalone transport in #36.

## State contract

`listDevices()` and `discoverDevices()` include validated cloud battery and status
observations. `getDeviceState(id)` initializes the private adapter as needed and
returns the latest available device observations without opening a P2P connection.
The existing device update event carries the same fields.

`firmware` remains the reported nonempty `main_sw_version` or null. Battery is an
observed integer from 0 through 100, only where the model's property table has a
battery property. Missing values, malformed strings, booleans and out-of-range
values are null. E330 has no battery property. A supplied battery field cannot
make it a battery camera.

`availability` is an additive optional property in the public `Device` type,
returned as `online`, `offline`, `disabled` or null. It uses the existing
`CMD_GET_DEV_STATUS` property only where the model table defines it. Status 1 is
online, 2 is manually disabled, and 0/3/4/5 are offline. Missing or unknown values
are null. T8111/T8112 have no mapped status property and remain null. A HomeBase
connection, sleeping radio, push connection or successful command cannot establish
camera availability. The value is the last report, not a fresh reachability probe.

P2P runtime battery updates require the actual owner and channel and a valid
percentage. Raw device state updates require the actual owner. A changed device
relationship destroys the old camera and its observations. Existing SDK source
priority remains in place, so a lower-priority cloud refresh does not overwrite
a P2P observation. This story adds no freshness guarantee or periodic polling.

## Event contract and unsupported features

Only true SDK detections and model-supported properties enter the event route.
An eufyCam has no ring property. It cannot emit a ring, even if a push carries 3103. Existing battery-doorbell ring handling remains available. Motion/person
handling, person identity enrichment, idle-reset suppression and cross-transport
settling/replay suppression keep the existing `Detections` semantics. Unknown
notification codes retain the existing generic notification/SDK decode route.

Push routing requires the actual camera's admitted HomeBase. Wrong-owner pushes,
unsupported cameras and initialization failures cannot enter detection delivery.
HomeBase-only push messages still reach its state processor. They do not become
camera detections. The software tests include two distinct doorbell rings, one
person seen through two transports, replay suppression and invalid owner input.

Newly admitted models reject snapshots, live starts and camera-bound recording
access with `camera_media_unverified`. Their factory classification is not an
assertion about media encryption or wire compatibility. Existing T8160, T8142,
T8134 and T8213 routes are preserved. No settings or non-camera controls are added.

## Remaining obligations

- [#20](https://github.com/keesmod/eufy-mega-client/issues/20) owns eufyCam snapshots,
  live video/audio, confirmed stop, recording playback and cancellation on an
  evidenced transport profile. This story does not activate those routes for new models.
- [#55](https://github.com/keesmod/eufy-mega-client/issues/55), E2 and E6 retain
  model/firmware/topology-specific hardware acceptance, including discovery,
  observed state, real events, media and recovery. Fixture success adds no H cells.
- [Camera #19](https://github.com/keesmod/ha-eufy-cam/issues/19) owns HA capability
  presentation. Existing HA identifiers and public client methods are preserved.
- T8111/T8112 availability mapping remains unverified within E2/#55. Do not
  substitute a battery or HomeBase connection for that missing observation.

No publication, deployment or physical device operation is required for #19.
For package rollback, retain the preceding version and private session store.
There is no store migration. The next media story must read these guards before
claiming expanded functionality.
