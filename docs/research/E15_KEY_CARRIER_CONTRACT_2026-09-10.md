# E15 authenticated key and selected TCP carrier contract

This completes the contract research in [#82](https://github.com/keesmod/eufy-mega-client/issues/82)
and [#83](https://github.com/keesmod/eufy-mega-client/issues/83). The user selected
both stories together and required the missing work to remain in those stories.
No residual protocol story was created. Change class: research tooling and
documentation patch. Product implementation remains in
[#78](https://github.com/keesmod/eufy-mega-client/issues/78).

## Evidence and scope

The target is the owned E15 with owner-confirmed firmware 6.9.28. This receipt
combines live observations, static data flow and independent execution of the
original ARM64 functions with synthetic inputs. It does not claim portable Linux
acquisition or an application-level authentication response. Those are #78's
existing outcome. It establishes the contracts needed to attempt that work.

The primary source is the [ThingClips P2P SDK 7.5.1 AAR](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-p2p-sdk/7.5.1/thingsmart-p2p-sdk-7.5.1.aar).
Both hashes were reverified:

- AAR SHA-256: `6271b08f479d6408758a1373e874bc7ffd4c88ad960dbd5e37bc07cbe02f679a`.
- ARM64 ELF SHA-256: `17763be98e0ce9ee5f89c0cfe2166004d37148c712e39c5d93652cae123ef88a`.

[#40](E15_AUTH_VALIDATION_2026-09-10.md) supplies the independently verified
account, device and local-key binding. [#80](E15_IMM_CONTRACT_2026-09-10.md)
supplies the internal AES/KCP boundary. No unlicensed mower implementation was
copied or translated. Operational helper inspection only located observation
hooks. No vendor bytes, private identifiers, credentials, packet captures or
geometry are included here or in the reproduction tool.

## Initialization and caller binding

A private, hash-guarded observer inserted event counters at 19 ARM64 locations.
Each trampoline executes the original displaced instruction. Offline Unicorn
comparison verified all general registers, stack pointer and condition flags
against the unmodified instruction at every location. Counters use exclusive
increments. Only the first 16 occurrences of each event enter the ordered event
list. Neither keys nor payloads enter that list.
The final instrumented ELF had SHA-256
`b24b19222552dbe2176b3068d45a86fdcdc00506fcee5f4b13fa1862e49043af`.
Instrumentation appended its code in the verified unused file gap and placed
counters in an extended BSS area at ELF-relative `0x2d1000`. Raw handle and
pointer comparisons stayed in the private process. The unmodified counter
observation independently corroborates the selected carrier.

The instrumented live process recorded this order:

1. Native connect entry.
2. One fresh key producer, followed by local hex decoding and local SDP key setup.
3. 331 built-in AES encryption/decryption initializations for the channel objects.
4. SDP encoding, successful connect return, authorization and transport traffic.

There were zero retained-key, remote-key replacement or custom-initializer
attempt events. The 331 initializations are channel initializations, not 331
sessions. A previous sample of null callbacks alone could not establish this
history. The event observation does establish the executed route for this session.

Independent in-memory comparisons established all of the following:

- The helper authorization identifier equals the native connect string argument.
- The nonnegative integer returned by native connect equals the authorization
  handle and the handle at the 104-byte native send.
- That authorization send uses channel 0. Live KCP output for channel 0 has
  conversation value 0.
- The SDP's 32 hexadecimal `a=aes-key:` characters decode to exactly the
  16-byte native field used by AES and the KCP HMAC.

The authorization string, native handle, signaling `sessionid` and carrier
`tcp_token.sessionId` are distinct roles. In particular, the observed carrier
session ID differs from the signaling session ID.

The fresh key comes from the artifact's random-string producer. This observation
does not certify its entropy. A portable implementation should generate a fresh
16-byte key with its platform CSPRNG and serialize that key as hexadecimal.
It must not reuse retained state without a separately valid session contract.

## Authenticated SDP exchange

A separate low-level AES-GCM implementation verified actual outgoing and incoming
MQTT envelopes using the device local key. The helper's high-level AES-GCM path
was not used as the verifier. The configured local key also equalled the current
cloud-returned device local key during the observation.

The verified envelope is a 12-byte authenticated header, a 12-byte nonce, then
ciphertext and a 16-byte tag. The header starts with ASCII `2.3`. The clear JSON
has `protocol: 302` and its `data` contains the signaling object. The header is
AAD. The SDP key was compared with the native key while the outgoing offer was
being relayed, so this is a direct binding between the authenticated envelope
and the established native encryption input.

The outgoing offer has `from = native account UID`, `to = device ID` and
`moto_id = RTC p2pId`. The authenticated answer reverses `from` and `to` while
preserving the current offer's `sessionid` and `moto_id`. All comparisons passed.
Local negative checks rejected a different key, a changed tag or authenticated
header, and a mismatch in each of the four reply-routing fields.

Portable acceptance must require a valid GCM tag and the current expected tuple
before using an answer or token. Reject old sessions and duplicate terminal
answers. These negative checks were local calculations, not malformed messages
sent to the mower. The receipt does not claim that every native SDK input path
implements these stricter admission rules.

The same observed session subsequently accepted 50 receive buffers after native
KCP HMAC verification. This joins the authenticated key-bearing offer, correlated
answer and traffic using that key. A relay socket connection alone is not this
proof and is not application authentication.

## Selected carrier and keys

In the unmodified runtime, TCP's sent-byte counter advanced from 2,484 to 2,872.
Its selection weight was 100. ICE and UDP weights and sent-byte counters were
zero. ICE and TCP objects both existed, so object presence would have been
misleading. Instrumentation independently observed TCP send calls and no ICE or
UDP sends in the acquisition.

The selected socket's credential equalled `tcp_token.credential` in both the
GCM-verified offer and answer. Its first 16 raw bytes equalled the native carrier
AES key. The socket's username equalled `tcp_token.username`, and its carrier
session ID equalled `tcp_token.sessionId` in both messages. The observed client
type is 1, with native account UID and device ID in their separate fields.

Keep these keys separate:

| Purpose                                     | Key input                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Signaling AES-GCM                           | Independently verified device local key                                         |
| Application AES-CBC and KCP HMAC-SHA1       | Fresh 16-byte SDP key                                                           |
| TCP handshake AES-CBC and outer HMAC-SHA256 | First 16 raw bytes of carrier credential                                        |
| TCP challenge signatures                    | Carrier credential copied into a zero-filled 64-byte field, bounded to 64 bytes |

The selected TCP configuration includes `domain`, `sessionId`, `username`,
`credential` and relay URLs. The native parser recognizes `tcp4:` and `tcp6:`
URLs. Use the current authenticated token and its selected endpoint, not a
retained address or a fabricated credential. `sessionId` here is case-sensitive
and is not the signaling field `sessionid`.

## TCP establishment

Let `S` be `tcp_token.sessionId`, `U` be `tcp_token.username`, `A` be the native
account UID, `D` be the device ID, `C` be a fresh client random string and `K64`
be the 64-byte challenge-signature key described above. This is the observed
client-type-1 route.

A root record has a big-endian 16-bit type and big-endian 16-bit body length.
The total record size is four plus that length. Handshake records use type
`0xf400`. Each attribute is a big-endian 16-bit type and length, followed by
that many value bytes and padding to the next four-byte boundary.

Handshake attributes are:

| Attribute | Value                                                               |
| --------- | ------------------------------------------------------------------- |
| 1         | Two-byte big-endian phase: 0 request, 1 response, 2 ack, 3 complete |
| 2         | 16-byte CBC IV                                                      |
| 3         | Raw carrier session ID `S`                                          |
| 4         | Raw token username `U`                                              |
| 7         | AES-128-CBC encrypted JSON with PKCS#7 padding                      |
| 8         | 32-byte HMAC-SHA256                                                 |

The outer HMAC uses the 16-byte carrier key. It covers the root header with its
final body length, all preceding attributes and padding, and attribute 8's
four-byte header. It excludes the digest value. Verify it before decryption.
The independent oracle reproduced the original encoder byte for byte.

The request JSON is `clientType: 1`, `method: "request"`, `devId: D`, `uId: A`
and `authorization: "random=" + C`. The response supplies an authorization
string of the form `signature=<hex>,random=<R>`. Its signature must equal
lowercase hexadecimal HMAC-SHA256 with `K64` over UTF-8 `U:S:A:C`, with literal
colon separators. Preserve `R` as this session's server challenge.

The ack has the same account/device fields, `method: "ack"`, `statuscode: 200`
and `authorization: "signature=" + H`. Here `H` is lowercase hexadecimal
HMAC-SHA256 with `K64` over UTF-8 `U:S:A:<response-signature>:R`.
The final phase-3 message must have `method: "complete"` and `statuscode: 200`.
This establishes the TCP carrier. It does not replace the separate 104-byte
application authorization request or establish its successful response.

The original verifier accepted a synthetic valid response and complete message.
It rejected a wrong challenge signature, changed outer HMAC, different peer,
old client nonce and duplicate response. The published reproduction script
executes those native checks. No negative trial was transmitted to hardware.

## Data envelope and receive inverse

After establishment, each KCP callback buffer is followed by a 20-byte
HMAC-SHA1 using the fresh SDP key. TCP carries that complete inner buffer in
attribute 7 of root type `0xf600`. The outer data record has no extra digest.
For inner length `N`, its body length is `4 + N + ((-N) mod 4)` and its total
size is `8 + N + ((-N) mod 4)`. The original encoder zero-initializes its output,
so the observed alignment padding is zero. Attribute 7's length excludes padding.

The stream receive path accumulates bytes until it has the four-byte header
and the complete body. It processes one record, removes it and repeats for
coalesced records. Partial headers and bodies remain pending. The inspected
native accumulator is bounded to 4,096 bytes. A portable receiver must enforce
its bound before allocation and reject an overlarge or malformed record.
Root `0xf500` is carrier heartbeat traffic, not application data or success.

For `0xf600`, validate root length, attribute boundaries and a single data
attribute. Remove the TLV wrapper and alignment padding. Derive the channel
from the inner KCP conversation and verify the final 20-byte HMAC before passing
the KCP bytes to reassembly. The selected route has the session upper-bit option
disabled. Ordinary conversation values are the channel index. Reserved
`0x010000f3` maps to the final internal channel. If the upper-bit option is enabled
in another profile, validate its session field rather than silently masking it.

For reassembled mode-3 data, the first 16 bytes are the IV. Decrypt the remaining
block-aligned bytes with the SDP key and require strict PKCS#7 padding. The sender
chunks plaintext at 1,300 bytes before encryption. CBC, KCP, relay handshake and
application acknowledgement are different stages and must have separate success
criteria. Keep the existing bounded cancellation and no uncertain replay policy.

Eleven synthetic inner lengths from 24 through 1,400 bytes matched the native
TCP encoder and inverse. Independent tests cover every split point of a pair of
coalesced records, bytewise delivery and invalid headers. The hash-pinned native
HMAC implementations also matched standard SHA-1 and SHA-256 results directly.

## Reproduction and research locators

Run the [offline oracle](../../scripts/research/e15_contract_oracle.py) with a
separately obtained primary AAR. The script verifies both hashes and performs
no network I/O. It includes no vendor executable or copied vendor function.
Allocator, libc and JSON calls have explicit host adapters. Protocol parsing,
framing, AES, HMAC and handshake verification execute from the supplied artifact.

```sh
python -m venv /tmp/e15-contract-oracle
/tmp/e15-contract-oracle/bin/pip install pyelftools==0.33 unicorn==2.1.4 cryptography==50.0.1
/tmp/e15-contract-oracle/bin/python scripts/research/e15_contract_oracle.py /path/to/thingsmart-p2p-sdk-7.5.1.aar
```

For live reproduction, retain exclusive ownership, exact APK and unit backups,
a bounded automatic rollback and only normal map acquisition. The private
observer exported booleans and event counts, never raw values. Relevant ELF
locations in the pinned artifact are:

| Boundary                                            | Locator                                       |
| --------------------------------------------------- | --------------------------------------------- |
| Fresh / retained input                              | `0xae868` / `0xae7cc`                         |
| Local decode / SDP-ready / remote replacement       | `0xa5274` / `0xa52b4` / `0xa78e0`             |
| Crypto init / custom attempt / built-in enc and dec | `0xa1f50` / `0xa1f7c` / `0xa2024`, `0xa2070`  |
| Connect entry / return / authorization / send       | `0x9e090` / `0x9e314` / `0x840ec` / `0x9ff20` |
| KCP output / accepted receive HMAC                  | `0xa66d8` / `0xab7f0`                         |
| TCP carrier key setup / token-to-socket copy        | `0xbdd80` / `0xbcd68`                         |
| Handshake request / encode / verify / ack           | `0x99d10` / `0x9a08c` / `0x9a884` / `0x9a314` |
| TCP data encode / decode                            | `0x9acdc` / `0x9adac`                         |
| Stream append / complete-record processing          | `0xbda04` / `0xbeaf4`                         |

The registry and key-field locators remain those in #80. The selected TCP socket
is reached from record `+0x3320`, session `+0x9c8`, then node `+0x60`. Its
credential is at `+0x338`, AES input at `+0xf0`, carrier session ID at `+0x2b4`
and token username at `+0x2f8`. These are artifact-specific research locators,
never portable runtime dependencies.

## Recovery and acceptance

One initial attempt stopped before instrumented installation because Android was
briefly offline after helper shutdown. The original helper recovered and normal
publication followed. The corrected procedure waited for Android with a bounded
timeout. All subsequent observation windows completed and restored the original
APK through an EXIT handler with a 180-second independent rollback timer.

Final read-back verified the installed APK byte for byte against its backup,
the original ELF hash and an unchanged helper unit. Both services are active,
no runtime overrides remain, all temporary observers were removed and the live
slot was explicitly released. The emulator was never restarted. Normal map
publication after final restoration occurred at **2026-09-10 20:46:10.630145486 UTC**.
No HA configuration changed. No motion, setting, map edit, product release or
portable peer transmission occurred. This is acquisition recovery evidence,
not a manual visual check of HA geometry.

| Acceptance                                        | Result                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| #82 connect, authorization and handle association | Live equality checks passed                                                    |
| #82 full initialization chronology                | Fresh/local/built-in sequence observed, alternative branches absent            |
| #82 authenticated key-bearing exchange            | Independent GCM verification, native key equality and correlated answer passed |
| #83 selected carrier                              | Unmodified counters and instrumented calls both selected TCP                   |
| #83 envelope, establishment and inverse           | Primary data flow, native synthetic oracle and negative verifier cases passed  |
| #83 application channel correlation               | Live authorization channel 0 and KCP conversation 0 matched                    |
| Recovery and provenance                           | Exact restoration, normal acquisition, no private or vendor content published  |

There is no remaining #82/#83 contract obligation to transfer. After the required
PR and merged-main checks, these two prerequisites can close and #78 can perform
its existing independent Linux application-authentication trial. E4 and the map
feature remain open until portable acquisition is delivered.
