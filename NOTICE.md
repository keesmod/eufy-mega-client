# Attribution

MIT-licensed protocol code and research are reused from bropat/eufy-security-client
4.1.1-1, commit `d75e7996d4cbce3839a6075bed95b752ccc3ee43`.

- `vendor/src/` contains adapted device, station, P2P, image and FCM protocol
  modules from the same commit. Its HTTP module is an injected interface; the
  upstream HTTP client and orchestrator are excluded. Raw logging is disabled.
- `src/detections.ts` adapts the notification correlation logic from
  keesmod/ha-eufy-cam commit `2dd8639dc28ba34f6539c4f3999e07f55e295d40` (MIT), preserving its supported event types.
- `src/crypto.ts` derives from `src/http/megaCrypto.ts`.
- Mega request signing, login encryption, authentication payloads and discovery
  are based on `src/http/megaApi.ts`, `megaInterfaces.ts` and `http/utils.ts`.
- Original copyright: Copyright (c) 2021-2024 bropat.
- Mega protocol implementation and research: lenoxys, with upstream review and
  integration by martijnpoppen. See upstream PR #939 and its follow-up fixes.

Source: https://github.com/bropat/eufy-security-client/tree/d75e7996d4cbce3839a6075bed95b752ccc3ee43

The original MIT notice is preserved in LICENSE. New implementation copyright
2026 keesmod, also under the MIT license. This project is independent of Eufy,
Anker, and the community's separate Mega successor effort.

The adapted transport changes are maintained here: explicit LAN-derived command
credentials; no cloud DSK lookup in local mode; bounded UDP disposal; explicit
STOP recovery; repeated P2P parameter observations; a distinct device download
completion event; native Node AES; verified FCM TLS with bounded login/parsing;
push listener/timer cleanup across reconnect and shutdown; and cancellation of
old media timers before a P2P state reset; closing the actual UDP socket on
device END; renewing the UDP endpoint after confirmed STOP recovery; and
sharing concurrent transport-close operations; and a separate startup deadline
that preserves the shorter timeout for stalled media; and a three-second
audio-discovery window for delayed first AAC packets. Those changes
must not be attributed to the original upstream release.
