# Firebase client API key

The `GOOGLE_API_KEY` constant in `vendor/src/push/service.ts` is inherited
Eufy Android app configuration used by the Firebase push-notification transport.
It is intentionally retained. This document records its provenance and the
maintainer's decision for [secret-scanning alert #1](https://github.com/keesmod/eufy-mega-client/security/secret-scanning/1)
without reproducing the value.

## Origin and verification

The constant comes from the MIT-licensed
[`bropat/eufy-security-client` source](https://github.com/bropat/eufy-security-client/blob/d75e7996d4cbce3839a6075bed95b752ccc3ee43/src/push/service.ts#L45-L52),
version `4.1.1-1`, commit `d75e7996d4cbce3839a6075bed95b752ccc3ee43`.
[NOTICE.md](../NOTICE.md) records the protocol-code attribution.

It entered this repository at line 51 in the initial implementation commit
[`1c5fd3e7be1e91232d29e081cafaea0b50aa6413`](https://github.com/keesmod/eufy-mega-client/commit/1c5fd3e7be1e91232d29e081cafaea0b50aa6413).
On 2026-09-10, an in-memory comparison confirmed that the alert value, the
upstream constant and this repository's main commit
`be77e4be5ddefdd04136e3053535b7b57d5595a5` matched exactly. The comparison
reported only equality results and public app identifiers.

The surrounding upstream configuration identifies Eufy's Android package
`com.oceanwing.battery.cam` and Firebase project `batterycam-3250a`.
This establishes the inherited app-configuration origin. It is not evidence
that a maintainer supplied a personal Google Cloud credential.

## Why the transport needs it

The push service sends the constant in the `x-goog-api-key` header to the
Firebase Installations API. It uses it when registering an installation and
renewing that installation's authentication token. These operations support
the Firebase Cloud Messaging registration used to receive Eufy notifications.
Removing the constant without replacing this mechanism would break those
registration and renewal requests.

The shared app key is distinct from account credentials and per-installation
tokens. Eufy passwords, session state, installation refresh tokens and device
keys must remain private.

## Security assessment and limits

[Google documents Firebase client API keys](https://firebase.google.com/docs/projects/api-keys)
as project/app identifiers intended for client code. Authorization for Firebase
resources depends on separate controls such as Security Rules, IAM and App
Check. Public inclusion is appropriate only with the required API restrictions
and resource-access protections. A key enabled for unrelated Google APIs can
still expose quota or billable usage.

At review time, GitHub marked alert #1 as publicly leaked with validity
`unknown`. The maintainers have not verified Eufy's Google Cloud restrictions,
enabled APIs, billing exposure or Firebase resource-access rules. The source
comparison does not establish that the key is inactive or harmless in every
context. No requests were made with the key to test its permissions.

## Alert disposition

On 2026-09-10, the maintainer requested that this provenance be documented and
then alert #1 be dismissed. The decision is to retain the inherited public app
configuration and resolve that individual alert as **Won't fix**
(`wont_fix`), linking the merged documentation in the resolution comment.
This acknowledges intentional use and the assessment limits. It does not
claim revocation, an invalid key or a test-only credential.

Keep secret scanning and push protection enabled. This decision applies only
to the value and use reviewed in alert #1. Reassess if the upstream key, its use
or evidence about its permissions changes. Investigate other alerts separately.
