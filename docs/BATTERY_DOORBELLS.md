# Battery doorbell software evidence

Story [#25](https://github.com/keesmod/eufy-mega-client/issues/25) adds the following
bounded discovery and state/event slice in unreleased 0.8.0.

| Model/type | Adapter               | Discovery                   | Battery/availability | Motion/person/ring | Media                    |
| ---------- | --------------------- | --------------------------- | -------------------- | ------------------ | ------------------------ |
| T8213/91   | BatteryDoorbellCamera | Existing, regression tested | Observed only        | Software           | Existing route preserved |
| T8214/94   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |
| T8224/95   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |
| T8223/96   | BatteryDoorbellCamera | Software                    | Observed only        | Software           | Unverified               |

All rows require the actual admitted T8030/type 18 HomeBase owner. Transport is
the existing local LAN-derived credential path. Model/type associations use the
pinned attributed MIT catalogue and product references in
[MODEL_MATRIX.md](MODEL_MATRIX.md). This is software classification evidence,
not an observed Mega inventory from new hardware. The adapter's type predicates,
`DeviceProperties`, `Device.getPropertiesMetadata`, `DoorbellCamera` and
`BatteryDoorbellCamera` at client commit
`adcd77883d0da2fd48a48889d3a84bf6cce20973` provide the existing software semantics.
No vendor wire implementation changes. The
[synthetic tests](../test/battery-doorbell.test.mjs) use camera firmware 1.2.3 and
owner firmware 3.8.6.0. These values do not establish firmware support.

## State and identity

Discovery and `getDeviceState()` retain the inventory serial, parent serial and
channel. Available nonempty firmware remains the reported value. Missing firmware
is null. Battery uses the model's numeric battery property and accepts only
observed integer percentages from zero through 100. Missing, malformed and
out-of-range values are null. Availability uses observed `CMD_GET_DEV_STATUS`.
1 means online, 2 disabled, and 0/3/4/5 offline. Missing or invalid status is null.
No HomeBase connection or successful command becomes camera availability.

Runtime battery updates require the actual owner and channel. Raw property updates
require the actual owner. Relationship changes remove the prior adapter and its
observations. Existing observation source priority remains unchanged. State reads
do not open a P2P connection and have no new freshness guarantee.

## Events and media boundary

Existing motion/person/ring properties route true detections only. False SDK
resets do not produce actionable events. Pushes must name the actual admitted
owner and a supported property. The current T8030 metadata adds other existing
HomeBase detection properties. Their presence is not a new hardware claim.
Tests exercise property rejection, wrong-owner rejection, SDK/push settling,
cross-transport replay suppression, person identity and two distinct ring events
for every admitted tuple. An eufyCam still cannot ring, as covered by
[eufyCam regressions](../test/eufycam.test.mjs).

Classification does not grant media access. T8214, T8224 and T8223 retain typed
`camera_media_unverified` before camera-bound media operations can connect.
Existing T8213 media and T8160/T8142/T8134 identities remain unchanged. No settings,
PTZ, talkback, non-camera actuation or legacy-cloud fallback is added.

## Unsupported paths and remaining obligations

Unknown tuples and suffixes return `unsupported_device`. T8210/T8212 type 7 and
T8220/T8221/T8222 type 16 remain candidate associations. They need sanitized exact
model/type inventory evidence before admission. Unsupported parents remain
`unsupported_station`, and empty/self parents retain `invalid_device_relationship`.
No standalone owner or older HomeBase protocol is enabled. Invalid initialization
is isolated as `device_initialization_failed` without raw protocol data. Other
families continue to work in the same inventory.

- [#26](https://github.com/keesmod/eufy-mega-client/issues/26) must select its own
  exact Ready media profile before implementation.
- [#58](https://github.com/keesmod/eufy-mega-client/issues/58) retains per-model,
  firmware and topology hardware acceptance, including candidate-pair evidence,
  observed battery, real motion/person/ring events and restart recovery.
- [#35](https://github.com/keesmod/eufy-mega-client/issues/35) retains older owners
  and chime relationships. [#36](https://github.com/keesmod/eufy-mega-client/issues/36)
  retains standalone authentication and transport.
- [Camera #19](https://github.com/keesmod/ha-eufy-cam/issues/19) owns HA capability
  presentation. E2/E6 and camera migration/release acceptance remain open.

No hardware or live service is tested for #25. Dated T8213 baseline evidence in
[MODEL_MATRIX.md](MODEL_MATRIX.md) remains dated and unchanged. Software tests do
not add H cells. Version 0.8.0 requires no session-store migration. For rollback,
retain the preceding package and private store. No release is published here.
