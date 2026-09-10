# Sanitized diagnostics

Pass a `diagnostics(event)` callback to receive allowlisted cloud operation,
host, route, HTTP status, numeric result and elapsed time. The callback receives
no headers, request/response bodies, tokens, names, serials or addresses.
Callback failures do not alter authentication or protocol behavior.

Listen for `fault` and record the library error `code`. Record model/firmware,
library and Node versions, operation, duration, whether cleanup was confirmed,
and whether the problem occurred after a reconnect. Include synthetic fixtures
and a minimal reproducer when possible.

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
