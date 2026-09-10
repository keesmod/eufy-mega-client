# Changelog

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
