# Private map provisioning, 2026-09-25

This implements the missing producer in
[mower acceptance #8](https://github.com/keesmod/eufy-robomow-ha/issues/8).
Change class: architecture extension inside the existing Home/Tuya owner.
The producer reads the current RTC configuration of one discovered mower.
It neither opens a map connection nor issues physical commands.

## Independent evidence

The inputs are original vendor artifacts and the owner's retained runtime
observations from the earlier successful map-transfer research. No code,
constants, schema, fixture or test was taken from an unlicensed mower fork.
The artifacts and raw observations remain private and outside the package.

- Three successfully authenticated MQTT sessions exposed the same app profile.
  Two retained the corresponding Tuya login. Recomputing both credentials from
  those logins reproduced their observed values. The native Tuya `uid`, rather
  than the Home login name, binds the MQTT client and the RTC session.
- The observed RTC request is `tuya.m.rtc.config.get`, version `1.0`, with
  `{devId}`. Its result carries `id`, `password`, `p2pId` and `p2pConfig`.
  An empty `p2pId` was observed. `p2pConfig.expire` is epoch seconds.
  The response supplies `preconnect`, `ices` and `tcpRelay`. Cached session
  identities and AES keys are never reused.
- The distributed Android app profile supplies the application signature and
  MQTT channel. They are public application constants, not household
  credentials. The existing app client ID and signing profile retain their
  attribution in [Home authentication provenance](../MOWER_AUTH_PROVENANCE.md).

For the observed profile, let `md5` mean lowercase MD5 hex of UTF-8 text.
The username is `partnerIdentity + "_v1_" + clientId + "_29e5ad57_mb_" + sid`
followed by the last 16 characters of `md5(md5(clientId) + ecode)`.
The password is characters 8 through 23 of `md5(md5(appSignature) + ecode)`.
The client identifier is `partnerIdentity + "/mb/" + uid`.
The broker comes from `domain.mobileMqttsUrl`, restricted to the authenticated
Tuya region and TLS port 8883. The derived credentials are account secrets.

## Fresh signaling header

The earlier acquisition required an opaque header from a caller. To remove
that capture dependency, the original Tuya Android SDK 7.5.1 was inspected
directly from its official Maven repository:

| Original artifact                                                                                                                                                           | SHA-256 of AAR                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [thingsmart-mqtt](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-mqtt/7.5.1/thingsmart-mqtt-7.5.1.aar)                   | `e15ff17ecb3ecdf8337ae67a4dc8d494442f52a93d1af9708b57d3b2660651ef` |
| [thingsmart-device-api](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-device-api/7.5.1/thingsmart-device-api-7.5.1.aar) | `8cf42ff7c916519568e116918f3eea9b715851a333a1c4f892095b69df3da500` |
| [thingsmart-baselib](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-baselib/7.5.1/thingsmart-baselib-7.5.1.aar)          | `54f3ebd3ab497b801cdc50ab0eb09cd5758d175b89d5060648995c6699482b9d` |

`SandO` initializes S to 2 and O to a random integer in [1000, 1000999].
The original P2P publisher increments S before publishing and puts S and O
in `MqttControlBuilder`. The MQTT publisher `ddqdbbd.publishDevice` maps
them through `dppdpbd` and `bpqqdpq`. The 2.3 encoder `qqdbbpp` emits the
three ASCII version bytes, S, O and a zero flag. Both integers use
`ByteUtils.intToBytes2`, which is big endian. The entire 12-byte header is
the AES-GCM additional authenticated data.

A local JVM check executed the original `SandO` and `ByteUtils` classes:
initial S = 2, first S after increment = 3, O within that range, and
`intToBytes2(0x01020304)` = `01020304`. Vendor binaries are research inputs
only. They are neither shipped nor executed by the library.

Each new library session generates its own O and starts S at 3. Existing
callers that provide `mqttHeader` keep the historical byte-for-byte behavior,
including incrementing its second integer. This compatibility path is separate
from the newly generated original-SDK header.

## Boundaries and validation

`mowers.home.mapProvisioning: true` enables the producer on explicit connect.
The private session store then also contains derived MQTT credentials.
An older session without them is renewed once on an explicit connect, keeping
the existing opaque device identity. Provisioning itself never logs in,
retries, opens MQTT, or starts an acquisition.

Each call uses a discovered binding, makes one bounded RTC request, verifies
the returned device and any cached session's account/device identities, and
caps validity by both RTC and Home session expiry. At least 65 seconds must
remain. Abort, shutdown, re-discovery and revoked authentication invalidate
pending work. Only the required private fields are returned. They must never
enter a public bridge route, diagnostics or logs.

Synthetic tests cover the default-off gate, one request per explicit call,
restart reuse, migration from an older session, abort, timeout, shutdown,
revocation, identity mismatch, expiry, regional broker validation, copied
results, cached-secret exclusion and acquisition with a generated header.
Existing explicit provisioning and camera behavior remain covered.

These checks do not establish a new end-to-end hardware session. The producer
and generated header remain experimental until one bounded acquisition from
fresh provisioning succeeds on the owned E15 with confirmed cancellation and
cleanup. The Android helper stays recoverable until native acceptance and the
map-source migration rehearsal pass. No E18 support is claimed.
