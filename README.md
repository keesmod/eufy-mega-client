# Eufy Mega client

An unofficial, independent TypeScript library for Eufy's Mega cloud and HomeBase
device protocols. Node.js 24, ESM and MIT licensed. It is not affiliated with
Eufy or Anker.

Version 0.1.0 is tested with HomeBase 3 T8030, three T8160 cameras and a T8213
doorbell through Home Assistant. See [compatibility results](docs/COMPATIBILITY.md)
for firmware, verified features and the limits of the overnight observation.

Version 0.1.1 adds discovery for S220 T8142 and T8134 cameras
paired with T8030. Hardware validation is incomplete. See the compatibility document for partial
T8134 reporter results and unresolved live-view and recovery failures.

Install the compiled GitHub release with Node.js 24:

```sh
npm install --save-exact https://github.com/keesmod/eufy-mega-client/releases/download/v0.1.0/keesmod-eufy-mega-client-0.1.0.tgz
```

Commit the consumer's lockfile so `npm ci` verifies package integrity. The
package is distributed through GitHub Releases, not the npm registry.

To build from source:

```sh
npm ci
npm test
npm pack
```

Install the resulting `.tgz` into a consuming project with `npm install
/path/to/keesmod-eufy-mega-client-0.1.0.tgz`.

```typescript
import { EufyMegaClient, FileSessionStore } from '@keesmod/eufy-mega-client';

const client = new EufyMegaClient({
  credentials: {
    email: process.env.EUFY_EMAIL!,
    password: process.env.EUFY_PASSWORD!,
    country: 'NL',
  },
  sessionStore: new FileSessionStore('/private/eufy/mega-session.json'),
});

try {
  const auth = await client.connect();
  if (auth.state === 'connected') {
    const devices = await client.listDevices();
    const station = devices.find((device) => device.kind === 'station');
    if (station) await client.connectStation(station.id);
    // Select devices by their stable IDs; use the operations in the API guide.
  }
  // Return authentication challenges to your UI. Do not retry them in a loop.
} finally {
  await client.shutdown();
}
```

The process must be on the HomeBase LAN. The tested Home Assistant deployment
uses host networking, with its bridge API bound to loopback. Routed/VLAN and
Docker bridge discovery have not passed acceptance. Only one controlling
bridge should use this installation at a time.

The library uses Eufy's cloud and local device protocols. Mega support does not
make the system independent of Eufy. There is no legacy cloud fallback.

The library returns device operations and raw media streams. FFmpeg, playback,
viewer leases and Home Assistant entities belong in the consuming bridge.

- [Eufy platform programme and backlog](docs/PROGRAMME.md)
- [API guide](docs/API.md)
- [Compatibility and limitations](docs/COMPATIBILITY.md)
- [Sanitized diagnostics](docs/DIAGNOSTICS.md)
- [Contribution guide](CONTRIBUTING.md)
- [Upstream attribution](NOTICE.md)

Maintainers: use the [validated release flow](docs/RELEASING.md) for version checks,
package verification, a rehearsal and explicit GitHub publication.
