# Synthetic family fixtures

[Story #18](https://github.com/keesmod/eufy-mega-client/issues/18) tests the
boundaries recorded in [the model matrix](MODEL_MATRIX.md). The accepted matrix
baseline is `5f2ebaedd330653cafd315143a5bcf9b24e1c98a`, delivered by #15.
The matrix family names assign engineering ownership. They do not assert that
all members share a wire protocol.

## Provenance and limits

The inventory, station events, failures and empty media streams are synthetic.
They were authored for this repository from its MIT-attributed camera source,
the accepted matrix and existing tests. No mower fork, raw capture, device key,
recording or private inventory was used. Firmware strings are synthetic branch
inputs. They are not observations of those models running those versions.
Unknown firmware and transport remain unknown.

These fixtures prove software selection, rejection and cleanup at specified
boundaries. They do not establish hardware support, decrypt a new transport or
enable any new public model. The test suite opens no device sockets. An isolated
vendor command assertion does not bypass the public client's admission policy
in production. Camera-bearing products authorize no lock, garage or parcel actuation.

## Coverage

| Matrix family | Representative model and type | Fixture topology | Evidence boundary                                                 |
| ------------- | ----------------------------- | ---------------- | ----------------------------------------------------------------- |
| cam           | T8160 / 19 and T8142 / 15     | H3               | Public discovery, adapter lifecycle, payload command              |
| solo          | T8134 / 63                    | H3               | Public discovery, adapter lifecycle, doorbell envelope command    |
| battery       | T8213 / 91                    | H3               | Public discovery, adapter lifecycle, payload command              |
| indoor        | T8400 / 30                    | W                | Public rejection, isolated vendor doorbell envelope               |
| wired         | T8200 / 5                     | W                | Public rejection, isolated vendor doorbell envelope               |
| flood         | T8423 / 38                    | W                | Public rejection, isolated vendor doorbell envelope               |
| wall          | T84A1 / 151                   | W candidate      | Public rejection, isolated vendor doorbell envelope               |
| garage        | T8452 / 132                   | W candidate      | Public rejection, isolated vendor doorbell envelope               |
| integrated    | T8790 / 90                    | H3               | Public rejection, isolated vendor payload command                 |
| lte           | T8150 / 110                   | L                | Public rejection before any media session. No wire route asserted |
| nvr           | T8E00 / 301                   | N                | Public rejection before any media session. No wire route asserted |
| unresolved    | Unknown model / 101           | Unknown          | Public rejection. No model or wire route invented                 |

[Family data](../test/fixtures/families.mjs) records numeric type, model,
topology, camera firmware and connection-owner firmware separately. The
[compatibility test](../test/family-compatibility.test.mjs) compares its family
coverage and numeric types to the matrix, so a newly recorded family requires
an explicit test decision. It also keeps the two S220 aliases distinct.

T8142 with synthetic T8010 owner firmware `2.0.9.6` selects the integer live
command. At `2.0.9.7` it selects the payload command. This checks the existing
`Station.startLivestream` branch, not HomeBase 2 support. Wrong-owner and missing
start-capability cases issue no command. Independent public tests reject H2,
HomeBase Mini, MiniBase Chime, NVR, an unknown owner and standalone ownership for
a recognized camera. Sound-only chimes are not inferred to be connection owners.

The four currently admitted H3 models use a real camera factory with a
[synthetic station event fixture](../test/fixtures/media.mjs). The
[lifecycle tests](../test/family-lifecycle.test.mjs) cover wrong-channel and
duplicate events, exactly one stop outcome, cancellation retaining ownership,
missing STOP acknowledgements, the eight-second cleanup deadline and late ACKs.
No bytes of video or audio are claimed to play. Unsupported models instead test
rejection before media ownership begins. LTE/NVR media transfer stays unknown.

Detection fixtures check cross-source duplicates, distinct events and restored
replay suppression. A fixed clock reproduces restoring a saved cache in the
same millisecond. The inclusive five-minute expiry bound preserves that cache.
Expired entries and entries beyond five minutes are still rejected.

## Diagnostics

[Diagnostics tests](../test/family-diagnostics.test.mjs) pass synthetic private
markers through inventory and failed HTTP responses for every family. They
assert the exact cloud diagnostic allowlist, operation/route, HTTP status,
numeric failure and elapsed time. They also check that vendor connection errors
become a library failure code without vendor context. Diagnostics contain no
serials, keys, tokens, private payloads or media. Event notifications themselves
are private application data and are not safe diagnostic exports.

[DIAGNOSTICS.md](DIAGNOSTICS.md) remains the consumer contract. The discovery
route identifies the tested feature. Media faults expose the sanitized library
code. These tests do not promise a new per-feature diagnostics API.

## Validation and remaining obligations

Run `npm test` with Node 24, `npm run format:check` and
`python3 scripts/check_model_matrix.py`. Existing CI also validates dependency
security, release metadata and the compiled package. Fixtures stay outside the
published package. GitHub #18 and its PR hold the dated results.

The existing per-row obligations in the matrix remain open. Family discovery
and media stories #19 through #34 own implementation. #35 and #36 own owner and
standalone transport gaps. #37, #38 and #39 own LTE, NVR and integrated/unresolved
research. E2 retains implementation and E6 retains hardware validation. No new
protocol work is hidden in the fixture story and none of those obligations is
closed by this software evidence. Mower protocols are outside this camera matrix.
