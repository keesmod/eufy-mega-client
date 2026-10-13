# Eufy Mega client

An unofficial TypeScript library for Eufy security cameras on a HomeBase 3 (T8030), with a
separate module for the Eufy E15 robotic mower (T2880). It is distributed as the ESM-only package
`@keesmod/eufy-mega-client` for Node.js 24. Several features are experimental or opt-in. See
[Feature status](#feature-status).

Building a Home Assistant installation? Use
[Eufy Security Viewer](https://github.com/keesmod/ha-eufy-cam), the camera integration and
bridge, or [Eufy Robomow](https://github.com/keesmod/eufy-robomow-ha), the E15 mower
integration and optional bridge, instead.

## Requirements

- Node.js 24 and an ESM project.
- Eufy account credentials and private storage for sessions. Use separate credentials and session
  stores for the camera (`security`) and mower (`mowers`) modules.
- For cameras, access to the HomeBase LAN. Do not run a second application that controls the same
  HomeBase, such as the Eufy Security Viewer Bridge. Only host networking reached the HomeBase in
  testing. See the [connection limits](docs/COMPATIBILITY.md#connection-and-operating-limits).
- For the local mower session, the LAN address of the mower.

## Install and upgrade

Packages are published through
[GitHub Releases](https://github.com/keesmod/eufy-mega-client/releases), not the npm registry.
Each package contains compiled JavaScript and type declarations. Install a release with an exact
version:

```sh
npm install --save-exact https://github.com/keesmod/eufy-mega-client/releases/download/v0.29.2/keesmod-eufy-mega-client-0.29.2.tgz
```

Commit your lockfile so `npm ci` verifies package integrity. Releases also publish `SHA256SUMS`
and a `release-manifest.json` with file hashes.

To upgrade:

1. Read the [changelog](CHANGELOG.md) entries after your current version up to the target version,
   including their upgrade and rollback notes.
2. Back up your private session stores and keep the previous package and lockfile for rollback.
3. Install the target release's exact `.tgz` URL and verify your application.

## Usage

All imports come from `@keesmod/eufy-mega-client`. The [API guide](docs/API.md) is the full
reference. The package exports two client classes:

- `EufyMegaClient` is the camera-only client. Start with the
  [camera quick start](docs/API.md#camera-quick-start).
- `EufyClient` holds optional `security` and `mowers` modules. The `security` module has the same
  camera API. Use this class for the mower, alone or with cameras. See
  [modular clients](docs/API.md#modular-clients).

Open a [local session](docs/API.md#read-only-local-mower-session-0130) for mower telemetry.
[Commands](docs/API.md#opt-in-mower-commands-0160-and-0170) and
[settings](docs/API.md#opt-in-mower-settings-0200) use the same session behind separate opt-ins.

Call `connect()` explicitly and pass authentication challenges to your own user interface. The
library does not retry authentication or physical commands automatically.

## Feature status

Status labels:

- **Opt-in**: stays off until your client enables it.
- **Experimental**: software coverage without complete hardware validation.
- **Observed on hardware**: dated results on real devices. They apply only to the devices,
  firmware and conditions in the linked evidence.
- **Read-only**: never writes to a device.

Recognizing a model does not mean that every feature works on it.

### Security cameras

| Area                | Status                             | Notes                                                                                                                                                              |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HomeBase 3 cameras  | Experimental, observed on hardware | Discovery, state, events, Guard Mode, snapshots, live media and recordings.                                                                                        |
| Standalone cameras  | Opt-in, experimental               | `experimentalStandalone` covers only the T84A1 and T8410. No confirmed hardware result yet. See [standalone cameras](docs/API.md#experimental-standalone-cameras). |
| Other hubs and NVRs | Not supported                      | Older HomeBases, HomeBase Mini and PoE cameras behind an NVR. See the [topology inventory](docs/MODEL_MATRIX.md#topology-inventory).                               |

Media is enabled per exact model, as listed in the [device profiles](docs/DEVICE_PROFILES.md),
and reports `status: 'experimental'` in `CameraCapabilities`. Hardware results differ per model.
The dated baseline covers a T8030 with T8160 cameras and a T8213 doorbell. See the
[model and feature matrix](docs/MODEL_MATRIX.md).

### E15 mower

The mower APIs support only the Eufy E15 (T2880). Hardware results come from the maintainer's E15
on firmware 6.9.28. Other firmware and the E18 are not claimed.

| Area                         | Status                                        | Notes                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and discovery | Observed on hardware                          | Validated with an EU account. Other regions have synthetic tests only. See the [mower profile](docs/API.md#hometuya-mower-profile-031).                                |
| Local telemetry              | Read-only, observed on hardware               | Battery, Wi-Fi, signal and the mowing, paused and returning activities. Mowing progress stays `unconfirmed`. See [telemetry](docs/MOWER_TELEMETRY.md).                 |
| Commands                     | Opt-in, observed on hardware                  | Start, pause, resume and stop. After a stop the mower drove itself back to the dock. `return` had no effect. See [commands](docs/MOWER_COMMANDS.md).                   |
| Settings                     | Opt-in, observed on hardware                  | Writes mow height, volume, smart no-go zones and sparse lawn optimization. Tested on a docked mower. See [settings](docs/MOWER_SETTINGS.md).                           |
| Work parameters              | Opt-in, observed on hardware                  | Writes the mow and blade speeds. Tested on a docked mower, without the `low` speeds. See [work parameters](docs/MOWER_WORK_PARAMETERS.md).                             |
| Cloud state                  | Read-only, observed on hardware               | A cloud cache of activity, charger contact and work parameters. Never use it to confirm a write. See [cloud state](docs/API.md#mower-cloud-state).                     |
| Map acquisition              | Read-only, experimental, observed on hardware | Ran on amd64, not yet on aarch64. Session credentials come from your code or the `mowers.home.mapProvisioning` opt-in. See [map acquisition](docs/MAP_ACQUISITION.md). |
| Map geometry                 | Experimental, observed on hardware            | Millimetre units are assumed, the coordinate frame is unconfirmed and geometry is display only. See [map geometry](docs/MAP_GEOMETRY.md).                              |
| Path history                 | Experimental                                  | Merges decoded cleaning paths across acquisitions. Software and capture tests only. See [path history](docs/MAP_GEOMETRY.md#accumulated-cleaning-path-history).        |

## Compatibility and feedback

The [compatibility results](docs/COMPATIBILITY.md) and
[model and feature matrix](docs/MODEL_MATRIX.md) hold dated hardware results. You can upgrade
without a hardware result for your exact model.

Working and failing results both help. Use the voluntary
[camera compatibility report](https://github.com/keesmod/ha-eufy-cam/issues/new?template=compatibility.yml)
in the Eufy Security Viewer repository, or add results to an existing issue for your problem.
Report E15 results in the [Eufy Robomow issues](https://github.com/keesmod/eufy-robomow-ha/issues)
and library bugs in [this repository's issues](https://github.com/keesmod/eufy-mega-client/issues).
See [community evidence](docs/COMMUNITY_VALIDATION.md) and
[diagnostics](docs/DIAGNOSTICS.md) for what to share safely.

## Project and development

- [Programme decisions and working rules](docs/PROGRAMME.md)
- [Changelog](CHANGELOG.md) and [releases](https://github.com/keesmod/eufy-mega-client/releases)
- [Contributing and building from source](CONTRIBUTING.md) and
  [release process](docs/RELEASING.md)
- [License](LICENSE) and [component attribution](NOTICE.md)

This project is independent of Eufy and Anker and uses Eufy's cloud services. The package includes
MIT and Apache-2.0 components.

## Support this project

If this project is useful to you, consider
[buying me a coffee](https://buymeacoffee.com/keesmod) to support its maintenance
and development. Contributions are optional.
