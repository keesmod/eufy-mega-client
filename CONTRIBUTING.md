# Contributing

## Build from source

Use Node.js 24:

```sh
npm ci
npm test
npm pack
```

`npm pack` builds the distributed ESM JavaScript, declarations and protocol
assets. Install the resulting `.tgz` in a consuming project:

```sh
npm install /path/to/keesmod-eufy-mega-client-0.10.0.tgz
```

Use the filename printed by `npm pack` for your checkout's version. Test the
tarball in a consumer as well as the source checkout.

## Development and validation

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

## Community results

You can contribute scoped hardware results without owning development tools.
Read the [community evidence policy](docs/COMMUNITY_VALIDATION.md). For camera
installations, use the [compatibility form](https://github.com/keesmod/ha-eufy-cam/issues/new?template=compatibility.yml)
or add results to the existing issue for that problem. Successes and partial
results both help. Reports are voluntary and are not an upgrade requirement.
