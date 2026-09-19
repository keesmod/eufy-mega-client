# Opt-in mower commands

Implementation and software evidence for
[#169](https://github.com/keesmod/eufy-mega-client/issues/169). The command
path sits on the local session of
[Mower transport provenance](MOWER_TRANSPORT_PROVENANCE.md) and the confirmed
DP 107 activities of [typed mower telemetry](MOWER_TELEMETRY.md). Change class:
additive extension of the mower module. Reads still never write. The session
can write exactly four declared boolean points, only behind an explicit
per-client opt-in, one command at a time, without retry, replay or reconnect.

## Contract

`new EufyClient({ mowers: { ..., commands: { enabled: true, stopRoute } } })`
is the only way to enable control. `enabled` must be literally `true` and
`stopRoute` must name, in the consumer's own words, how the mower is stopped
when this path fails, for example "pause then return through this session with
the official app at hand". An invalid opt-in fails client construction with
`mower_invalid_options`. Without the opt-in `session.sendCommand()` is refused
with `mower_commands_disabled` before any frame is written, and
`client.mowers.commandsEnabled` and `session.commandsEnabled` report `false`.

`session.sendCommand({ kind, readBackMs? })` runs one command of the class
`start`, `pause`, `resume` or `return` and resolves a `MowerCommandOutcome`:

1. One fresh status query. Its snapshot is returned as `before`. The typed
   refusals below are decided on it, and nothing is written when one applies.
2. One control frame that writes the class's declared boolean point. `sentAt`
   is the local time the frame was written to the socket.
3. A bounded read-back of fresh command-8 reports, default 10 seconds and at
   most 60. Every report received in that window is returned in `reports` so
   the consumer can decode it with `decodeMowerTelemetry`. Reports whose
   receipt time precedes `sentAt` are kept as context and never count as
   evidence.

`stage` is the furthest stage evidenced by fresh reports and `end` says why
the read-back stopped:

| Stage          | Evidence                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sent`         | The frame was written. The device's frame reply, when one arrived, is in `reply` with `returnCodeZero` and `rejected`. A reply is not an acknowledgement       |
| `acknowledged` | A fresh report carried the class's declared control point, DP 103 for start and return, DP 105 for pause, DP 106 for resume, or the written point at its value |
| `reflected`    | A fresh DP 107 report decoded through the confirmed E15 definitions to the expected activity: `mowing` for start and resume, `paused`, `returning`             |

| End            | Meaning                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `reflected`    | The expected activity was reported within the bound                                                                             |
| `rejected`     | The device answered the control frame with a description, which the reference implementation sends only for an unusable command |
| `timed_out`    | The bound passed. The outcome is resolved, not thrown, because the write has already happened and must not be repeated          |
| `report_limit` | 64 reports arrived without the expected activity                                                                                |

There is no `completed`. A reflected return means the mower reported
`returning`. Dock arrival is not part of any lifecycle and is never inferred
from silence, from the read-back bound or from an acknowledgement. Rain and
child protection are never read for a decision, never written and never
bypassed. The library never sends a second frame for one call, never retries a
timed-out or rejected command and never reconnects a lost session.

### Typed refusals before any write

| Code                             | Decided on                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mower_commands_disabled`        | The client has no valid opt-in                                                                                                                                |
| `mower_command_invalid`          | Unknown `kind` or a `readBackMs` outside 1000 to 60000                                                                                                        |
| `mower_command_undeclared`       | The session schema does not declare the point as a writable boolean with the expected code. A session without a schema cannot write                           |
| `mower_command_evidence_missing` | The fresh query carries no valid DP 118 `save_map_process` percentage, so a running map save cannot be excluded                                               |
| `mower_command_map_saving`       | DP 118 is strictly between 0 and 100. The app offers no control during a map save, and a return control pressed during one was ignored on the owned device    |
| `mower_command_already_set`      | The fresh query already shows the written point at the written value, so the write cannot produce a fresh change and a repeated activity report could mislead |

The existing session errors apply unchanged: `mower_local_busy` while another
operation owns the session, `request_aborted` on cancellation,
`client_closed` on shutdown, `mower_local_disconnected` when the peer closes
during the read-back, and `request_timeout` as the hard deadline of the session
timeout plus the read-back bound. A closed session must be opened again by the
consumer. Nothing is resent on the new session.

## The writes and their sources

| Class    | Written point               | Control point that reported on every app press | Expected activity |
| -------- | --------------------------- | ---------------------------------------------- | ----------------- |
| `start`  | DP 1 `switch_go` = true     | DP 103 `start_control`                         | `mowing`          |
| `pause`  | DP 2 `pause` = true         | DP 105 `pause_control`                         | `paused`          |
| `resume` | DP 2 `pause` = false        | DP 106 `resume_control`                        | `mowing`          |
| `return` | DP 3 `switch_charge` = true | DP 103 `start_control`                         | `returning`       |

| Fact                                                                                                                                                                                                                                                                                                               | Permitted source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The owned E15 declares DP 1 `switch_go`, DP 2 `pause` and DP 3 `switch_charge` as writable booleans, DP 103 to 106 as writable raw points, DP 118 `save_map_process` as a read-only percentage, and DP 5 `status` as an enum that never arrived in any report                                                      | Product schema retrieved through discovery, recorded in the [telemetry receipt](research/E15_TELEMETRY_OBSERVATION_2026-09-16.md). Product metadata, not a secret                                                                                                                                                                                                                                                                                                                                                                                   |
| For the protocol owner's standard robot points, `switch_go` true starts and false stops the job, `pause` true pauses and false continues the current work state, `switch_charge` true starts and false stops a recharge, and the device reports the point after executing the command                              | Tuya Developer documentation, [Data Point (DP) for robot devices](https://developer.tuya.com/en/docs/iot-device-dev/robot_device_dp?id=Kd93ny7iall38) and [DPs and interaction logic of robot vacuum](https://developer.tuya.com/en/docs/iot-device-dev/basic_dp_interactive?id=Kf765i4rk91k1), read 2026-09-19. Public documentation of the protocol owner. It documents the standard codes, not this firmware                                                                                                                                     |
| A LAN control command is frame type `0x0d`. Its plaintext is the 15-byte version header, the text `3.5` followed by twelve bytes for the unused checksum, serial and source fields, then a JSON document with `protocol`, `t` and `data`, where `data` must carry `dps`. The device hands `data` to its DP parser  | [tuya/TuyaOpen, 4e3147b3241ae15a171f284c3d812b20a26fe398](https://github.com/tuya/TuyaOpen/tree/4e3147b3241ae15a171f284c3d812b20a26fe398), `tuya_lan.c` `lan_protocol_process` cases `FRM_TP_CMD` and `FRM_TP_NEW_CMD`, `tuya_protocol.c` `__parse_data_with_lpv35` and its offsets, `dp_schema.c` `dp_data_recv_parse`. Apache-2.0, copyright Tuya Inc. Read only, no code copied. Same pinned revision and digests as the transport provenance, plus `tuya_protocol.c` SHA-256 `e7cce6a3e64e71edfa4b7e82b023d01105938e3a61b5fdf86d5f4e8d09375472` |
| Client convention for a 3.5 device: `CONTROL` is sent as `CONTROL_NEW` `0x0d` with `{"protocol":5,"t":<seconds>,"data":{"dps":...}}` and the `3.5` version header, and no device identifier is required                                                                                                            | [jasonacox/tinytuya v1.20.0](https://github.com/jasonacox/tinytuya/tree/8512d8364a9d0e351bbec2597bafa17595545b13), `XenonDevice.py` `payload_dict` for v3.5 and `_encode_message`, `header.py` `NO_PROTOCOL_HEADER_CMDS`. MIT, copyright 2024 Jason Cox. Read only, no code copied                                                                                                                                                                                                                                                                  |
| The reference device answers a control command with the same frame type, its own outgoing counter and return code 1, carrying a description text only when the document could not be parsed or lacks `dps`. Acceptance is therefore not readable from the return code                                              | TuyaOpen `tuya_lan.c` `lan_protocol_process` and `lan_send`. tinytuya `_get_retcode` records that 3.5 devices answer with a global counter                                                                                                                                                                                                                                                                                                                                                                                                          |
| On the owned E15 every app press of Start, Pause, Continue and Charge was followed within milliseconds by a report of the matching raw control point and, for Start, Pause and Continue, by DP 1 or DP 2 changing to the value the standard assigns to that action. The app's Charge changed neither DP 1 nor DP 3 | [Reproduction receipt](research/E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md) and the [control-point receipt](research/E15_CONTROL_POINTS_2026-09-19.md)                                                                                                                                                                                                                                                                                                                                                                                             |

### Why the raw control points are not written

The retained reports hold 18 owner-operated control-point payloads across DP
103, 104, 105 and 106. The
[control-point receipt](research/E15_CONTROL_POINTS_2026-09-19.md) establishes
their layout from the public Protocol Buffers encoding rules: every payload is
three bytes, one varint record in field 1 whose value lay between 1380 and
9876 and differed on every press. That layout is established. What the value
means, whether the device validates it, and whether the app writes these
points or the firmware emits them as its own control acknowledgements cannot
be established from device reports alone. DP 103 also preceded both mowing
and returning with the same layout, so it cannot select between them. Writing
a raw point would therefore rest on an unestablished interpretation. The
declared booleans have public semantics from the protocol owner, the device's
own declaration, and matching observed changes for DP 1 and DP 2. The raw
points stay read-only data, used only as the acknowledgement anchor.

## Software evidence

`test/mower-commands.test.mjs` runs against the synthetic peer of
`test/fixtures/local-mower.mjs`, which now handles command `0x0d` on the
device side: it strips the version header, requires `data.dps`, answers with
its own counter and a description only for an unusable document, and lets a
test script the reports that follow. The tests cover the frozen command table,
refusal without opt-in, invalid opt-ins at construction, the documented frame
and document for every class, the lifecycle order recorded on the owned device,
non-matching DP 107 payloads including the transitional, map-saving, field 6
and default payloads, timeout with the evidenced stage, rejection, every typed
refusal without a written frame, the schema veto, invalid requests, exclusive
ownership, peer loss without reconnect, cancellation, shutdown, the report
limit, the hard deadline, heartbeats during a long read-back and outcome
isolation. All tests use loopback sockets and synthetic values.

## Remaining acceptance

No command has been sent to the owned E15 by this library. The hardware
acceptance is one bounded owner-operated window with the owner at the mower,
current telemetry, the official app as the independent reference, the owner's
explicit confirmation of every prerequisite and opt-in for each command class,
physical confirmations in chat, recovery evidence and verified cleanup. Until
that receipt exists the command path is software coverage only, and the model
matrix records it as unconfirmed. The app's return control did not change DP 3
on the owned device, so `return` through `switch_charge` is documented and
declared but unobserved, and the hardware window decides whether this firmware
honours it. A return sent during the app's Loading phase after a map save, when
DP 118 already reads 100, is not refused and is expected to end `timed_out`
without effect, as the app's own press did. Stop and stop-with-clear are not
offered. Settings, zones, scheduling and map decoding stay out of scope.
