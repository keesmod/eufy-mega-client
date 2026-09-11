# Sanitized diagnostics

Pass a `diagnostics(event)` callback to receive allowlisted cloud operation,
host, route, HTTP status, numeric result and elapsed time. The callback receives
no headers, request/response bodies, tokens, names, serials or addresses.
Callback failures do not alter authentication or protocol behavior.

Listen for `fault` and record the library error `code`. Record model/firmware,
library and Node versions, operation, duration, whether cleanup was confirmed,
and whether the problem occurred after a reconnect. Include synthetic fixtures
and a minimal reproducer when possible.

The [synthetic family diagnostic checks](FAMILY_FIXTURES.md#diagnostics) verify
the allowlist with successful discovery, failed HTTP responses and vendor
connection errors. They do not expose a new diagnostics API.

Never upload a session file, credentials, raw push payload, recording, image,
device inventory response or unrestricted debug log. Recognized names and media
are private. Raw vendored protocol logging is deliberately disabled.

For independence tests, block identified legacy product hosts in the candidate's
environment. The tested hosts are `security-app-eu.eufylife.com`,
`security-app.eufylife.com`, `security-app-us.eufylife.com` and
`extend.eufylife.com`. The cloud transport separately restricts requests to Mega
service hosts. Google FCM and local HomeBase UDP are required transports, not
legacy Eufy cloud API fallback. Report newly observed destinations before
changing an allowlist or claiming independence.

## Missing devices

`discoverDevices().issues` preserves its existing `index`, `deviceId` and `code`.
Never log the whole issue: `deviceId` is private. For `unsupported_device`,
optional `deviceModel` and `deviceType` fields describe the received pair.
Only a model matching `T[A-Z0-9]{4}` and an integer type from 0 through 65535
are included. These are conservative diagnostic bounds, not protocol limits or
recognition rules. Values are never trimmed, truncated, coerced or derived from
serial numbers. Missing or invalid values are omitted.

Consumers can log the fixed error code and these two fields, revalidate them
at the logging boundary, and deduplicate by code plus model plus type. Distinct
unknown pairs must remain visible. Keep the existing code when either field is
absent. Other rejection codes have no new fields. Usable devices in a mixed
inventory remain available. This does not add device support or diagnose the
reported C30 without its actual received pair.

## Rejected-device context, 0.12.2

Security discovery issues may include `context` with numeric dotted firmware and
hardware versions, each bounded to 19 characters. Missing or malformed values
are omitted. `parentStatus` describes the received relation as `none`, `self`,
`present`, `missing`, `ambiguous` or `invalid`. A unique matching security row
may supply `parentModel`, `parentFirmware` and the private `parentId` for anonymous
consumer correlation. A present row does not imply a supported or connected
HomeBase. No field is guessed from a serial. Consumers must construct an allowlist
and omit both `deviceId` and `context.parentId` from logs or shared downloads.
No extra requests, model admission changes or device commands are involved.
