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

Releases require the complete target-hardware and HA acceptance matrix, 24 hours
of observation, rollback instructions and inspection of downloaded release
assets. Publish the compiled package through GitHub Releases, then pin its exact
URL and integrity in the consuming bridge. npm publication is not part of 0.1.0.
