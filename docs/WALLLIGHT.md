# Wall-light camera software evidence

Story [#31](https://github.com/keesmod/eufy-mega-client/issues/31) adds exact
recognition, observed state and event routing to unreleased 0.12.0. Tests use
synthetic inventories and the actual private protocol classes. They do not
establish physical support.

## Recognition, state and events

| Model | Type  | Product                   | Battery                          | Availability                |
| ----- | ----- | ------------------------- | -------------------------------- | --------------------------- |
| T84A1 | 151   | Wired Wall Light Cam S100 | Unknown, no mapped property      | Unknown, no mapped property |
| T81A0 | 10005 | Solar Wall Light Cam S120 | Validated observation or unknown | Unknown, no mapped property |

The exact pairs come from the [model matrix](MODEL_MATRIX.md). Their firmware is
reported only when supplied. The attributed `DeviceProperties` at client commit
`34863d81eb3bc50dbc095ff537fe156640f7042e` has no `DeviceState` mapping for either
model. A generic status parameter or a connected HomeBase therefore cannot turn
availability into online. T84A1 also has no battery mapping. T81A0 accepts observed
zero and rejects malformed or out-of-range battery values.

The existing `WallLightCam` class is reused because it decodes native motion and
person push messages and updates detection state. These are concrete differences
from generic `Camera`. No new family adapter or vendor protocol is introduced.
The MIT camera source retains its [attribution](../NOTICE.md).

Each camera keeps its actual inventory parent, channel and public identifier.
A T8030/type 18 parent selects the existing station route. An empty or self
parent retains a camera descriptor with `standalone_transport_unverified`,
without creating a HomeBase entity, opening a connection or enabling events.
Other owners return `unsupported_station`. Unknown or mismatched model/type pairs
return `unsupported_device`. Adapter initialization failures remain local to the
camera. Changing an owner removes old listeners and observations.

Only motion/person properties enable their respective detections. Ring codes
cannot produce a ring on these cameras. Native pushes, H3 companion messages,
local detections and replay use existing owner checks and duplicate suppression.
Unknown names stay unknown. Light settings, PTZ, talkback and other controls are
outside these stories.

[Wall-light tests](../test/walllight.test.mjs) cover both exact adapters, public
inventory/state, unsupported variants, bad initialization, wrong owners/channels,
unknown state, observed battery, parent changes, native push state conversion,
event correlation and standalone descriptors alongside other camera families.

## Media and remaining work

Recognition does not grant media. Story
[#32](https://github.com/keesmod/eufy-mega-client/issues/32) separately owns a
bounded media profile. The current implementation keeps media unverified for
both Wall-light models while that profile is assessed.

[#36](https://github.com/keesmod/eufy-mega-client/issues/36) retains standalone
transport and [#35](https://github.com/keesmod/eufy-mega-client/issues/35) other
HomeBase owners. [#61](https://github.com/keesmod/eufy-mega-client/issues/61)
retains hardware validation for exact model, firmware, topology and feature.
These software changes do not close those obligations.

The [community process](COMMUNITY_VALIDATION.md) accepts voluntary results.
Missing hardware evidence alone does not block ordinary upgrades. No live test,
consumer deployment or release publication is performed here. There is no
session-store migration. Keep the preceding package and lockfile for rollback.
