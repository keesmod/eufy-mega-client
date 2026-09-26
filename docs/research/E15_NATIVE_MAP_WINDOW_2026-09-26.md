# E15 native map observation, 2026-09-26

Bounded observations on the owned E15/T2880, from the public
[migration receipt][Migration] and [moving-map receipt][Moving]. Firmware 6.9.28
is recorded in the September 25 receipt. Other hardware does not inherit this
evidence. Private captures, geometry, identifiers and credentials are omitted.

## Source migration and recovery, 2026-09-25

Library 0.24.0, bridge/app 0.12.1 and integration 0.15.4 passed source switching,
a real bridge outage, automatic native recovery and rollback. The last-good
image/cache, identities, options, existing sessions and dashboard references
survived. Recovery produced a fresh map with cancellation and cleanup confirmed.

The owner then selected native observe-only operation and retired Android. A
full archive, verified offline restoration and second checked archive copy
preceded removal. The external cache and archives remain recovery material.
Starting the archived Android restoration has not been tested.

## Stream lifecycle on library 0.25.1

With the app closed, two docked demands used fresh provisioning and the existing
session without login. Both produced three complete map files. The deadline
demand ended as `demand_expired` after 30.046 seconds, and the explicit abort as
`aborted` after 10.037 seconds. Both confirmed cancellation and cleanup. An
independent timer protected restoration of the normal bridge.

The [published 0.25.1 package][Release] in bridge/app 0.13.0 independently passed
a 30.146-second stream with a fresh map, confirmed cancellation/cleanup and no
rejected snapshot. Only state reads followed its single stream request.

## Supervised mowing window

The authorized run used the official macOS app for start, stop and dock return.
HA integration 0.16.0 and bridge/app 0.13.0 kept control/settings disabled. The
passive observer made no map requests. Cloud activity selected HA's stream mode.

For 09:53:44 to 09:55:50 UTC, the observer recorded 57 bridge publications and
56 new HA cache versions. Median intervals were 2.002 and 2.000 seconds,
respectively, with maxima of 6.048 and 6.004 seconds. The first fresh HA cache
arrived after 4.484 seconds. There were no read/map errors, and three completed
demands confirmed cancellation and cleanup.

Replay confirmed 34 tracking-position changes. HA's merge retained omitted
positions after the first tracking fix. Six successive native geometry changes
occurred with the same map identity, surviving normalization of point order and
collinear subdivisions. Geometry was not unchanged, and the changes' native
meaning remains unconfirmed.

Pause and return also passed a finite observation without errors. The owner
separately confirmed physical dock arrival. HA returned to idle acquisition
with no active stream and confirmed cancellation/cleanup. Its served idle map
visually matched the app's static features. HA hides cleaned paths while idle.

## Consumer fix and remaining limits

Integration 0.16.1, [mower PR #66][Consumer], prevents old idle coverage from
seeding a new HA task window. Recorded-data replay accepted 56 fresh revisions
and accumulated seven current paths, excluding 71 preceding paths. Source and
idle runtime verification passed at 10:25 UTC, with bridge/library unchanged.
No further mowing run tested this display fix.

HA's accumulator does not validate this library's cleaning-path history API.
Cloud-only activity adds no command or verified session-history evidence.
Existing sessions were preserved. Earlier supervised command/settings evidence
remains valid within its original scope, with no new acceptance from this run.

Longer daily use and host-reboot recovery remain untested. A connected Home
session with at most 65 seconds left can fail the map validity requirement.
Offline cases reproduce that edge. A live failure recovered after authentication
renewal and the next idle refresh. Its failing session lifetime was not captured,
so that causal link remains an inference. The renewal edge remains open in [#8][Moving].

[Migration]: https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5839090826
[Moving]: https://github.com/keesmod/eufy-robomow-ha/issues/8#issuecomment-5845487941
[Release]: https://github.com/keesmod/eufy-mega-client/releases/tag/v0.25.1
[Consumer]: https://github.com/keesmod/eufy-robomow-ha/pull/66
