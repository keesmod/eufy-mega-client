# Changelog

## 0.12.0 - Unreleased

- Record [PoE/NVR transport evidence](docs/research/NVR_TRANSPORT.md) and an offline
  admission probe. NVR media remains blocked under #38 pending its own transport.

- Allow exact family profiles to reject an H3 command-owner relationship when
  that topology is unproven. This guard does not enable standalone transport
  or change the existing admitted camera profiles.
- Add nine exact Indoor model/type pairs with native event routing and
  experimental media on the existing actual-parent T8030 H3 profile. Battery
  and availability remain unknown where no observed property exists.
  See [Indoor evidence](docs/INDOOR.md) for exact models, command branches and
  exclusions. Standalone connections and unresolved C210/C220 aliases stay
  explicit. Hardware validation remains separate.
- Add exact S100/T84A1 and S120/T81A0 recognition, observed state and native
  motion/person events. Admit S120 media only with its actual T8030 H3 parent.
  S100 media and standalone transport remain unverified. See
  [Wall-light software evidence](docs/WALLLIGHT.md). No new hardware claim.
- Add experimental Floodlight E340 (T8425) and E30 (T8426) discovery, native
  motion/person events and HomeBase 3 stored snapshots, live video/audio and
  recordings. Preserve exact owners and acknowledged stop/cancel. Other
  Floodlight models and standalone transports retain explicit blockers.
  Software evidence and limits are in [Floodlight coverage](docs/FLOODLIGHT.md).
  Refs #29 and #30. No hardware support claim is added.

- Enable stored snapshots, live video/audio and recordings for the nine additional
  exact SoloCam pairs on the existing T8030 H3 LAN-derived media profile. Reuse
  existing command envelopes, stop/cancel and independent-owner cleanup.
- Preserve T8134 admission, identifiers and firmware behavior. Newly admitted
  media retains the existing additional-H3 numeric owner firmware boundary.
  Unsupported tuples, standalone connections and other owners stay explicit.
