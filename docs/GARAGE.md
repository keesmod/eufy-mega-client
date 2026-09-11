# Garage camera evidence

Version 0.12.0 recognizes exact T8452/type 132 and T8453/type 133 descriptors.
They appear as cameras with their reported identity and firmware. Empty or
self-parent descriptors retain a private standalone owner, without creating a
HomeBase entity. Unknown state stays null. This is discovery software coverage,
not a working camera connection or hardware acceptance.

| Model/type  | Discovery                             | Public events             | Snapshot/live/audio/recordings |
| ----------- | ------------------------------------- | ------------------------- | ------------------------------ |
| T8452 / 132 | Exact descriptor recognized           | Blocked pending transport | Blocked pending transport      |
| T8453 / 133 | Exact descriptor recognized           | Blocked pending transport | Blocked pending transport      |
| T8453 / 131 | Common-type retail mapping unresolved | Blocked                   | Blocked                        |

Standalone operations report `standalone_transport_unverified`. A supplied H3
or unknown parent reports `unsupported_station`. Neither path creates an active
garage protocol object or admits push events. Other supported cameras remain
available. Upgrade eligibility is independent of these per-operation limits.

## Evidence and missing transport

The pinned MIT-attributed source has `GarageCamera` in
[vendor device.ts](../vendor/src/http/device.ts), the exact type constants and
metadata in [vendor types.ts](../vendor/src/http/types.ts), and garage livestream
branches in [vendor station.ts](../vendor/src/http/station.ts). The existing
[isolated command fixture](../test/family-compatibility.test.mjs) exercises the
T8452 `CMD_DOORBELL_SET_PAYLOAD` commandType 1000 branch. It bypasses public
admission to test a command serializer. It does not establish authentication,
connection ownership, successful video/audio, recording access or stop ACKs.

The source baseline for this assessment is client commit
`34863d81eb3bc50dbc095ff537fe156640f7042e`. Attribution is preserved in
[NOTICE.md](../NOTICE.md). No vendor code is copied or modified by this slice.

The [model matrix](MODEL_MATRIX.md) records H3 as under evaluation for garage
models. The [current manufacturer compatibility guide](https://service.eufy.com/article-description/eufy-Security-Complete-HomeBase-Compatibility-Guide),
checked on 2026-09-11, does not list these garage models. Absence is not proof
of incompatibility, and it cannot establish a usable H3 command route.

The library's existing owner uses H3 LAN-derived credentials and local-only
transport. Non-H3 recording paths in the vendor require a cipher provider that
the library deliberately does not implement through the legacy security cloud.
A garage-class serializer alone cannot supply the missing Mega descriptor,
authentication and media/recording route. No guessed credentials or fallback
are introduced.

[Garage regressions](../test/garage.test.mjs) cover exact recognition, empty/self
parents, rejection of H3/unknown parents, unresolved common types, absent state,
blocked media/events and isolation of other families. They are synthetic tests.
No device was contacted and no live support claim is made.

## Remaining acceptance

- [#33](https://github.com/keesmod/eufy-mega-client/issues/33) remains open for a
  proven connection owner, actual GarageCamera instantiation and public event
  routing/deduplication on that route. Recognition is only part of the story.
- [#34](https://github.com/keesmod/eufy-mega-client/issues/34) remains blocked until
  one exact media profile is evidenced, including authentication, snapshots,
  live video/audio, recordings and confirmed stop/cancel behavior.
- [#36](https://github.com/keesmod/eufy-mega-client/issues/36) owns standalone
  transport evidence and [#35](https://github.com/keesmod/eufy-mega-client/issues/35)
  other connection owners. [#62](https://github.com/keesmod/eufy-mega-client/issues/62)
  retains exact hardware acceptance.

Garage-door commands, calibration, settings and other physical controls remain
outside the public API. No new migration is required. Retain the previous
package, lockfile and private store for rollback. The README remains short.
