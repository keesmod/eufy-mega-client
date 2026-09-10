# Contributing

Use Node.js 24. Run `npm ci` and `npm test`; `npm pack` builds the distributed
ESM JavaScript, declarations and protocol assets. Test the tarball in a consumer
as well as the source checkout.

Keep cloud authentication/discovery, device connections, events and recordings
separate. Device code receives credentials through an explicit interface. Do
not add legacy HTTP fallback, SDK objects to public types, FFmpeg, HA entities
or a separate service. New protocol behavior needs a sanitized fixture and a
test that distinguishes command acknowledgement from observed device state.

Protocol changes require the source commit, applicable license/attribution and
an explanation of the wire behavior. Update NOTICE.md when reusing code.
Document vendor changes separately from original upstream behavior. Do not copy
proprietary app implementation into this MIT project.

Run hardware tests with one controller at a time. Back up private state, bound
physical actions, arrange recovery and restore Guard Mode. A successful command
call is not proof of a physical result. Report missing features and uncertain
history explicitly. Adding another model requires its own compatibility evidence.

Follow [the release flow](docs/RELEASING.md). Protocol/device/media changes need
acceptance on the declared hardware and HA routes; document observation duration
and unproven behavior. The first release used an explicitly agreed 11-hour-26-minute
window, not a 24-hour test. CI-only changes do not need a physical device test.

Publish and verify the compiled package through GitHub Releases, then pin its
exact URL and integrity in the consuming bridge and validate that repository.
Do not publish a new library version solely for CI/documentation changes.
