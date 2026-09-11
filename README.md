# Eufy Mega client

An unofficial TypeScript library for Eufy cameras and HomeBase devices, with
separate mower APIs under development. It provides discovery, state, snapshots,
live media, events and recordings for implemented camera profiles.

Building a Home Assistant installation? Use the
[camera integration and bridge](https://github.com/keesmod/ha-eufy-cam) or the
[separate mower project](https://github.com/keesmod/eufy-robomow-ha).

## Requirements

- Node.js 24 and an ESM project.
- Eufy account credentials and private storage for sessions.
- Access to the HomeBase LAN for camera device connections. Use one controlling
  bridge per installation.

## Install and upgrade

Install the compiled GitHub release:

```sh
npm install --save-exact https://github.com/keesmod/eufy-mega-client/releases/download/v0.12.0/keesmod-eufy-mega-client-0.12.0.tgz
```

Commit your lockfile so `npm ci` verifies package integrity. Packages are
published through [GitHub Releases](https://github.com/keesmod/eufy-mega-client/releases),
not the npm registry.

For an upgrade, read the target release notes, back up your private session store
and retain the previous package and lockfile for rollback. Install the target
release's exact `.tgz` URL and verify your application.

Start with the [camera example and API guide](docs/API.md#camera-quick-start).
To build from source, see [Contributing](CONTRIBUTING.md).

## Compatibility and feedback

Missing hardware test results alone do not prevent upgrades. Available features
still depend on the model, firmware and connection. See the
[compatibility results](docs/COMPATIBILITY.md) and
[model and feature matrix](docs/MODEL_MATRIX.md).

Working and failing results both help. Use the voluntary
[camera compatibility report](https://github.com/keesmod/ha-eufy-cam/issues/new?template=compatibility.yml),
or add results to the existing issue for your problem. See
[community evidence](docs/COMMUNITY_VALIDATION.md) and
[diagnostics](docs/DIAGNOSTICS.md) for what to share safely.

## Independent module API

`EufyMegaClient` remains available. `EufyClient` adds independent `security` and
`mowers` modules with separate credentials and sessions. Mower support includes
E15 authentication/discovery and a separate read-only map acquisition API.
Physical controls and decoded maps are not delivered. See the
[modular API](docs/API.md#modular-clients) and [map limits](docs/MAP_ACQUISITION.md).

## Project and development

- [Programme and backlog](docs/PROGRAMME.md)
- [Contributing](CONTRIBUTING.md) and [release process](docs/RELEASING.md)
- [License](LICENSE) and [component attribution](NOTICE.md)

Independent of Eufy and Anker. The package includes MIT and Apache-2.0 components
and uses Eufy's cloud services.
