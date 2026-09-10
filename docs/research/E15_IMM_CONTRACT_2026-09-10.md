# E15 IMM key input and authenticated KCP boundary

Research for [#80](https://github.com/keesmod/eufy-mega-client/issues/80).
Change class: documentation patch. The target is the owned E15, with firmware
6.9.28 still owner-reported. This receipt specifies additional internal
boundaries in the selected V3/IMM path. It is not a portable peer implementation.

## Primary evidence

The independently inspected [ThingClips P2P SDK 7.5.1 AAR](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-p2p-sdk/7.5.1/thingsmart-p2p-sdk-7.5.1.aar)
again matched SHA-256
`6271b08f479d6408758a1373e874bc7ffd4c88ad960dbd5e37bc07cbe02f679a`.
Its ARM64 library again matched
`17763be98e0ce9ee5f89c0cfe2166004d37148c712e39c5d93652cae123ef88a`.
The preceding [#77 observation](E15_NATIVE_TRANSPORT_2026-09-10.md) establishes
V3 selection, mode 3 and absence of an encryption override during one normal
acquisition. [#40](E15_AUTH_VALIDATION_2026-09-10.md) establishes the separate
private account/device/local-key binding. Neither receipt equates the local
key with the IMM transport key.

Independent private analysis follows ARM64 argument and memory data flow,
relocations, call targets and branch conditions. The locators below allow a
researcher with the same primary artifact to repeat the inspection. No vendor
implementation, disassembly, executable, raw capture or private value is included
in this repository. No unlicensed mower-fork code was used.

## Handle and authorization roles

In the inspected record-creation route, `0xae978` through `0xae9a8` updates a
context-owned counter and writes the record handle, including a role-derived
upper-bit field. This is a local registry allocation. That route does not hash,
parse or numerically convert an authorization string into the handle.
The V3 authorization adapter at `0x840ec` already receives the integer handle
separately from its string inputs. It forwards the handle to virtual send while
copying the strings into the previously documented 104-byte application buffer.
The buffer is subsequently processed by the transport.

This resolves the proposed direct string-to-integer transformation for these
inspected boundaries. It does not prove the complete Java/JNI caller binding
between the helper's authorization identifier, the connect return value and the
later authorization call. That association still requires a correlated call
observation. The [#48 signaling equalities](E15_SESSION_BINDING_2026-09-10.md)
remain valid dated observations. The signaling session string is a separate role.

## Key input and branch distinction

The mode-3 initializer at `0xa1f50` takes a channel object whose first pointer
refers to its session record. It uses the 16-byte field at record offset
`0x84b8` as the input to both AES encryption and decryption key setup, with
128-bit length. The fallback calls occur at `0xa202c` and `0xa2078`.
No additional derivation occurs between that field and those calls.

Custom initialization, destruction, encryption and decryption callbacks occupy
shared-configuration offsets `0x3d0`, `0x3d8`, `0x3e0` and `0x3e8`.
The initializer attempts the custom initialization route if configured. If it
does not obtain both contexts, it clears the callback group and initializes the
built-in AES contexts. Observing only the final null encryption callback does
not retrospectively prove that a custom initializer was never attempted.

Two concrete producers of the key-input field are visible:

- For constructor input offset `0x2c` equal to zero, `0xa5274` through `0xa52c0`
  decodes 32 hexadecimal characters from input offset `0x3b0` into 16 bytes at
  record offset `0x84b8`, then puts their hexadecimal representation into the
  local SDP object. The constructor copies its input to record offset `0xe30`.
- With record offset `0xe5c` equal to one, `0xa78e0` through `0xa78f0` reads
  16 decoded bytes from the remote SDP object at record offset `0x38` into the
  same key field. The named getter at `0xb0ba8` implements the hex decoding,
  so this conclusion is supported by data flow, not by its name alone.

The constructor-input producer itself has both fresh and retained-state routes.
The fresh route at `0xae868` through `0xae8b0` obtains 16 characters using the
artifact's random-string routine and hex-encodes them into input offset `0x3b0`.
The retained-state route at `0xae7b4` through `0xae7ec` copies a string from a
separate object instead. Therefore even a proven local-SDP role is insufficient
to claim fresh key generation. Entropy quality, retained-state validity and
peer acceptance require their own evidence. No secret bytes were read to make
these static observations.

## Encryption and integrity boundaries

The existing send path prepends a 16-byte IV to encrypted, block-padded data
before KCP ingestion. Padding always adds one through 16 bytes and uses the
padding length as the byte value. The IV copy and encryption call are visible
at `0xa034c` through `0xa03a0`. The IV source is the artifact's random-byte
routine. Its use does not establish a cryptographic entropy guarantee.
The receive adapter at `0x9b5bc` checks the encrypted length after subtracting
16, passes the prefix as IV to the decrypt callback and uses the final plaintext
byte to adjust the returned size. This is not evidence of a complete strict
padding-validation contract.

The KCP output callback is assigned at `0xa6240` through `0xa6248` to
`0xa66a8`. In mode 3 it initializes HMAC with the same 16-byte session field,
updates over the complete callback input and appends the digest at input length.
The digest selection at `0xa7910` is type 5 in this artifact. Its descriptor
at `0x214408` specifies 20 bytes. The dispatch at `0x1849c8` and `0x184a5c`
reaches SHA-1 initialization. Thus this internal boundary is a KCP callback
buffer followed by a 20-byte HMAC-SHA1, using the same input key as AES-128-CBC.
It is not an unauthenticated CBC-only boundary.

The receive path checks the minimum length, derives the KCP channel from the
conversation field, checks the channel bounds, computes HMAC over the received
buffer excluding the trailing digest and compares the digest. Failure exits
before KCP ingestion. On success it subtracts the digest length and calls
`ikcp_input` at `0xab868`. The relevant HMAC checks are `0xab730` through
`0xab7cc`. This describes coverage at that callback boundary, not an assertion
that every outer transport header is authenticated.

## Channel and outer-carrier limits

Channel construction at `0xa6114` creates per-channel KCP objects. The ordinary
conversation value uses the channel index, optionally combined with the
session's upper-bit field depending on record offset `0xe50`. A reserved
conversation maps to the final internal channel. Receive processing applies the
corresponding upper-bit check and channel selection at `0xab6a0` through
`0xab6e8`. The channel index passed by a particular application send still needs
to be correlated with that live call.

After appending HMAC, the output routine may pass the buffer through ICE, UDP
session or TCP session send functions. Their presence does not prove which
carrier this acquisition selected. Those routines have their own session state
and socket wrappers. The KCP-plus-HMAC buffer must not be treated as a complete
UDP datagram or TCP record without tracing and observing the selected wrapper
and its receive inverse. No transmit buffer is proposed by this receipt.

## Bounded live observation

A private observer reused the emulator's existing root shell. It ran through
standard input, with a 360-second observation bound and bounded individual
reads. The other authentication owner explicitly confirmed idle. The #77 owner
was idle and had released its prior window. No competing live owner was found.
The observer verified the mapped ARM64 library hash before reading selectors,
registry pointers and the following allowlisted values. It did not read key
bytes, identifiers, SDP, packet data or geometry.

The observer terminated normally after 148.717 seconds. Two initial samples had
no IMM record. Four successive samples at 145.243, 146.408, 147.549 and 148.717
seconds found one record, factory V3, matching V3 and V4 object vtables, mode 3
and null callbacks at all four shared-configuration offsets listed above.
Record offsets `0xe50`, `0xe54`, `0xe58` and `0xe5c` were all zero in every
record sample.

In the traced constructor layout, zero at `0xe5c` selects the local-input path
rather than the remote-SDP replacement. Zero at `0xe58` agrees with the fresh
producer branch, rather than the retained-state branch shown above. These are
consistent runtime selectors supporting the static local key-input route. They
are sequential observations after record creation, not an atomic trace of the
producer, initial callback attempts or negotiation changes. Key origin and peer
binding must therefore retain this evidence limit.

To reproduce, verify both artifact hashes, locate the mapped ELF at file offset
zero, follow `g_ctx` at ELF-relative `0x278cb0`, traverse the registry list at
context offset `0x43e8` with record list-node offset `0x3350`, and read only the
allowlisted enums and callback-presence booleans. The factory selector remains
at ELF-relative `0x270008`. Limit traversal and elapsed time, suppress addresses
and unexpected values, and discard failed reads. These are research locators
for this exact artifact, not portable-runtime offsets.

No process memory, configuration, APK or service was modified. No debugger was
attached and no helper or emulator was restarted. No observer file was installed
on the runtime host. A byte comparison confirmed the helper service still
matched the retained #48 backup. Both services remained active without drop-ins,
with helper activation `2026-09-10T19:04:08Z` and emulator activation
`2026-09-08T19:45:32Z`. Subsequent normal map publication was verified at
`2026-09-10T20:05:49.637597249Z`. The live slot was explicitly released.
No HA configuration changed, so an HA configuration check was not applicable.
This is normal acquisition evidence, not manual visual validation in HA.

## Remaining obligations and acceptance

The first missing establishment proof is the initialization chronology and
binding of the SDP key exchange to the authenticated peer. A stable key field,
mode-3 record and normal map publication do not independently prove that
contract. [#82](https://github.com/keesmod/eufy-mega-client/issues/82) owns that
one-day research question, including the remaining correlated authorization-call
binding. It must distinguish fresh, retained and remote key-input routes and
specify the authenticated exchange before any portable send.

[#83](https://github.com/keesmod/eufy-mega-client/issues/83) separately owns the
one-day carrier-envelope question. It must identify the actually used carrier,
trace the selected wrapper and receive inverse, and correlate the application
channel. The now-specified KCP/HMAC boundary is its starting point, so it does
not repeat the cipher investigation.

Both obligations are native prerequisites of #78 and children of E4. They were
created before research closure. Neither is started by #80. #78 and #49 remain
unstarted, and E4 remains open until portable Linux maps work.

| Requirement                             | Outcome and limit                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authorization and handle reconciliation | Local handle allocation and separate send arguments traced. Complete live caller association is retained in #82.                                                   |
| Cipher and key-input provenance         | AES-128-CBC setup, input field, local/remote producers and four live selector samples. Initialization chronology and authenticated exchange remain #82.            |
| KCP, integrity and receive boundary     | Assigned callback, HMAC-SHA1 coverage, channel construction and pre-KCP receive verification traced. Outer carrier and application-channel correlation remain #83. |
| Reproducible contract or exact unknown  | This receipt takes the story's explicit remaining-boundary alternative. #82 and #83 preserve every unresolved obligation and block #78.                            |
| Preservation and privacy                | Bounded read-only observation, unchanged services and backup equality, normal subsequent acquisition and released ownership. Private research remains outside Git. |

Only documentation changed. No portable peer frames were transmitted. No
product release, deployment, motion, settings change, map editing or album
transfer occurred. Documentation formatting and diff checks accompany the PR,
and all existing repository CI remains required. Research acceptance does not
claim complete key negotiation, independent peer authentication or portable maps.
