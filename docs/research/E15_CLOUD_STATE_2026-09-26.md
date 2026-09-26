# E15 cloud state receipt, 2026-09-26

The owned E15's authenticated `tuya.m.device.get` version `1.0` device record
carried DP 107 activity and DP 155 work parameters together while the owner
reported that the mower was in the dock. This establishes the read route for
the separate cloud state API. It does not establish a device observation time.

## Method and observations

A private read-only probe reused the existing mower session from bridge 0.12.1
with library 0.24.0. It allowed only the required read routes and performed no
new login, session-store write, local command or setting write. It compared
the returned device ID with the existing binding inside the private process.
The retained report contains only the match result, presence and type of the
two points, decoded states and receipt times. No raw record, credentials,
identifier or map data is included here.

| UTC receipt time | Existing caller         | Binding | DP 107                                   | DP 155                              |
| ---------------- | ----------------------- | ------- | ---------------------------------------- | ----------------------------------- |
| 08:14:57.198     | Discovery               | Matched | String, confirmed decoder reports `idle` | Present, decoder reports parameters |
| 08:14:57.369     | `queryWorkParameters()` | Matched | String, confirmed decoder reports `idle` | Present, decoder reports parameters |

These observations used the already shipped record request. The probe decoded
DP 107 with the library's confirmed status definitions. The new
`queryCloudState()` API was not the caller in this receipt.

The [mission status receipt of 2026-09-25](E15_MISSION_STATUS_SCHEMA_2026-09-25.md)
separately establishes DP 107's activity meanings against the app during
mowing, return and rest. It does not establish a device timestamp either.

## Limits and consumer contract

- This receipt confirms the exact device-record route while the mower was in
  the dock. It does not prove live map movement or the new consumer's cadence.
- `observedAt` is the library's receipt time of a cloud cache. The server's
  value can be older. Consumers retain source, refresh and expiry information.
- `idle` is not evidence of docking. The same payload was observed after Stop
  on the lawn in the earlier mission receipt.
- Cloud data is not a device report and cannot confirm a command or setting
  write. The local session's read-back contract is unchanged.
- An absent DP 107 remains `missing`. Invalid or unclaimed payloads remain
  `invalid`. DP 1 is not substituted for activity.
