# E15 independent authentication and discovery validation

Live acceptance evidence for [#40](https://github.com/keesmod/eufy-mega-client/issues/40),
2026-09-10. This completes the live obligation left by PR #75. Change class:
patch to the observed EU Home host and the private account-UID role.

## Authorization and ownership

The user directly approved live testing and the work needed to complete #40,
including longer bounded trials. #48 explicitly confirmed idle before the
initial window, its extension and the compiled-library trial. #40 owned the
cloud-login slot. #48 did not run a competing login, refresh or device session.

No device command, mower movement, setting change, RTC/map request, bridge
activation or product deployment was performed. No helper service was stopped
or modified. Credentials were read and used only on their existing HA owner.
The owner reported E15 firmware 6.9.28 earlier on this date. The present trials
do not independently re-read or validate that firmware version.

## Independent Python observation

The private probe was independently written from the pinned permitted sources
listed in [component provenance](../MOWER_AUTH_PROVENANCE.md). It used Python,
standard HTTPS, cryptography AES and integer RSA. It did not import any mower
fork or invoke its authentication code. Only response field types, fixed model
checks and boolean equality results were emitted.

The initial Home login succeeded, but processing stopped because the actual
`user_info.request_host` was absent from the strict allowlist. A second bounded
probe exposed only the structural cause. The subsequent complete probe added
that exact host and succeeded. It established:

- Home uses the nested `user_info` profile and
  `https://appliances-api-eu.eufylife.com` for settings and discovery.
- `setting.home_setting.tuya_home.tuya_region_code` selects EU.
- The Tuya mobile login returns `https://a1.tuyaeu.com` as its mobile origin.
- `items[].device.product.product_code` equals T2880 for the configured E15.
- Home `device.id`, Tuya `devId` and the configured HA device ID are equal.
- The independently fetched `localKey` is present and equals the existing
  configured key in memory.

No identifier, token, password, local key, device alias, DPS, coordinates or
full response was retained. The host and field projections are protocol facts,
not a transferable authenticated session.

## Compiled-library trial

The real compiled `EufyHomeAdapter` and its compiled dependencies ran on Node
24.21.0 in a temporary container on the HA owner. An existing image supplied
Node only. Its bridge entrypoint was not started. The root filesystem and the
single configuration-file mount were read-only, capabilities were dropped and
all trial files/session data were temporary. The first container exited before
Node ran because tar attempted to restore file ownership. The corrected command
kept container ownership without granting additional capabilities.

The tested compiled Home module SHA-256 was
`aff1efe96c5e3c6397793ac1be6eb553eaa885eeedd3f5ec6c6fdc0bed6b2a4d`.
The final formatted build hash is
`9f8b79286d15ffb9e2de271373748901b98915a4b68fc0dbfba64dee08a17724`.
An exact diff and byte comparison verified that the only change after the live
trial is one line break in the host allowlist condition. The protocol dependency
and error class are byte-identical. No live retry was needed for formatting.
Only that module, its protocol dependency and the public error class were loaded.
The network wrapper observed response UID equality in memory. It did not change
requests or responses and did not log HTTP payloads.

The trial passed these assertions:

| Check                                                                 | Result    |
| --------------------------------------------------------------------- | --------- |
| Explicit Home/Tuya connect                                            | Connected |
| Native Tuya login response `uid` present                              | True      |
| Native Tuya `uid` equals the Home login name `eh-{Home ID}`           | False     |
| Private callback `accountUid` equals native Tuya response `uid`       | True      |
| Private callback device ID equals configured E15 ID                   | True      |
| Private callback local key equals configured key                      | True      |
| Effective private region is EU                                        | True      |
| Public output fields are exactly id, kind, model, productCode         | True      |
| Public ID differs from the real device ID                             | True      |
| Shutdown and recreate the adapter with its serialized private session | Passed    |
| Restored SID validated through read-only home list                    | Once      |
| Public identity retained after restore/discovery                      | True      |
| Total Home logins in compiled trial                                   | One       |

This establishes the account/device binding and source profile for this owned
EU E15. The native Tuya UID is deliberately separate from the Home login name.
The latter must not be handed to #48 as the native account UID. Neither value
is part of public device output.

## Recovery and cleanup

The temporary validation container was removed. The normal helper remained
active with its original `2026-09-10T16:50:11Z` activation time. The emulator
retained `2026-09-08T19:45:32Z`. Both had no runtime override.

The configured normal refresh interval is 300 seconds. A subsequent normal
snapshot was written at `2026-09-10T17:56:58.930197Z`, after the compiled trial
finished around `17:53Z`. The inspected journal interval since `17:53Z` had zero
exception/authentication-failure markers. Snapshot contents were not exported.
#40 explicitly released the live slot to #48 after these checks. This proves
normal helper acquisition resumed without a helper restart. It is not a manual
visual inspection of the Home Assistant map.

## Acceptance boundary and handover

Software tests cover other regions, expiry/rejection, disabled modules,
cancellation, endpoint rejection, public privacy and module isolation. Those
remain synthetic checks, not additional regional hardware claims. The live
trial did not deliberately expire a real server token or submit bad credentials.

The internal callback contract remains
`EufyHomeAdapter.withConnection(publicId, signal, callback)`. It supplies native
`accountUid`, exact device ID, local key, region, expiry and a revocable signal.
It is not exported by the public package entrypoint. #48 can use this confirmed
role mapping when it adds its scoped RTC operation within the same private
session owner. The present story does not expose a generic cloud request API.

Keep E3 and E4 open. #41 owns local transport, #42 telemetry, #43 through #46
controls/settings and #48 portable session research. Closing #40 does not prove
peer authentication, maps or physical mower control.
