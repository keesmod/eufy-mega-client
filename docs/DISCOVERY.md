# Discovery identities and connection owners

[Story #17](https://github.com/keesmod/eufy-mega-client/issues/17) adds
`discoverDevices()` in 0.5.0. It returns `devices`, `relationships` and `issues`.
`listDevices()` retains its `Device[]` contract and returns the same discovered
identities. Existing camera IDs, station IDs and device kinds remain unchanged.
The modular `security` client exposes both methods.

## Result contract

Each recognized device has a relationship with one of these kinds:

- `station` names the actual connection owner by `ownerId`. The HomeBase itself
  has its own ID as owner. Only the existing H3 LAN profile can open transport.
- `standalone` names the camera itself as owner. For an exact T8134/type 63
  inventory with an empty or self parent, the client retains a private standalone
  owner descriptor. The public device remains a camera with its own `stationId`.
  No HomeBase entity, alarm state, SDK station or command session is fabricated.
  Operations fail with `standalone_transport_unverified`.
- `unsupported` records `unsupported_station` or `invalid_device_relationship`.
  The recognized identity remains visible, but cannot inherit another route.

`issues` contains the zero-based inventory row `index`, a validated `deviceId`
when available, and a fixed `code`. Unknown model/type pairs produce
`unsupported_device` and no public Device. Malformed identities or relationships
produce explicit errors without removing unrelated usable devices. Duplicate IDs
are rejected for every affected security row, including a collision with an
unknown model or another category. A duplicated or malformed parent cannot own
another device. Cycles, camera-as-parent chains and dangling parents are rejected.

Non-security categories are outside this inventory. Invalid envelopes still
throw `invalid_inventory`. A response with at least 100 rows throws
`inventory_completeness_unconfirmed`, so a server cap never looks complete.
These whole-response errors leave the last accepted inventory intact.

Consumers that need admission reasons should use `discoverDevices()`. A listed
identity alone does not establish operational support. Returned results are
copies containing no raw wire data, credentials or protocol objects. The exact
model/type registry preserves T8030/18, T8160/19, T8213/91, T8142/15 and T8134/63.
It does not infer new model associations from catalogue labels.

## Transport and lifecycle

The adapter loads admitted relationships independently. Camera initialization
failure reports `device_initialization_failed` when that camera is used. Missing
owner credentials report `invalid_connection_credentials` when the owner or its
camera is used. Another owner remains usable. Errors contain no upstream payload.
Discovery itself does not require connection secrets or open device sockets.

Refreshing a relationship removes its old camera, snapshots and owner binding.
Changing owner identity/type or credentials disposes the old owner session.
Active connection, command, live or recording operations reject a transport reload
with `devices_busy`. Existing stop/cancel ownership rules remain in force.

## Software evidence and remaining work

[Discovery tests](../test/discovery.test.mjs) cover mixed inventories, stable
identifiers, copied results, empty/self standalone parents, duplicate collisions,
malformed relationships, cycles, completeness caps, isolated owner failures and
relationship refresh. [Cloud tests](../test/cloud.test.mjs) retain encrypted Mega
request validation and both S220 identities. [Family tests](../test/family-compatibility.test.mjs)
retain explicit unsupported-family and unsupported-owner operation gates.
The compiled TypeScript consumer checks both public discovery APIs.

All data and mocked owner events are synthetic. There is no new physical support
claim, firmware validation, live test, release publication or deployment.
[Standalone research #36](https://github.com/keesmod/eufy-mega-client/issues/36)
owns wire/auth evidence. [Older-owner research #35](https://github.com/keesmod/eufy-mega-client/issues/35)
owns other HomeBases. The matrix family stories own model expansion, and
[camera integration #19](https://github.com/keesmod/ha-eufy-cam/issues/19) owns
consumer capability presentation. Legacy removal is separate work.

No session-store migration is required. Retain the previous package and private
session store for rollback. The existing `Device` shape is unchanged, but callers
must account for recognized identities with unavailable transport instead of
expecting one unsupported parent to reject the entire inventory.