- See [SoloCam media evidence](docs/SOLOCAM.md#h3-core-media-0120). Tests establish
  software behavior only. No new hardware support or audio-fix claim is made.
  No session migration is needed. Retain the preceding package, lockfile and
  private store for rollback. This version is not published.

## 0.11.0 - Unreleased

- Add exact SoloCam discovery, observed state and motion/person event routing for
  ten model/type pairs behind the existing T8030 HomeBase 3 owner. Select the
  private SoloCamera adapter while preserving eufyCam and doorbell adapters.
- Preserve T8134 identities and existing media admission. Additional SoloCam media
  stays explicitly unverified. Standalone descriptors identify their own owner
  without enabling an unverified connection or creating a HomeBase entity.
- See [SoloCam software evidence](docs/SOLOCAM.md). No new hardware support,
  session migration or physical control is claimed. Retain the preceding package
  and private store for rollback. This version is not published.

## 0.10.0 - Unreleased

- Add `getCameraCapabilities()` for snapshot, live and recording software admission.
  Results use the existing media and owner guards without connecting to devices.
  Available operations remain experimental. Hardware acceptance is unchanged.
- Preserve existing methods and private session stores. No migration is needed.
  Retain the preceding package and store for rollback.

## 0.9.0 - Unreleased

- Enable stored snapshots, live video/audio and recordings for exact T8214/94,
  T8224/95 and T8223/96 behind the existing T8030 H3 local LAN-derived profile.
  Require the documented numeric owner firmware branch. Preserve T8213 media.
- Validate separate E340 and C30/C31 live commands, acknowledged stop/cancel,
  bounded cleanup and failure isolation with synthetic family fixtures.
- See [battery doorbell media evidence](docs/BATTERY_DOORBELLS.md#h3-core-media-090).
  Hardware acceptance remains open. No session migration is required. Retain
  the preceding package and private store for rollback. No release is published.

## 0.8.0 - Unreleased

- Admit exact T8214/94, T8224/95 and T8223/96 battery doorbells behind the existing
  T8030 owner and select the private BatteryDoorbellCamera adapter.
- Preserve observed state, battery, firmware, owner/property-filtered detections,
  distinct ring events and replay suppression. Preserve existing camera identities.
- Keep new doorbell media explicitly unverified and retain the T8213 media route.
  Candidate type 7/16 variants and unsupported owners remain explicit.
- See [battery doorbell software evidence](docs/BATTERY_DOORBELLS.md). No hardware
  claim or session migration is added. Retain the preceding package and private
  session store for rollback. This version is unreleased.

## 0.7.0 - Unreleased

- Enable exact eufyCam model/type media profiles behind T8030 using existing
  H3 local LAN-derived command paths. Require the documented owner firmware
  branch for newly admitted models. Keep unknown profiles explicitly unsupported.
- Preserve stored snapshots, live video/audio, recording history and downloads,
  with per-model command and lifecycle fixtures. No new hardware support is claimed.
- Require the matching camera channel for local live-stop confirmation. Remove
  pending recording EOF listeners after cancellation and suppress duplicate listeners.
- Check unsupported camera-bound recording access before opening its connection.
- See [eufyCam media evidence](docs/EUFYCAM.md). Version 0.7.0 is unreleased.
  No session migration is required. Retain the preceding package and private
  session store for rollback.

## 0.6.0 - Unreleased

- Admit twelve exact eufyCam model/type pairs behind the existing HomeBase 3 owner.
  Keep unsupported owners and unresolved model variants explicit and isolated.
- Add optional `Device.availability` and `getDeviceState()`. Report observed battery
  and status values without SDK numeric coercion. Preserve existing identifiers.
- Filter detections by camera properties and actual owner, retaining event identity,
  duplicate suppression and existing doorbell ring semantics.
- Newly admitted models reject media with `camera_media_unverified` pending #20.
  Existing media routes remain unchanged. No new hardware support is claimed.
- See [eufyCam software evidence](docs/EUFYCAM.md). No session migration is needed.
  Retain the previous package and private store for rollback. This version is unreleased.

## 0.5.0 - Unreleased

- Add typed discovery relationships and per-device reasons through `discoverDevices()`.
  Keep existing `listDevices()` results and camera/HA identifier fields compatible.
- Isolate unknown models, unsupported owners and device initialization failures.
  Preserve duplicate identity, malformed relationship and inventory-cap errors.
- Represent standalone T8134 ownership without a false HomeBase or unverified
  transport. Wire/auth research remains in #36. No hardware support is added.
- See [discovery evidence and migration notes](docs/DISCOVERY.md). No session-store
  migration is required. Retain the previous package and private store for rollback.
  This version is unreleased.

## 0.4.0 - Unreleased

- Add the bounded read-only `PortableMapAcquisition` library adapter for the three
  independently evidenced E15 streams, using Node built-ins and explicit private
  RTC provisioning. No Android or remote helper runs in the acquisition path.
- Preserve complete transport files across partial, oversized, unordered or
  contradictory replacements. Demand expiry, abort, disconnect and shutdown
  close owned resources and report peer cancellation separately.
- Keep camera and mower credentials separate and preserve existing public APIs.
  Synthetic lifecycle coverage does not establish new hardware support.
- See [acquisition contract and evidence](docs/MAP_ACQUISITION.md). This version
  is unreleased. No persisted-session migration is required. Retain the previous
  package and original map source for rollback.

## 0.3.1 - Unreleased

- Accept the independently observed EU appliances Home endpoint without widening
  the host allowlist to arbitrary subdomains.
- Keep the Home login name and native Tuya account UID separate. Internal private
  connections now use the UID returned by the authenticated Tuya session.
- Verify E15 discovery, local-key equality and SID reuse with the compiled library
  on the account owner host. Public results remain free of connection secrets.
- Existing 0.3.0 prototype stores without the native UID fail closed. Reconnect
  with a fresh private mower store after retaining its backup. No production
  store migration, release publication or deployment is included.

## 0.3.0 - Unreleased

- Add an independent Home/Tuya mower authentication adapter and E15 discovery
  profile to the modular API. Public device results exclude connection secrets.
- Bound requests and session reuse, validate regional hosts and revoke private
  connection access on cancellation, shutdown and renewed discovery.
- Preserve EufyMegaClient compatibility and separate camera/mower stores.
  Default mower authentication now uses Home/Tuya when no custom adapter is set.
- Include Apache-2.0 protocol attribution and the inherited MIT app-profile notice.
- Live E15 account binding remains pending explicit approval of the prepared
  experiment. This version is unreleased and adds no hardware support claim.
- Keep each mower store private. A custom adapter retains its own session format.
  To roll back, retain the previous package and its private store backup.

## 0.2.1 - Unreleased

- Preserve duplicate-event suppression when a saved event cache is restored in
  the same millisecond it was exported. Keep the five-minute expiry bound.
- Add synthetic family, topology, command and media lifecycle regression fixtures.
  These establish software behavior only. They do not add model support.
- Consumers can update to this library version when it is published. No session
  migration is required. Retain the previous package for rollback.

## 0.2.0 - 2026-09-10

- Add `EufyClient` with optional, independent security and mower modules. Keep
  `EufyMegaClient` and all existing exports compatible.
- Give each module its own authentication state, cancellation and shutdown.
  Separate bridge consumers use separate instances and private session stores.
- Define the mower adapter and opaque session contracts. No mower protocol ships
  in this version. Without an adapter, login reports `mower_protocol_unavailable`.
- Validate module isolation and public TypeScript consumers with synthetic
  fixtures. This adds no hardware support claims or bridge deployment.

## 0.1.1 - 2026-09-10

- Include eufyCam S220 / 2C Pro T8142 and SoloCam S220 T8134 in Mega
  discovery when paired with T8030 HomeBase 3. Fixes the model exclusion
  described in ha-eufy-cam issue #10 when using the Mega backend.
- Retain the HomeBase 3 parent requirement and existing device-specific protocol
  commands. Standalone SoloCam operation is outside this change.
- Upgrade the consuming bridge to a release that pins library 0.1.1. Keep the
  previous bridge version and private session backup for rollback.
- S220 hardware validation is pending; automated tests do not establish live
  video, audio, recording or event compatibility.

## 0.1.0 — 2026-09-10

- Independent Mega authentication, session persistence and discovery for the
  initial T8030/T8160/T8213 installation.
- Explicit LAN connection credentials, with no legacy cloud API fallback.
- Library-owned typed device, event, snapshot, live, recording and Guard Mode APIs.
- Device acknowledgement and telemetry checks for stop, transfer completion and
  Guard Mode. Cancellation and shutdown retain cleanup ownership.
- FCM reconnection and persisted duplicate suppression.
- Allow delayed first AAC packets within a bounded three-second audio discovery
  window; start immediately once both media types are identified.
- MIT attribution, protocol tests and compiled GitHub package distribution.

Hardware and HA acceptance passed on the target installation, including the
agreed 11-hour-26-minute overnight observation. This does not establish full
24-hour reliability or improved battery life. See the compatibility results.
