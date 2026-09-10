# E15 selected native transport and remaining contract boundary

Research outcome for [#77](https://github.com/keesmod/eufy-mega-client/issues/77).
Change class: documentation patch. The story takes its explicit remaining-boundary
acceptance alternative. It does not establish portable transport or unlock #78.
The target is the owned E15. Firmware 6.9.28 remains owner-reported.

## Evidence and method

The primary [ThingClips P2P SDK 7.5.1 AAR](https://maven-other.tuya.com/repository/maven-commercial-releases/com/thingclips/smart/thingsmart-p2p-sdk/7.5.1/thingsmart-p2p-sdk-7.5.1.aar) has SHA-256
`6271b08f479d6408758a1373e874bc7ffd4c88ad960dbd5e37bc07cbe02f679a`.
Its ARM64 `libThingP2PSDK.so` has SHA-256
`17763be98e0ce9ee5f89c0cfe2166004d37148c712e39c5d93652cae123ef88a`.
The mapped helper library matched that ARM64 hash before observation.
An earlier ARM32 expectation failed this guard and performed no memory read.

An independently written private observer used the emulator's existing root
shell to read only factory and cipher selectors and object/registry pointers. It did not
attach a debugger, inject code, write memory, restart a process or alter a
service. Raw addresses and private values were not emitted. #40 confirmed idle
for each bounded observation window. All three observation windows have been released.

The hash-guarded selector observation lasted 22.198 seconds, including waiting
for the ordinary helper process to appear. It observed factory selector V3 at
20.734, 21.495 and 22.198 seconds. In the last two samples both V3 and V4 objects
existed and their vtables matched the respective artifact symbols. Object
presence alone therefore cannot establish backend selection.

The artifact's factory dispatcher maps selector 3 to V3 and selector 4 to V4.
The V3 data-send adapter reaches IMM. This establishes V3 selection at the
observed initialization points. The later registry observation below confirms this selection while an IMM
session record exists. A separate 60-second observer missed the brief process cycle
and returned no samples. It provides no evidence of channel cipher selection.

Earlier `imm_p2p` log tags were inspected and found to be SELinux denial audit
records. They are not successful transport events or independent backend proof.

## Remaining boundary

Static analysis identifies an IMM handle registry, cipher dispatch and a path
through `ikcp_send_mbuf`. It does not establish a wire protocol. In particular:

- The native integer handle indexes a session record. Its relationship to the
  authorization string and signaling session string remains unresolved.
- Cipher implementations coexist. Their presence does not establish the
  negotiated mode, key provenance or whether a configured override is used.
- The outer network envelope, integrity coverage and KCP output mapping remain
  unspecified. KCP symbol presence does not prove vanilla KCP compatibility.

The later observation below resolves the mode and override-presence questions.
The remaining identifier transformation, key establishment and outer framing
contract belong to [#80](https://github.com/keesmod/eufy-mega-client/issues/80),
a bounded two-day research obligation. #80 is a native prerequisite of #78 and
a child of E4. No unknown frames may be transmitted.

## Preservation and status

No helper configuration, APK, service or map source was modified. A fresh
read-back confirmed both services active with no drop-ins. The helper remained
active since `2026-09-10T19:04:08Z`, and the emulator since
`2026-09-08T19:45:32Z`. Normal map publication advanced to
`2026-09-10T19:50:25.289709892Z`. This is acquisition evidence, not manual HA
visual validation.

Private observation scripts remain outside this Git worktree. No vendor code,
binaries, raw captures, identifiers, credentials or geometry are included here.
No product code changed and no independent peer sends were run. Documentation
format and diff checks passed. The PR remains subject to all existing CI gates.
The research outcome is the selected V3/IMM mode-3 path and the explicit
unresolved contract, with #80 linked before closure. #78 and #49 remain
unstarted. E4 remains open until portable map functionality is proven.

## Reproduction locators and static limits

These are research locators in the exact ARM64 artifact above, not portable
runtime offsets. Locate the mapped ELF at file offset zero and verify its hash
before reading anything. Add the ELF-relative symbol offset to that mapping's
base. Emit only fixed enums, equality booleans and elapsed seconds. Do not emit
addresses, process maps, keys or payloads.

| Observation      | ELF-relative locator                                  | Allowed result               |
| ---------------- | ----------------------------------------------------- | ---------------------------- |
| Factory selector | `ThingSmartP2PFactory::type_`, `0x270008`, four bytes | V3, V4 or unclassified       |
| V3 object        | `ThingSmartP2PV3::self`, `0x270860`                   | Presence and vtable equality |
| V4 object        | `ThingSmartP2PV4::self`, `0x270890`                   | Presence and vtable equality |
| IMM registry     | `g_ctx`, `0x278cb0`                                   | Nonempty registry boolean    |

The IMM send routine walks the list at context offset `0x43e8`, with each list
node at record offset `0x3350`. The record's first four bytes are compared with
the send call's integer handle. This establishes a local lookup role, not its
creation algorithm or equivalence to either external session string.

The per-record mode at offset `0x327c` indexes a 32-byte dispatch entry, using
the encrypt callback at entry offset 16. The table starts at `0x260550`.
Mode 3's entry reaches the AES-CBC adapter, which first checks a custom callback
at shared configuration offset `0x3e0`. A non-null override would require separate
research before asserting the actual primitive. The mode-3 fallback reaches
`mbedtls_aes_crypt_cbc`. Coexisting mode-2 and mode-4 entries reach ChaCha20 and
GCM routines. Their presence says nothing about runtime negotiation.

The send path pads each input chunk to the next multiple of 16, including a full
block when aligned, with the padding length as its byte value. It prepares a
16-byte IV field, invokes the selected encryption callback and passes the result
to `ikcp_send_mbuf`. The IV-generation routine's name alone does not establish
entropy quality. For mode 3 the submitted length is padded chunk length plus 16.
That describes the internal mbuf-to-KCP boundary only. It does not specify the
outer packet, fragmentation, reliability parameters, authenticated coverage or
receive validation. Do not transmit the old 104-byte native authorization
buffer directly or infer that a single send is a single wire packet.

The callback receives per-channel crypto state. This research has not traced
that state's key inputs, derivation, negotiation or binding to the independently
verified local key. A device local key must not simply be assumed to be the
transport AES key. That is the first remaining contract boundary, before any
portable encryption or send implementation.

## Runtime session-mode receipt

The final read-only observer ran for 360.063 seconds while waiting for a natural
helper cycle. It retained seven successful structural samples. At 245.524 seconds
the V3 factory and object were present without an IMM record. At 246.400,
247.260, 248.134, 249.001, 249.854 and 250.699 seconds it observed V3, one IMM
record with mode 3, and a null custom cipher callback. Both backend objects
existed in those six samples and their vtable equality checks passed.

Together with the exact artifact's dispatch, this supports the selected
V3/IMM AES-CBC fallback path for this normal acquisition. It does not reveal
the key, prove its derivation, establish outer integrity or prove independent
peer authentication. No key bytes, payloads or identity values were read by
the observer. Reads are sequential rather than an atomic memory snapshot.
Matching observations across the six samples reduce that ambiguity but do not
make this a general firmware compatibility claim.

The private observer ran through standard input, so no observer files were
installed on the runtime host. No runtime mutation required restoration or a
new backup. The original helper service and the previously retained #48 backup
were preserved. A fresh byte comparison confirmed that the service unit still
matches a retained #48 backup. After the observer exited, service read-back confirmed unchanged
activation timestamps and no drop-ins. The natural cycle completed with the
19:50:25 UTC publication noted above. No HA configuration was changed, so an
HA configuration check was not applicable.

## Acceptance evidence

| Story requirement                                | Evidence and limit                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime-selected backend                         | Hash-matched factory V3 plus six IMM-record observations                                                                                                 |
| Identifier roles                                 | #48 establishes separate string roles. Native send looks up an integer handle. The missing creation/binding transform is explicitly assigned to #80      |
| Transport and crypto contract, or exact boundary | Mode 3 with no override, internal padded mbuf-to-KCP boundary. Key establishment and outer envelope remain blocked by #80                                |
| Privacy and provenance                           | Primary SDK used only for research. Public receipt contains structural facts, no vendor implementation or private data                                   |
| Bounded observation and preservation             | Three exclusive read-only windows, no installed observer or mutation, terminated observer, unchanged service read-back and completed natural acquisition |

The existing [#48 receipt](E15_SESSION_BINDING_2026-09-10.md) remains the
dated source for signaling-role equalities. Its historical pending tracking
paragraph was subsequently resolved on GitHub before #48 closed. Current
tracking is authoritative: #78 depends on #80, and #49 depends on #78.
