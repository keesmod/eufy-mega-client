# Camera capability projection

`getCameraCapabilities(id)` returns `snapshot`, `live` and `recordings`, each with
`available`, `status` and `reason`. This additive API serves
[camera story #19](https://github.com/keesmod/ha-eufy-cam/issues/19).

The method initializes the private adapter as a state read does, then evaluates
its actual camera media and owner guards. It opens no device connection and
issues no media command. Unknown cameras, invalid relationships, standalone
transport, initialization failures, missing credentials and unverified firmware
profiles retain the same public error code as `reason`. It returns fresh objects.

Since 0.30.1 an [experimental standalone](API.md#experimental-standalone-cameras)
camera reports `recordings` as `{ available: false, status: 'unsupported',
reason: 'standalone_recordings_unverified' }` for
[ha-eufy-cam#175](https://github.com/keesmod/ha-eufy-cam/issues/175), because no
request has enough evidence to list and play recordings on that route. Its
thumbnail and download
fail with the same code before any connection. A download of a record with a
cipher ID fails with `recording_cipher_unavailable` first, because it would need
a cloud cipher. Its snapshot and live are unchanged, and cameras under a
HomeBase keep their recordings capability. List and calendar stay owner-wide
metadata calls, as described below.

An available operation has status `experimental` and reason null. This describes
software admission, not reachability, idle ownership, fresh imagery or physical
support. Runtime operations still enforce authentication, concurrency, connection,
command and stop/cancel checks. Recordings here means the complete camera media
workflow. Owner-wide metadata may include cameras whose downloads are unavailable.

Consumers must tolerate unknown optional fields. They should display unsupported
operations with a reason and prevent starting them. Missing metadata from older
clients is unknown and must not become a hardware-support claim. Camera identities
and the existing discovery/state methods are unchanged. Standalone devices retain
kind camera and do not become HomeBase alarm entities.

The synthetic capability tests cover all current eufyCam and battery doorbell media
profiles, owner failure, firmware rejection, result isolation and public standalone
rejection. Existing media tests retain command and lifecycle evidence. No physical
hardware was tested. At 0.10.0, model-specific acceptance was in client
#55/#58, SoloCam #56 and camera #10, with migration and legacy retirement in
camera #20/#24.

Version 0.10.0 was published on 2026-09-11 and needs no session migration. Retain
the previous package and private session store for rollback. Consumer package
validation must be completed separately before changing a pinned consumer
dependency.
