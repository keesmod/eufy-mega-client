# Independent Home and Tuya authentication

Implementation and software evidence for [#40](https://github.com/keesmod/eufy-mega-client/issues/40).
The adapter extends the modular client from #16. It does not implement a bridge,
commands, local transport, RTC calls or maps. Change class: architecture extension
within the accepted independent-module boundary.

## Source review, 2026-09-10

| Component                                                                             | Exact permitted source                                                                                                                                                                   | Licence and use                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home login payload, app identity and headers                                          | [8none1/eufy-x8, 98e0d6506f457a2e2119e09a12cb7824d945804b](https://github.com/8none1/eufy-x8/tree/98e0d6506f457a2e2119e09a12cb7824d945804b), `api/auth.py` and `const.py`                | MIT, copyright 2026 Will Cooke. App version/header profile and the flat login response candidate                                                                                    |
| Tuya signing, password derivation, RSA and regional hosts                             | [8none1/robovac, 2e3280609e469f37a7b7d312b587841213367a9c](https://github.com/8none1/robovac/tree/2e3280609e469f37a7b7d312b587841213367a9c), `tuyawebapi.py`                             | Apache-2.0, copyright 2022 Brendan McCluskey. Source credits original work by Andre Borie                                                                                           |
| Nested Home login, settings-selected region, device projection and private key lookup | Same robovac revision, `eufywebapi.py` and `config_flow.py`                                                                                                                              | Apache-2.0. `user_info`, `setting.home_setting.tuya_home.tuya_region_code`, `items[].device.product.product_code`, `device.id`, and `tuya.m.device.get` are source-based candidates |
| E15 marketing model association                                                       | [Eufy E15 product](https://www.eufy.com/products/t28801a1) and [Eufy E15/E18 support](https://service.eufy.com/product-description/a08J1000000YhxDIAS/eufy-auto-robot-lawn-mower-e15e18) | Primary product documentation identifies E15 as T2880. It does not prove this account's cloud encoding                                                                              |
| Modern Eufy Clean comparison                                                          | [albertoxamin/eufyhome, 6cf038a5e4eaaefa397472a332eb0bcf4ddbc661](https://github.com/albertoxamin/eufyhome/tree/6cf038a5e4eaaefa397472a332eb0bcf4ddbc661), `api/eufy_api.py`             | MIT, copyright 2024 Alberto Xamin. Reviewed login and newer MQTT device routes. No implementation copied from this candidate                                                        |
| Lifetime ownership, response allowlists, session persistence and tests                | New implementation in this repository                                                                                                                                                    | Copyright 2026 keesmod. Synthetic fixtures, no mower-fork fixtures                                                                                                                  |

The x8 auth file explicitly names the Apache-2.0 predecessor. Its referenced
`fix_utf8` branch no longer exists. The pinned current robovac revision above
was inspected instead. The earlier GitLab original credited by robovac was not
publicly fetchable during this review. No original GitLab files were copied,
and the receipt does not claim that inaccessible revision was verified.

Retain [Apache-2.0](licenses/Apache-2.0.txt), the
[x8 MIT notice](licenses/eufy-x8-MIT.txt), and [NOTICE.md](../NOTICE.md) in the
package. The modified Home/Tuya files are Apache-2.0 adaptations with the MIT
app-profile attribution retained. The repository's existing MIT files retain
their licence. Do not remove the Apache notices when redistributing the bundle.

No unlicensed mower-fork code, constants, schemas, tests or fixtures were copied
or mechanically translated. No mower command, map payload or lawn geometry was
used to build these tests. The existing helper was not changed by #40.

## App constants and user secrets

The source-distributed Home `client_id` / `client_Secret`, Tuya `clientId`, signing
HMAC key, AES key/IV, device-ID prefix and app/version headers identify the mobile
app protocol. They are app constants, not the user's email, password, session,
local key or account UID. They remain subject to source attribution. Their
presence in source does not make a live account token safe to publish.

The following remain private: email/password, Home access token/user ID, Tuya
UID/SID, device IDs, identity salt, local keys and complete cloud responses.
The injected HTTP function and session store are trusted private boundaries.
They receive secrets and must not log their arguments. No diagnostic callback
or raw cloud-error propagation is introduced. Public results contain only an
opaque account-scoped ID, `kind`, `model` and `productCode`. User-assigned names
are deliberately absent because they can contain private identifiers.

## Implemented lifecycle

Omitting `mowers` constructs no Home owner and makes no request. Enabling it uses
the new adapter by default. An explicitly supplied adapter remains supported.
Security authentication and persistence are unchanged and independently owned.

An explicit `connect()` restores only a session bound to the configured account,
country and password. It validates a retained Tuya SID with the read-only home
list. A locally expired or server-revoked retained SID permits one fresh login
within that explicit connect. Other transport errors do not trigger a login
fallback. There is no automatic retry and no fallback to a default password.

Reuse is conservatively limited to one hour locally. This is a client policy,
not a measured server token lifetime. Discovery reporting an expired session
invalidates the owner and requires another explicit connect. Credentials are
never sent to a cloud-supplied arbitrary URL. HTTP redirects are rejected. The
Tuya origin allowlist is EU, AZ, AY and IN from the pinned source. Unknown Home
hosts, missing regional settings and unknown regions fail explicitly.

Discovery follows the licensed nested Home device projection and queries only
exact T2880 candidates through `tuya.m.device.get`. It requires the returned
`devId` to match the selected Home ID and a present local key. E18 and unknown
products do not become E15 devices. This is software coverage of a source-based
profile, pending independent account/device evidence.

The internal `EufyHomeAdapter.withConnection(id, signal, callback)` gives trusted
library code a private account UID, device ID, local key, region and expiry. It
requires a successful discovery. Cancellation, shutdown, expiry and a subsequent
discovery revoke the supplied signal. Callbacks must honor that signal and must
not retain or serialize connection values. This method and its connection type
are not exported by the public package entry point. #48 may extend the internal
owner after live binding is proved. No generic cloud or RTC request API is
exposed in #40.

## Software evidence and remaining acceptance

`test/mower-auth.test.mjs` uses invented account, key, device and response values.
It covers regional selection, endpoint rejection, rejected credentials, explicit
session renewal, account separation, disabled modules, cancellation, timeout,
shutdown, binding mismatch, connection revocation and privacy. Crypto vectors
were independently reproduced using Python hashlib/hmac, integer modular
exponentiation and OpenSSL AES-CBC with synthetic inputs. Those vectors confirm
byte-level crypto behavior, not authentication by a real E15 account.

Existing modular tests continue to verify camera/mower failure and shutdown
isolation. The legacy EufyMegaClient exports and camera tests remain intact.
Software tests do not establish current E15 protocol or physical support.

The prepared live login/discovery experiment was rejected before execution by
automatic approval review. It requires direct user approval for credentials
from the existing HA owner to be sent to Eufy/Tuya. No credentials were sent,
no cloud session was created and no service was changed by this story.

Remaining #40 acceptance: run the bounded independent experiment, verify the
actual Home profile and exact E15/Tuya binding, compare the independently fetched
local key with the configured key in memory, retain only safe booleans and
structural evidence, and validate recovery. Correct any profile differences
before marking #40 passed. #40 and parent E3 remain open. #48 must not treat the
source-based internal connection contract as a verified live binding.
