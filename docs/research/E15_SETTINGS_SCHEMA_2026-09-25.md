# E15 setting declarations, 2026-09-25

Evidence for the settings workstream of
[keesmod/eufy-robomow-ha#8](https://github.com/keesmod/eufy-robomow-ha/issues/8),
the part "setting changes read back and restored". It records the two
permitted sources behind [Opt-in mower settings](../MOWER_SETTINGS.md): the
device's own cloud declaration of its data points and the official app's
product script. No setting was written and nothing moved.

## Declared data points, read-only readout

- Owned E15, product code T2880. Firmware was not re-read, it was 6.9.28 on
  2026-09-20.
- The owner approved one read-only readout in chat on 2026-09-25. It ran with
  library 0.19.0 and Node 24.21.0 inside the mower bridge app 0.9.0 container
  on the owner's Home Assistant host, as a separate one-off script that used
  none of the bridge's files.
- One sign-in with an in-memory session store at 06:41:07.691 UTC, one
  discovery that returned one E15, one local session opened and closed again
  at 06:41:07.915 UTC without any query or write, then client shutdown at
  06:41:07.918 UTC. Only product metadata was printed. No credential, session,
  address, identifier, key or data-point value left the host.
- The existing Home Assistant integration kept its LAN connection. Its mower
  entity stayed `docked` without any state change from 00:35 UTC through the
  readout, and its cut-height entity stayed at 40.

Discovery returned 100 usable schema entries. `JSON.stringify(session.schema)`
in 0.19.0 has SHA-256
`9b1eab717e1418f85ece35c2775f01f9548f6a90ddb771ad8a30eb61d29e6272`. The
[telemetry receipt](E15_TELEMETRY_OBSERVATION_2026-09-16.md) of 2026-09-16
hashed another representation, so the two hashes are not comparable. The
entries for the settings, with two related points for context:

| DP  | Declared code              | Mode | Type  | Range and unit      |
| --- | -------------------------- | ---- | ----- | ------------------- |
| 26  | `volume_set`               | rw   | value | 0 to 100, step 1 %  |
| 47  | `child_lock`               | rw   | bool  |                     |
| 101 | `rain_auto_return`         | rw   | bool  |                     |
| 110 | `mow_height`               | rw   | value | 25 to 75, step 1 mm |
| 118 | `save_map_process`         | ro   | value | 0 to 100, step 1 %  |
| 132 | `enable_smart_forbid_zone` | rw   | bool  |                     |
| 133 | `enable_bird_view_capture` | rw   | bool  |                     |
| 139 | `follow_edge_distance`     | rw   | value | -10000 to 10000 mm  |
| 141 | `sparse_lawn_optimization` | rw   | bool  |                     |
| 155 | `reserved_raw_155`         | rw   | raw   |                     |

Every value point has scale 0. DP 150 to 169 are declared as reserved raw
points and DP 170 to 177 and 181 to 185 as reserved integers without meaning.

## The official app's product script

The installed App Store app "Anker eufy" 6.1.00 on the owner's Mac evaluates a
product script per product code, the same script that
[#51](https://github.com/keesmod/eufy-mega-client/issues/51) used for the map
numbering, see [Decoded mower map geometry](../MAP_GEOMETRY.md#provenance).
The container copy read on 2026-09-24 has the same SHA-256
`0be33785e7c70d2c2e890d0f3b9d4ee512dca527b447ca95651ba683d5ef048d`. Its
thing-model module maps every app action to the data point it writes and names
the type the app reads back. Its control handler checks each input before the
app writes it:

| DP  | App action                                    | App input check          |
| --- | --------------------------------------------- | ------------------------ |
| 26  | `ECL_MOW_SET_VOLUME`                          | Number from 0 to 100     |
| 47  | `ECL_MOW_SET_CHILDREN_LOCK`                   | Boolean                  |
| 101 | `ECL_MOW_SET_RAIN_RETURN`                     | Boolean                  |
| 110 | `ECL_MOW_SET_MOW_HEIGHT`                      | Number from 25 to 75     |
| 132 | `ECL_MOW_SET_AI_FORBIDDEN_ZONE_ENABLE`        | Boolean                  |
| 133 | `ECL_MOW_SET_BIRD_VIEW_COLLECTION_ENABLE`     | Boolean                  |
| 139 | `ECL_MOW_SET_EDGE_CUTTING_DISTANCE`           | Number, no range check   |
| 141 | `ECL_MOW_SET_SPARSE_LAWN_OPTIMIZATION_ENABLE` | Boolean                  |
| 155 | `ECL_MOW_SET_MAIN_PAGE_WORK_PARAM`            | Encoded protobuf message |

The same module declares the read type of DP 26 and 110 as integers and of DP
47, 101, 132, 133 and 141 as booleans. The DP 155 message carries mow height,
mow speed, edge distance, mow spacing, blade speed and the direction
configuration together. The English strings of the app's settings panel bundle
include Cutting Height, Smart No-Go Zone Suggestions and Real Lawn. That
string table concatenates strings without separators, so no label is tied to
a data point from the table alone.

The two sources agree on every data point, type and bound of the first slice.
No code was copied from the app. The entities of the unlicensed mower fork were
read only to learn which settings its local backend exposes today. No code,
schema, constant, fixture, test or table from the fork was used, and every
data point, code, type and bound here comes from the two sources above.

## Not established here

- Which app control reports which point on this firmware. The owner-observed
  changes belong to the supervised window of the settings workstream.
- Whether the app's Cutting Height writes DP 110 or the DP 155 work parameters
  on this firmware, and whether a DP 110 write appears in the app.
- The effect of each boolean beyond its name.
- Any other E15 firmware or any other installation.
