# Portable E15 album and map file transfer

Story [#49](https://github.com/keesmod/eufy-mega-client/issues/49), epic #11,
programme #7. Change class: Refactor of the isolated research session, with a
bounded file receiver and a heartbeat parser fix.

## Result

On 2026-09-10, standalone Node 24.16.0 on Linux x64 queried the established
`ipc_sweeper_robot` album and downloaded its three allowed files from the E15.
The session used fresh account/device-bound provisioning, MQTT signaling,
authenticated TCP relay and the application authorization proven in
[#78](E15_LINUX_PEER_RESPONSE_2026-09-10.md). It used Node built-ins only.
No Android process, vendor library, SDK emulator or remote helper participated
in the standalone attempt.

The final successful attempt took **1,841 ms**, including confirmed local
resource cleanup. The peer confirmed the explicit transfer cancellation.
Private comparison established exact byte equality for every file against both
fresh normal-source callbacks and the normal published map bundle:

| File                   | Bytes  | Fresh callback equality | Published bundle equality |
| ---------------------- | ------ | ----------------------- | ------------------------- |
| `map.bin.stream`       | 3,354  | Exact                   | Exact                     |
| `cleanPath.bin.stream` | 17,495 | Exact                   | Exact                     |
| `navPath.bin.stream`   | 6      | Exact                   | Exact                     |

The device was the independently bound E15 from #40, on owner-reported firmware
6.9.28. This probe did not independently query firmware. These findings establish
this device's read-only portable transfer, not E18 support or product migration.
Raw bytes, identifiers, lawn geometry, credentials and captures remain private.

## Independent provenance

The original ThingClips `thingsmart-p2p-file-trans-sdk:7.5.1` artifact and its
hashes are pinned in the [#78 receipt](E15_LINUX_PEER_RESPONSE_2026-09-10.md).
The independently authored
[`e15_map_oracle.py`](../../scripts/research/e15_map_oracle.py) executes the
separately supplied original ARM64 artifact with synthetic inputs and mocked
I/O. It is an offline research tool and is never loaded by the Linux runtime.

The oracle observes original `QueryAlbumFile`, `StartDownLoadFile` and
`CancelUpDownloadFile` calls at the asynchronous send boundary. Synthetic
RapidJSON input supplies three filenames. Original receive execution reads a
synthetic stream in chunks of at most seven bytes and produces four callbacks
with package types `1,2,3,3`. Output assertions verify the command payloads,
ordering, callback sizes and completed synthetic file bytes. The original
artifact is not redistributed. No code, constants, schemas, fixtures or tests
from the unlicensed mower fork were copied or mechanically translated.

Relevant original function addresses are `0x112dc` for album query, `0xe6a4`
for download, `0x100d8` for cancellation and `0x1b1f4` for channel-five receive.
Original callbacks `0x15734`, `0x14c38` and `0x150b0` establish the album,
download and cancellation response states. Existing #83 evidence establishes
that ordinary KCP conversation values equal channel indices for this route.

## Command and file framing

All application fields below are little-endian. Commands use the existing
20-byte header: marker `0x12345678`, request ID, request/response flag, main and
subcommand, then payload length. This trial sends only auth, version, album,
allowlisted download and cancellation. It never retries a command.

| Command     | Main/sub | Payload                                                                                                                            |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Album query | 100/12   | 116 bytes. Query type zero at 0, fixed album at 4, remaining bytes zero                                                            |
| Download    | 100/13   | 64-byte header and three 48-byte filenames. Data channel 5 at 0, operation zero at 4, album at 8, reserved zero at 56, count at 60 |
| Cancel      | 100/13   | 72 bytes. Operation 4 at offset 4, remaining bytes zero                                                                            |

The album response must be complete, operation 3 at offset 4, with count at 516
and exactly that many 80-byte records from 520. Each present record has a flag
at offset 4 and a terminated 48-byte name at offset 8. The runtime requires
all three exact allowed names and rejects duplicates. It never requests an
unadvertised name, arbitrary file, upload, deletion or geometry operation.
Download acceptance uses operation 1. Cancellation requires the current cancel
request ID, main/sub 100/13, an eight-byte payload and operation 1 or 3, matching
the original callback. Transport closure alone is not peer cancellation proof.

File bytes arrive separately on channel 5. The stream has an eight-byte common
header containing `1,1000`, followed by a 72-byte file header. The latter contains
the transfer task in the high 16 bits of its first word, packet index at 4,
count at 8, filename at 12, chunk length at 60, total file length at 64 and end
flag at 68. The receiver handles arbitrary CBC/KCP and stream splits, enforces
ordered packet indices across names and rejects foreign tasks, unknown names,
interleaving, contradictory totals and incomplete endings. It requires exact
byte count at a file end. It bounds a file to 8 MiB, a chunk to 1 MiB and the
pending stream buffer to 2 MiB. Per-channel KCP message counts are also bounded.

## Completion, cancellation and the cleaning-path observation

The first successful short trial received the current map and navigation path
plus a four-byte cleaning-path update. A normal bundle retained historical
cleaning tracks, so bundle comparison alone did not establish path equality.
A separate bounded observation captured only the allowlisted normal `/file`
callbacks. It independently showed that the same four-byte update precedes a
17,495-byte cleaning-path file. All three initial portable files matched fresh
normal callbacks, but the final probe also waits for the subsequent full path.

The receiver replaces a file only after a complete ordered delivery. Once all
three are complete, it waits for 750 ms without more file data, then sends one
cancel request. An incomplete replacement prevents settling. The positive
result requires download acceptance, complete files, the correlated cancel
response and confirmed closure of all owned resources. This bounded quiet
window is an observed research policy, not a universal future-stream completion
guarantee. Long-running lifecycle and delta accumulation remain #50 and #52.

The longer second trial exposed rejection of a zero-body carrier heartbeat.
The existing original-artifact oracle already specifies `f500 0000`. The reader
now accepts that exact empty heartbeat while rejecting empty application data
records. Regression tests cover every heartbeat split. No guessed frame was
sent in response, and the failed attempt was closed without replay.

Budgets remain 15 seconds for negotiation, 60 seconds active work and 5 seconds
for cleanup, enforced through owned sockets, promises and real cancellation.
The settling timer is cleared during cleanup. Late data after reader closure,
wrong identities, stale provisioning and incomplete files cannot create success.

## Recovery and validation

All previous owners confirmed idle before this story claimed the live slot.
Each live window had a service backup, independent restore timer and an EXIT
restore path. Native research and normal-source observations were separate
from the standalone Node session. Before that session the competing Android
probe was force-stopped and process absence was checked.

After the final attempt, the normal helper restarted at **22:21:22 UTC** and
published a later normal bundle at **22:21:31.862992461 UTC**. Original APK and
service unit were byte-equal to backup. The original native library hash and
active helper/emulator were verified. Temporary observers, overrides, Linux
runtime and credentials were removed after process/timer checks. Backups and
the original Android source remain recoverable. The live slot was released.

Final validation includes 23 Linux protocol/lifecycle tests, all 193 Node tests
and all 25 release-tooling tests. Existing release checks also pass. Synthetic tests cover allowlists, malformed
album responses, every-byte stream splits, mismatched lengths/tasks, ordering,
incomplete replacements, channel separation, closed readers and actual socket
cancellation. The original-artifact oracle passes three command and four stream
callback cases. Synthetic tests do not substitute for the private live comparison.
After the successful trial, final formatting and fail-closed guards for incomplete
replacement data at cancellation and closed readers were validated on Linux.

Run the isolated probe only with fresh private provisioning, exclusive ownership
and a checked restore procedure. Supply a new private output directory:

```sh
node scripts/research/e15-linux-peer.mjs /private/peer-inputs.json /private/new-output
```

Without the second argument, the existing #78 version-response trial is retained.
Research scripts remain outside the published package. No product release or
deployment occurred. Existing #50 owns the library acquisition lifecycle,
#51 decoding, #52 deltas, #53 consumer compatibility and #54 architecture/shutdown
acceptance. Those are separate existing programme obligations. All #49
album/file-transfer acceptance is satisfied, while epic #11 remains open.
