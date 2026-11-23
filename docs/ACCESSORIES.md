# HomeBase accessories, 0.31.0

Version 0.31.0 adds three accessory categories through
[ha-eufy-cam#275](https://github.com/keesmod/ha-eufy-cam/issues/275). They are
not cameras and not stations. They never offer media, never own a connection and
accept no command. Every reading is unconfirmed implementation, not yet confirmed
on hardware. See the [model matrix](MODEL_MATRIX.md#homebase-accessories) for the
reported tuple and its status.

| Model | Type | Category       | Admission                                    | Readings                  |
| ----- | ---- | -------------- | -------------------------------------------- | ------------------------- |
| T8900 | 2    | `entry_sensor` | Under an admitted HomeBase 3 T8030           | Contact open, battery low |
| T8960 | 11   | `keypad`       | Under an admitted HomeBase 3 T8030           | Battery low, charging     |
| T8026 | 600  | `chime`        | Its own parent, never connected or contacted | None, recognized only     |

The Entry Sensor T8900 and the Keypad T8960 are Eufy Security accessories in the
pinned catalogue (`SENSOR` 2 and `KEYPAD` 11). The T8026 is a doorbell chime in
Eufy's own product pages. Type 600 is not in the pinned catalogue, and no
permitted source describes its protocol, so the client recognizes it and offers
nothing else.

## Admission

Only these exact model and type pairs are admitted, in a table separate from the
camera and station profiles. The [device profiles](DEVICE_PROFILES.md) list them
apart. `Device.kind` stays `'station' | 'camera'`, and `listDevices()` never
contains an accessory.

- An entry sensor or keypad needs a parent that is an admitted HomeBase 3 owner.
  An empty or self parent gives `invalid_device_relationship`. A missing, foreign
  or non-HomeBase-3 parent gives `unsupported_station`.
- A chime must be its own parent. An empty parent gives
  `invalid_device_relationship`, any other parent `unsupported_station`.
- Another type, such as T8900 with type 3, and neighbour models such as the
  T8910 motion sensor or the T8028 chime keep `unsupported_device`.
- A rejected accessory issue carries the received `deviceModel` and `deviceType`,
  like an unsupported device.

An accessory never enters the camera, owner, relationship, media, recording,
snapshot or live paths. Every camera and station operation rejects its ID. No
lookup, session or command is ever sent to a chime.

## API

- `discoverDevices()` returns `accessories`, admitted accessories in inventory
  order, each with `id`, `index`, `stationId`, `category`, `model`,
  `deviceType`, `name`, `firmware` and `hardware`. `stationId` is `null` for a
  chime. `listAccessories(signal?)` returns the same list from a new discovery.
- `getAccessoryState(id)` returns the readings without I/O. A rejected accessory
  fails with its discovery code, any other non-accessory ID with
  `unknown_device`. A failed HomeBase keeps its accessories' last values.
- The `accessory` event carries an `AccessoryState` whenever a reading changes
  its value, its source or `live`. A repeated equal value refreshes
  `observedAt` without an event.
- `accessoryObservation` holds the delivery counts below, synchronously.
- `accessoryParameters(id)` returns which parameters a keypad or an entry
  sensor reported, see [keypad parameters](#keypad-parameters) and
  [entry sensor parameters](#entry-sensor-parameters).

Each reading is `null` until a value is known, else
`{ value, source, observedAt, live }`. `source` is `p2p`, `push` or `cloud`.
`observedAt` is when this client received the value, for `cloud` when discovery
read the inventory. `live` is true when P2P or a push reported the value since
the HomeBase session last closed. A `cloud` value is never live.

## Delivery

State comes from the HomeBase's own local session and from the account's push
notifications. Beyond the existing discovery, the client's only request for
accessories is the device information below, which it repeats about every 5
minutes since 0.31.3. It does not refresh the cloud after a notification, which
the upstream library does through legacy routes.

1. P2P hub notify update (1829). The vendored session now passes on the
   parameters of this notification as `param report`, at most 32 per frame.
   Each entry's `dev_type` names the reporting channel. A third-party report
   observed contact state in it on a HomeBase 2. Whether a HomeBase 3 sends it
   is unknown.
2. P2P sensor status (1550), the legacy entry sensor notification, keyed by the
   message channel.
3. The HomeBase's device information (CMD_CAMERA_INFO), which the client already
   requests after every connect. Since 0.31.3 it requests it again about every
   5 minutes while the session of a HomeBase with an admitted accessory is open.
   A round is skipped while that session runs a live stream, a recording
   operation or a command, and the next round follows 5 minutes later. Each
   reply also refreshes that HomeBase's guard mode and camera values and adds
   to the `camera_info` count. The vendored Station maps only devices in the
   station wire, which reaches the keypad. Since 0.31.1 the Station also passes
   on every channel's parameters as `camera info params`, and the client maps an
   entry sensor's channel itself, as for 1829. Since 0.31.3 the reply's encoded
   entries (`db_bypass_str`) follow the plain ones in that event, decoded as the
   Station decodes them for a device in the wire, so an encoded entry overrides
   a plain one of the same type ([ha-eufy-cam#306](https://github.com/keesmod/ha-eufy-cam/issues/306)).
   An entry sensor therefore gets
   its starting values when a session opens, if the HomeBase lists them. A
   T8030 on 3.8.8.0 does: in the four downloads for
   [ha-eufy-cam#286](https://github.com/keesmod/ha-eufy-cam/issues/286) taken
   with a 0.31.3 beta while the HomeBase was connected, every entry sensor had
   its contact value over P2P while no other P2P route counted. Other channels
   are skipped without a count.
4. The door sensor push (event type 3) with `sensor_open`, only for an entry
   sensor whose own, available HomeBase sent it. Eufy sends it only while the
   app's notifications for that sensor are on. Every push that names an
   admitted accessory is consumed and never reaches detections.
5. Inventory values at discovery, labelled `cloud`. They fill only a reading
   without an observation and never replace a P2P or push value.

Keys follow the vendored property tables: contact 1550 (1 open, 0 closed),
entry sensor battery low 1552 (0 or 1), keypad battery low 1653 (0 and 2 normal,
1 low) and keypad charging 1655 (0 and 2 not charging, 1 and 3 charging). Any
other value is dropped. On a HomeBase 3 with firmware 3.8.8.0 a reporter
confirmed the entry sensor polarity, and an entry sensor battery reads normal
there. A keypad there sends 1653 = 2 with a full battery, and 1655 = 1 while it
charges and 2 while it is unplugged, as a reporter confirmed. Whether 1653 = 1
means low and what 1655 = 0 or 3 means is not yet confirmed, see
[keypad parameters](#keypad-parameters). Three of four entry sensors there
showed their battery as unknown, see
[entry sensor parameters](#entry-sensor-parameters).

A channel maps to an accessory only when exactly one admitted accessory of that
HomeBase uses it and no camera of that HomeBase does. A push with an event time
older than the newest report of the current value never replaces it. Push event
times are compared with push event times. A P2P report counts at its local
receipt time less 2 seconds, because the push clock differs and often has
one-second resolution. A push without an event time, or with one more than five
minutes ahead of local time, applies, and a difference from a value that P2P reported is
counted. Nothing is discarded because of elapsed time alone. When the
HomeBase session closes, every reading of its accessories keeps its value and
becomes not live, with one event per changed accessory.

## Delivery observation

`accessoryObservation` holds numbers only, since the device transport was
created. It carries no serial, channel, name, value or time. ha-eufy-cam
forwards these keys unchanged.

| Key                | Counts                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `hub_notify`       | Known, valid accessory parameters in hub notify updates (1829)                                                |
| `sensor_status`    | Valid legacy sensor status notifications (1550) for an entry sensor                                           |
| `push_door_sensor` | Door sensor pushes that set or confirmed an entry sensor reading                                              |
| `camera_info`      | Known, valid keypad and entry sensor parameters from device information                                       |
| `cloud_seeded`     | Readings that discovery seeded from inventory values                                                          |
| `conflicts`        | Dropped older pushes, plus applied pushes without a usable event time that differed from a P2P-reported value |
| `unknown_channel`  | Reports whose channel is no single admitted accessory of that HomeBase                                        |

A HomeBase without an admitted entry sensor or keypad counts nothing and gets
no new handling.

## Keypad parameters

Since 0.31.3, [ha-eufy-cam#286](https://github.com/keesmod/ha-eufy-cam/issues/286).
A reporter's keypad showed not charging while it charged, and its battery stayed
unknown while the eufy app showed it full. The vendored table gives 1653 only as
a boolean. `accessoryParameters(id)` returns the evidence, synchronously and
without I/O, or `null` for an ID that is no admitted keypad or entry sensor.

It holds one entry per route: `cloud` for the inventory row of the latest
discovery, `camera_info` for the device information with its encoded entries and
the session's other parameter reports for the keypad, and `hub_notify` for hub
notify updates (1829). Each entry lists the parameter types that route carried
for the keypad, at most 64 besides the battery keys, and in `codes` the newest
raw value of the battery keys only: 1101 battery level, 1653 battery state, 1654
battery temperature state and 1655 charger state. A value that is not an integer
of at most six digits is `other`. No other parameter value is kept, so keypad
codes and settings never leave the client. This evidence changes no reading,
count or event. A value that no reading accepts still sets no reading, but shows
in `codes`.

On 2026-11-23 that keypad, a `T8960` under a `T8030` on 3.8.8.0, sent 1653 = 2,
1654 = 1 and 1655 = 2 both in the inventory and in the device information, with
no battery level 1101 and no hub notify update. The eufy app showed its battery
full, with a charging symbol in one screenshot and without one in another.
Since 0.31.3 a keypad's 1653 = 2 therefore reads as battery normal. The keypad
sends no battery level, so there is no percentage.
The report does not say whether the keypad was charging when the diagnostics
were taken. 1655 = 2 is not charging in the vendored conversion, and another
`T8960` sent 2 while unplugged
([eufy-sdk#494](https://github.com/mega-yfue/eufy-sdk/issues/494)).

With client 0.31.3-beta.4 the reporter then took one download while the keypad
was plugged in and the eufy app showed it charging, and one after unplugging it,
each after a bridge restart ([report](https://github.com/keesmod/ha-eufy-cam/issues/286#issuecomment-7096211834)). The device
information had 1655 = 1 while charging and 2 while unplugged, and 1653 = 2 in
both. The inventory kept 1655 = 2 in both, so its value can be out of date. Home
Assistant showed charging, then not charging, with a normal battery each time.
No hub notify update arrived in either session.

The reporter then plugged the keypad in while the session stayed open. Ten
minutes later Home Assistant still showed not charging
([report](https://github.com/keesmod/ha-eufy-cam/issues/286#issuecomment-7100742982)).
The download held one device information reply, with 1655 = 2, and no hub
notify update. The HomeBase therefore sent no update for the change, and the
client read the device information only when the session opened. Since 0.31.3
the client reads it again about every 5 minutes, so a change reaches it within
about 5 minutes while the session is not busy.

With client 0.31.3-beta.5 the reporter plugged the keypad in and later unplugged
it while the session stayed open. Home Assistant followed both changes without a
restart ([report](https://github.com/keesmod/ha-eufy-cam/issues/286#issuecomment-7103334111)). The download held three device
information replies in about 11 minutes and no hub notify update.

## Entry sensor parameters

Since 0.31.3, [ha-eufy-cam#306](https://github.com/keesmod/ha-eufy-cam/issues/306).
On 2026-11-23 a reporter with four `T8900` under a `T8030` on 3.8.8.0 saw the
battery of every entry sensor as unknown while the eufy app showed them full.
Only one sensor had a battery value, from the inventory. Two device information
replies carried every sensor's contact state, but no battery state 1552 that the
client reads. Whether the HomeBase sent no 1552, sent a value other than 0 or 1,
or sent it in an encoded entry, which the client did not read for an entry
sensor before 0.31.3, is unknown.

Since 0.31.3 `accessoryParameters(id)` also returns this evidence for an entry
sensor, with the routes and bounds of a keypad. `camera_info` holds the device
information including its encoded entries, `hub_notify` the hub notify updates
(1829) and `cloud` the inventory row. The legacy sensor status (1550) and the
door sensor push carry only the contact state and add no evidence. `codes`
keeps the raw value of battery level 1101 and battery state 1552 only. An
encoded 1552 of 0 or 1 now sets the battery reading. A 1552 with another value
still sets no reading, but shows in `codes`.

## Guard mode Off

Mode 6 is Off, the mode a keypad sets. Since 0.31.0 every HomeBase reads it.
Before, a HomeBase in Off was dropped from the observed state, and
`refreshStationState` and `setGuardMode` waited 10 seconds and failed.

`setGuardMode(id, 6)` is accepted only on a HomeBase with an admitted keypad,
otherwise it fails with `invalid_guard_mode` before any connection.
`StationState.availableModes` lists the accepted modes. The vendored Station
accepts 6 only when a keypad is among its devices, so the station wire of a
HomeBase with an admitted keypad also lists that keypad. Entry sensors and
chimes never join the wire, and a HomeBase without an admitted keypad keeps an
identical wire. Confirmation is unchanged: an acknowledgement and a fresh P2P
read of the same mode. A reporter set Off on a HomeBase 3 with firmware 3.8.8.0
and the eufy app followed. No automatic retry exists.

## Not included

No accessory settings, keypad codes or key presses, alarm events from a keypad,
chime settings or chime state. No other accessory type, such as the T8910 motion
sensor, E20 sensors or the T8028 chime, and no other HomeBase.

## Software evidence

[Accessory tests](../test/accessories.test.mjs) use a reported-shaped synthetic
inventory with a real vendored Station and P2P session without a socket. They
cover admission and rejection, an unchanged camera and station result and wire,
the 1829, 1550 and device information paths, push consumption and order, close
handling, cloud labels, guard mode 6 and the rejection of accessory IDs by every
camera path. [Guard tests](../test/guard.test.mjs) cover reading 6.
