# Changelog

## 0.1.2 - Unreleased

- Preserve duplicate-event suppression when a saved event cache is restored in
  the same millisecond it was exported. Keep the five-minute expiry bound.
- Add synthetic family, topology, command and media lifecycle regression fixtures.
  These establish software behavior only. They do not add model support.
- Consumers can update to this library version when it is published. No session
  migration is required. Retain the previous package for rollback.

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
