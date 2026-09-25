# Local mower transport provenance

Implementation and software evidence for [#145](https://github.com/keesmod/eufy-mega-client/issues/145).
The read-only local transport extends the mower module from #40 without touching
the camera code or the map acquisition path. Change class: architecture extension
within the accepted independent-module boundary. No DP write, command, setting,
refresh request or automatic polling exists in this slice.

## Source review, 2026-09-16

| Component                                                                                                                                               | Exact permitted source                                                                                                                                                                                                                                                                                                                              | Licence and use                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame layout, GCM parameters, return code, session-key negotiation, sequence rule, query response, idle timeout                                         | [tuya/TuyaOpen, 4e3147b3241ae15a171f284c3d812b20a26fe398](https://github.com/tuya/TuyaOpen/tree/4e3147b3241ae15a171f284c3d812b20a26fe398), `src/tuya_cloud_service/lan/tuya_lan.c`, `tuya_lan.h`, `src/tuya_cloud_service/protocol/tuya_protocol.c`, `tuya_protocol.h`, `src/tuya_cloud_service/schema/dp_schema.c`, `dp_schema.h`, `tuya_iot_dp.c` | Apache-2.0, copyright Tuya Inc. The protocol owner's device-side implementation. Read to establish protocol facts. No code, macro, structure or table copied                                                    |
| Client conventions: initial sequence, empty 3.5 query payload, header-free query and negotiation frames, report header stripping, return-code unpacking | [jasonacox/tinytuya v1.20.0, 8512d8364a9d0e351bbec2597bafa17595545b13](https://github.com/jasonacox/tinytuya/tree/8512d8364a9d0e351bbec2597bafa17595545b13), `tinytuya/core/message_helper.py`, `header.py`, `XenonDevice.py`, `command_types.py`, `crypto_helper.py`                                                                               | MIT, copyright 2024 Jason Cox. Cross-check and offline reproduction oracle. No code copied                                                                                                                      |
| Second independent client cross-check of framing, AAD, session-key IV and query command                                                                 | [codetheweb/tuyapi 7.7.1, 4135c835deaa7c94ad0df9dd4c34878cb5eb2916](https://github.com/codetheweb/tuyapi/tree/4135c835deaa7c94ad0df9dd4c34878cb5eb2916), `lib/message-parser.js`, `lib/cipher.js`, `index.js`                                                                                                                                       | MIT, copyright 2017-2025 Max Isom. Read only. No code copied                                                                                                                                                    |
| The owned E15 answers protocol 3.5 status queries on TCP port 6668 with the account local key                                                           | Retained installation observation: the existing mower integration polls the owned E15 through tinytuya 1.20.0 configured for version 3.5 and port 6668. The environment inventory is in the [map validation receipt](research/E15_MAP_VALIDATION_2026-09-10.md)                                                                                     | Functional observation of a permitted MIT library in the retained installation. It identifies which public protocol the mower speaks. It is not a hardware trial of this library and no fork code was consulted |
| Frame codec, session owner, module wiring, synthetic peer, tests and oracle script                                                                      | New implementation in this repository                                                                                                                                                                                                                                                                                                               | Copyright 2026 keesmod, MIT. Synthetic key, identity and values only                                                                                                                                            |

Pinned file digests, SHA-256, so the review can be repeated against the exact bytes:

| File                           | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| TuyaOpen `tuya_lan.c`          | `2e44b0b51c6a78c396a4fef4a9e0d46328788115ef6c77ff5b5c0d12bed10d17` |
| TuyaOpen `tuya_lan.h`          | `62ae8f96ed37fcba58875f1a7d5a036e72ced6bdb582b189ae0b704f57f8a5bd` |
| TuyaOpen `tuya_protocol.c`     | `e7cce6a3e64e71edfa4b7e82b023d01105938e3a61b5fdf86d5f4e8d09375472` |
| TuyaOpen `tuya_protocol.h`     | `cc5d988b42f3e0b3a9d4543560d15568bf6488c50356aa611d974454c29e327e` |
| TuyaOpen `dp_schema.c`         | `3ace2345da73c4d5da73c68f4ad93b8c88fb5d3bfcdc157f004935221390e318` |
| TuyaOpen `dp_schema.h`         | `11a6e1cc3df5ab3da39412c6125a7f55dc6d4d764d0177f11022eea8ceee64e7` |
| TuyaOpen `tuya_iot_dp.c`       | `0e88c41e3f49b912eb6bcdac876cffd6ee8037a19c77e075288760ffc5b662a8` |
| TuyaOpen `LICENSE`             | `57378dc6fee1d652e27743c7ba0179410b7b09e9f72c8d3bb017344b37ea6df7` |
| tinytuya `message_helper.py`   | `158c14953482071f8e60250b36c208b5e381640a5e8629d1d076d91bcf737283` |
| tinytuya `header.py`           | `4ebe817e777565eda70918d6ab9b791e41a9e73eda516ba5fea662ccd3310a47` |
| tinytuya `XenonDevice.py`      | `cd3a5f333eed39c55dafd821a01810ac824c74e6cbd330c9b863e43bf4b7963f` |
| tinytuya `command_types.py`    | `446c71f778c4aadcb751356968ffb744c2b47070309b86b5fda66a380dba5fad` |
| tinytuya `crypto_helper.py`    | `4d5270756da06a55427e44bc838bca5a18ba382d969fa7eb7aecddb446c0903c` |
| tuyapi `lib/message-parser.js` | `5bdf8f22f8c22d49232f8ab45bee9626a30f0e42494b238b8e649ec75e5fcb30` |
| tuyapi `lib/cipher.js`         | `0bfaf8d28d4e00b2c99d5e5af94ead34d1c45c686b556b80d397dd20270eb88c` |
| tuyapi `index.js`              | `fa0ce374725d1de219bdc4aa7cdcd07080dac49d0ced0f8b9ee8e5efc345ef4e` |

## Protocol facts used

Every fact below is implemented in `src/mowers/local/frame.ts` or
`src/mowers/local/session.ts` from the named sources. Where the sources agree, all
are listed. Where they differ, the difference and the chosen behavior are stated.

| Fact                                                                                                                                                                                                                                                                                                                                           | Sources                                                                                                                                                                                           | Use                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Transport is TCP, default port 6668                                                                                                                                                                                                                                                                                                            | tinytuya `const.py` TCPPORT, tuyapi default port, retained installation                                                                                                                           | `LOCAL_PORT`                             |
| Frame: prefix `00006699`, one version/reserved byte and one reserved byte, both zero, sequence, command and length as big-endian 32-bit values, 12-byte random nonce, AES-128-GCM ciphertext, 16-byte tag, suffix `00009966`. Length counts nonce, ciphertext and tag. The 14 bytes after the prefix are the GCM additional authenticated data | TuyaOpen `tuya_protocol.h` LPV35 sizes and `lpv35_frame_serialize`, tinytuya `header.py` and `pack_message`, tuyapi `_encode35` and `_decrypt35`                                                  | `encodeFrame`, `decodeFrame`             |
| Receive checks: prefix, suffix, length equal to total minus 22, tag verification. The device accepts at most 4 KiB per incoming frame                                                                                                                                                                                                          | TuyaOpen `lpv35_frame_parse`, `LAN_FRAME_MAX_LEN`                                                                                                                                                 | `FrameReader`, outgoing bound            |
| Device plaintexts begin with a four-byte return code, zero on success, followed by data. Client plaintexts carry no return code                                                                                                                                                                                                                | TuyaOpen `lpv35_plaintext_data_t` and `lan_send`, tinytuya `unpack_message`, tuyapi `_decrypt35`                                                                                                  | `splitReturnCode`                        |
| Negotiation: command 3 carries a 16-byte client nonce under the local key. Command 4 returns the 16-byte device nonce plus HMAC-SHA256 of the client nonce under the local key. The client verifies it and sends command 5 with HMAC-SHA256 of the device nonce. Nothing is acknowledged after command 5                                       | TuyaOpen `lan_protocol_process` cases `FRM_SECURITY_TYPE3` and `TYPE5`, tinytuya `_negotiate_session_key_*`, tuyapi `_packetHandler`                                                              | `connect`, `verifySessionKeyResponse`    |
| Session key: XOR of both nonces, encrypted with AES-128-GCM under the local key using the first 12 bytes of the client nonce as IV and no AAD. The 16 ciphertext bytes are the key, the tag is discarded. Commands 3, 4 and 5 use the local key, every later frame the session key                                                             | TuyaOpen `FRM_SECURITY_TYPE5` handling and key selection in the receive loop, tinytuya `_negotiate_session_key_generate_finalize`, tuyapi `_encrypt35` with `iv`                                  | `deriveSessionKey`                       |
| The local key is 16 bytes                                                                                                                                                                                                                                                                                                                      | tinytuya `_get_socket` length check, TuyaOpen key length 16                                                                                                                                       | `localKeyBytes`                          |
| Client sequence numbers start at 1 and increase by one per frame. The device starts its expectation at zero and drops a session on a non-increasing sequence. Reference replies echo the request sequence, but tinytuya records that 3.5 devices may answer with their own counter, so replies are correlated by command                       | TuyaOpen receive loop and `lan_session_free`, tinytuya `seqno = 1` and `_get_retcode` note, tuyapi resynchronisation after command 4                                                              | `#sequence`, `#receive`                  |
| Status query: command `0x10` with the JSON payload `{}` and no version header. The reply uses the same command, a return code and JSON with `dps` and `devId`. A `protocol`/`data` wrapper around `dps` is also accepted                                                                                                                       | TuyaOpen `FRM_QUERY_STAT_NEW` handling, `tuya_iot_dp_obj_dump` with `DP_APPEND_HEADER_FLAG`, `dp_rept_json_append`, tinytuya `payload_dict` v3.5, `NO_PROTOCOL_HEADER_CMDS` and `_decode_payload` | `queryStatus`, `decodeStatus`            |
| Device reports and other pushes prefix their JSON with 15 bytes: `3.5`, four zero bytes, a four-byte serial and a four-byte source marker. The JSON is `{"protocol":4,"t":...,"data":...}`                                                                                                                                                     | TuyaOpen `__pack_data_with_cmd_lpv35`, tinytuya `PROTOCOL_35_HEADER` stripping                                                                                                                    | `decodeStatus`, skipped in `#receive`    |
| A heartbeat reply uses command 9, sequence 0 and an empty payload. The device closes a connection that received no frame for 30 seconds                                                                                                                                                                                                        | TuyaOpen heartbeat branch and `HEART_BEAT_TIMEOUT`                                                                                                                                                | Skipped in `#receive`, consumer guidance |
| A malformed query is answered with a nonzero return code and a short text                                                                                                                                                                                                                                                                      | TuyaOpen error branches, tuyapi fallback strings                                                                                                                                                  | `mower_local_rejected`                   |

tinytuya sends `{}` and tuyapi sends `gwId`, `devId`, `uid` and `t` in the query.
The reference device only requires parseable JSON. The library sends `{}`, the
form used by the tinytuya version observed against the owned mower, and keeps
the device identifier out of the wire payload.

## Spontaneous reports, issue #150

The same pinned TuyaOpen `tuya_lan.c`, lines 698 to 736, sends DP reports to
active authenticated LAN sessions using `FRM_TP_STAT_REPORT`. This is command
8 in the protocol header. The device's report sequence is zero in this
reference implementation. It is not correlated with a query. Query commands
instead call `tuya_iot_dp_obj_dump`, lines 859 to 887, which returns object DP
cache contents. A new query reply does not establish a fresh measurement.

The receive loop, lines 1058 to 1067, handles command-9 heartbeats without a
payload and updates the session's activity time. The configured idle timeout is
30 seconds. `receiveReport()` sends an empty authenticated heartbeat every 10
seconds only during a bounded pending read. This maintains the transport and
does not write or refresh any DP. No subscription frame is required by the
reference report path and none is invented by this implementation.

The owned E15 evidence is recorded in
[the #150 receipt](research/E15_ACTIVITY_REPORTS_2026-09-16.md). Protocol source
evidence does not establish that a particular firmware emits every declared DP.

`test/mower-reports.test.mjs` independently constructs synthetic reports through
the existing peer fixture. It verifies command correlation, foreign binding and
GCM rejection, actual arrival times across buffered delivery, partial values,
missing-report expiry, exclusive ownership, cancellation, shutdown, queue
overflow and heartbeat cleanup. No device values or mower-fork code are used.

## Control commands, issue #169

The opt-in command path of 0.16.0 writes one declared boolean point per call
through frame type `0x0d`. Its protocol facts, the pinned sources for the
version header, document shape and device reply, and the reasons for not
writing the raw control points are recorded in
[Opt-in mower commands](MOWER_COMMANDS.md). Reads remain write-free.

## Settings, 0.20.0

The opt-in settings of 0.20.0 write one declared setting point per call
through the same frame type, behind their own opt-in. The points, their
permitted sources and the lifecycle are recorded in
[Opt-in mower settings](MOWER_SETTINGS.md). Reads remain write-free.

## Independent reproduction

`scripts/research/tuya35_vectors.py` runs tinytuya 1.20.0 offline with synthetic
inputs. On 2026-09-16, in a fresh Python 3.14 virtual environment with tinytuya
1.20.0 and cryptography 50.0.1, the following held:

- The three client frames built by the TypeScript codec for a fixed key, nonce,
  sequence, command and payload are byte-identical to tinytuya's `pack_message`.
- tinytuya's `unpack_message` decodes those TypeScript frames with a valid tag and
  the expected sequence, command and payload.
- The session key derived by the TypeScript code equals tinytuya's result for the
  same local key and nonces.
- The TypeScript decoder accepts a device-style reply packed by tinytuya and splits
  its return code and JSON correctly.

The vectors are asserted in `test/mower-local-transport.test.mjs`. The test
fixture is a synthetic device peer whose framing, negotiation and key derivation
were written separately from the device-side description above. A completed
query under the negotiated key proves that both sides derived the same key.

No live E15 session was opened in the original #145 run. The retained
installation evidence establishes that the mower answers tinytuya 1.20.0
protocol 3.5 status queries, and the codec now
matches that library byte for byte, but that is not hardware acceptance of this
implementation. Hardware validation remains a separate, explicitly authorized
supervised step with current telemetry and a recovery path. The later
[2026-09-16 telemetry receipt](research/E15_TELEMETRY_OBSERVATION_2026-09-16.md)
now records that trial on the owned E15, including successful query responses
and completed disconnect/shutdown on firmware 6.9.28.

## Licensing and privacy boundary

TuyaOpen is Apache-2.0 and was used only to establish protocol facts. The new
files contain no Apache-licensed code and remain MIT. tinytuya and tuyapi are MIT
and served as documentation, cross-check and offline oracle. No code, constant
table, schema, fixture or test was copied or mechanically translated from the
unlicensed mower fork, and its DP interpretation was not consulted. Snapshots
return raw DP values without meaning assigned.

The local key exists in memory only during negotiation inside the cloud owner's
revocable lease and is erased afterwards. The session retains a hash of the
device identifier to reject a foreign `devId` in a reply, never the identifier
itself. Public results never contain the key, device ID, host or session key.
Errors carry only stable codes. Snapshot values may include private data, so
consumers must not log them.

## Software evidence and remaining acceptance

`test/mower-local-transport.test.mjs` covers the reproduced vectors, every
tampered frame byte, stream splitting and coalescing, oversized and misaligned
input, report shapes, module gating, the read-only happy path with resource
accounting, persistence across cloud rediscovery, negotiation failures, query
failures, peer closure, cancellation, concurrency, shutdown and an unreachable
host. All tests use loopback sockets and synthetic values. CI runs them on Linux
with Node 24.

The later receipt confirms query lifecycle, battery, Wifi and declared signal
percentage on the owned E15. Activity, mowing progress, any write path and other
firmware remain unconfirmed. The hardware evidence is recorded in the
[model matrix](MODEL_MATRIX.md#e15-local-telemetry-2026-09-16).
