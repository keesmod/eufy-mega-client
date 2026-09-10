# Portable map acquisition

Story [#50](https://github.com/keesmod/eufy-mega-client/issues/50) delivers
`PortableMapAcquisition`, a library-owned read-only adapter for the three
independently confirmed E15 streams. This is a refactor of the proven session
and file-transfer research into strict TypeScript, with explicit demand and
last-complete ownership. It preserves the existing `EufyMegaClient` API.

## Public contract

Construct one adapter for one verified mower account/device binding. Supply
fresh private `MapSessionProvisioning` from the current RTC/MQTT route. It has
the [independently established provisioning fields](research/E15_LINUX_PEER_RESPONSE_2026-09-10.md#provisioning-and-execution-boundary).
The adapter owns signaling, authentication, TCP transport, file acquisition and
cleanup. It does not obtain provisioning from a helper or invoke another runtime.
Cloud provisioning is an explicit caller input, not an automatic login or retry.

```ts
import { PortableMapAcquisition, type MapSessionProvisioning } from '@keesmod/eufy-mega-client';

async function readMaps(provisioning: MapSessionProvisioning, signal: AbortSignal) {
  const maps = new PortableMapAcquisition(provisioning);
  try {
    const result = await maps.acquire({ demandMs: 30_000, signal });
    // Check these independently. A retained result may predate this demand.
    return result;
  } finally {
    await maps.shutdown();
    maps.clearLastComplete();
  }
}
```

`acquire` keeps receiving for the caller's demand, including negotiation.
The default is 30 seconds, with a 1 to 60,000 ms bound. There is no quiet-time
completion heuristic. A later full path can arrive after an initial empty
cleaning-path update. Each is a complete transport file if its framing and byte
count agree. Geometry interpretation and persistent path accumulation belong to
existing [#51](https://github.com/keesmod/eufy-mega-client/issues/51) and
[#52](https://github.com/keesmod/eufy-mega-client/issues/52).

The first snapshot of each demand requires complete files for all three names
from that demand and a correlated download acceptance. Subsequent complete
files replace only their own stream. This is a collection of last complete
transport files, not a claim of a simultaneous geometry revision across streams.
The opaque packet count does not establish such a revision. Partial files,
wrong tasks, unknown names, noncontiguous indices, contradictory totals and
oversized input never replace a previously published snapshot. A new demand
cannot combine its incomplete files with files retained from a previous session.

`lastComplete` exposes copied bytes, a local monotonic `revision` and a local
`receivedAt` timestamp. It can be read during acquisition and survives a failed
or cancelled demand. Neither the getter nor the returned result permits callers
to mutate the adapter's retained bytes. Snapshots contain private lawn data.
Do not log, upload or include them in diagnostics. Call `clearLastComplete` when
idle to release the adapter's retained bytes. Caller-owned copies remain the
caller's responsibility.

## Stopping and failure

Demand expiry, the caller's AbortSignal, `disconnect` and `shutdown` freeze
publication. Once a download has been requested, stopping sends exactly one
cancel and waits at most five seconds for its correlated response. Incomplete
replacement data cannot prevent cancellation or destroy the retained result.
Late file data cannot update the snapshot after stopping. Before download,
stopping closes the negotiating resources directly. A carrier failure or invalid
protocol input closes resources without replay or reconnect.

Every result reports `reason`, `cancellationConfirmed`, `cleanupConfirmed` and
optional `lastComplete`. A prior snapshot does not prove a successful current
session. An unconfirmed peer cancellation is distinct from confirmed local
socket closure. A forced cancellation timeout reports `cancel_unconfirmed`.
Unconfirmed local cleanup always reports `cleanup_unconfirmed` and permanently
prevents further acquisition on that instance. `disconnect` and
`shutdown` wait for cleanup and reject with `shutdown_incomplete` if it cannot
be confirmed. Repeated shutdown shares one promise. Shutdown prevents new work.
Disconnect allows a later explicit demand with fresh random session identities.
There is no automatic replay.

Concurrent demands reject with `mower_map_busy`. Invalid duration rejects with
`mower_map_invalid_demand`. Expired, malformed or structurally mismatched private
provisioning rejects with `mower_map_invalid_provisioning`, before network I/O.
Provisioning is copied and revalidated for every demand. At least 65 seconds of
validity must remain, covering the maximum demand and cancellation window.
Protocol exceptions never expose upstream payloads, credentials or endpoints.

## Resource bounds and isolation

- Authentication negotiation is bounded to 15 seconds. The demand timer is
  never reset by traffic. Cancellation and local cleanup each have a five-second
  deadline, making the maximum demand plus shutdown window 70 seconds.
- Socket read/write queues are bounded to 64 KiB. TLS certificate and hostname
  verification remain enabled for the regional MQTT broker.
- Carrier records are at most 4 KiB, command payloads 32 KiB and command buffers
  64 KiB. The application version response is exactly correlated.
- File accumulation is at most 8 MiB per file, 1 MiB per chunk and 2 MiB pending
  stream data. A file has at most 16,384 chunks. Three complete candidates and
  three retained files are bounded separately. Defensive getter copies are
  owned by the caller.
- Command and file channels have independent bounded KCP ordering. At most five
  application sends are possible: authorization, version, album, download and
  cancellation. No arbitrary filename or operation is accepted.
- Sockets register before I/O. Hard closure destroys them, waits for their close
  events, settles negotiation producers, clears timers and drops parser state.
  Runtime-owned key buffers and retained scratch bytes are cleared on closure.

The final adapter uses Node built-ins and compiled library modules. It has no
Android, vendor Android binary, native SDK emulator, subprocess or remote-helper
runtime dependency. Research scripts remain separate historical reproduction
tools and are outside the package. Mower credentials and sessions stay separate
from the camera client. Acquisition has no physical control or setting methods.
It does not change `observe_only` or the existing Android map source.

## Feature evidence

| Device and route                                                        | Feature                                                                                      | Evidence                                                                                                                                                                                                                                                        | Claim                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| E15 T2880, owner-reported firmware 6.9.28, authenticated MQTT/TCP relay | Album and exact three-file transfer                                                          | [#49 live receipt](research/E15_PORTABLE_MAP_TRANSFER_2026-09-10.md)                                                                                                                                                                                            | Prior standalone Linux research hardware proof    |
| Same independently evidenced profile                                    | Library acquisition, last-complete preservation, cancellation and cleanup                    | [Implementation](../src/mowers/maps/acquisition.ts), [negative and lifecycle tests](../test/map-acquisition.test.mjs), existing CI                                                                                                                              | Experimental software coverage from #50           |
| E15                                                                     | Geometry decoding, persistent path history, source compatibility and architecture acceptance | Existing [#51](https://github.com/keesmod/eufy-mega-client/issues/51), [#52](https://github.com/keesmod/eufy-mega-client/issues/52), [#53](https://github.com/keesmod/eufy-mega-client/issues/53), [#54](https://github.com/keesmod/eufy-mega-client/issues/54) | Separate existing feature obligations remain open |
| E18 or other route/firmware                                             | Portable acquisition                                                                         | No hardware evidence                                                                                                                                                                                                                                            | Unclaimed                                         |

The new tests use synthetic peer bytes, authenticated signaling and carrier
framing. They exercise late full paths after 900 ms, invalid replacements,
pre-acceptance data, late cancellation data, concurrent and repeated demand,
freshness revalidation, negative identity binding and bounded cleanup. A real
loopback TCP test verifies pending reads and socket closure. Existing camera and
mower tests continue to pass. CI runs the compiled adapter on Linux with Node 24.
These software checks do not claim a new hardware trial or controlled migration.
No live source was changed for this implementation story.

## Provenance and upgrade

The TypeScript codecs and session adapt the project's independently authored
[#78](research/E15_LINUX_PEER_RESPONSE_2026-09-10.md) and
[#49](research/E15_PORTABLE_MAP_TRANSFER_2026-09-10.md) Node research. Those receipts
pin the original permitted artifacts and independently reproduced wire evidence.
No source, schema, constant, fixture or test was copied or translated from the
unlicensed mower fork. The original Android source remains recoverable.

Version 0.4.0 adds this API without changing existing camera or mower identifiers
or persisted sessions. It remains unreleased until separately authorized.
Consumers can opt into this adapter with current private provisioning after
publication. Retain the previous package and existing source for rollback.
No product deployment, release publication or automatic migration is included.
