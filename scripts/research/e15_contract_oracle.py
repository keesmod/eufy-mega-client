"""Reproduce E15 carrier facts from a separately supplied, hash-pinned artifact.

No network access or vendor bytes are included. ELF protocol and crypto functions
execute in Unicorn. Allocator, libc and JSON calls use explicit host adapters.
This is an offline research oracle, never a portable runtime dependency.
"""

import io, zipfile, hashlib, struct, json
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE
import unicorn.arm64_const as C
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("artifact", type=Path)
args = parser.parse_args()
aar = args.artifact.read_bytes()
assert (
    hashlib.sha256(aar).hexdigest()
    == "6271b08f479d6408758a1373e874bc7ffd4c88ad960dbd5e37bc07cbe02f679a"
)
raw = zipfile.ZipFile(io.BytesIO(aar)).read("jni/arm64-v8a/libThingP2PSDK.so")
assert (
    hashlib.sha256(raw).hexdigest()
    == "17763be98e0ce9ee5f89c0cfe2166004d37148c712e39c5d93652cae123ef88a"
)
e = ELFFile(io.BytesIO(raw))
syms = e.get_section_by_name(".dynsym")
named = {s.name: s["st_value"] for s in syms.iter_symbols() if s["st_value"]}
plt = e.get_section_by_name(".plt")
rel = e.get_section_by_name(".rela.plt")
imports = {
    plt["sh_addr"] + 32 + i * 16: syms.get_symbol(r["r_info_sym"]).name
    for i, r in enumerate(rel.iter_relocations())
}
u = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
u.mem_map(0, 0x400000)
u.mem_map(0x800000, 0x800000)
for seg in e.iter_segments():
    if seg["p_type"] == "PT_LOAD":
        u.mem_write(seg["p_vaddr"], seg.data())
for r in e.get_section_by_name(".rela.dyn").iter_relocations():
    if r["r_info_type"] == 1027:
        u.mem_write(r["r_offset"], struct.pack("<Q", r["r_addend"]))
    elif r["r_info_type"] in (257, 1025):
        name = syms.get_symbol(r["r_info_sym"]).name
        value = named.get(name)
        if not value:
            value = 0x3F0000 + len(imports) * 4
            imports[value] = name
        u.mem_write(r["r_offset"], struct.pack("<Q", value + r["r_addend"]))
heap = 0xA00000
X = [getattr(C, "UC_ARM64_REG_X" + str(i)) for i in range(31)]


def alloc(n):
    global heap
    p = heap
    heap += (n + 15) & ~15
    u.mem_write(p, b"\0" * n)
    return p


def hook(uc, addr, size, _):
    name = imports.get(addr)
    if not name:
        return
    args = [uc.reg_read(r) for r in X[:6]]
    result = 0
    if name in ["malloc", "imm_p2p_pool_zmalloc", "imm_p2p_pool_malloc"]:
        result = alloc(args[0])
    elif name == "calloc":
        result = alloc(args[0] * args[1])
    elif name in ["free", "imm_p2p_pool_free", "imm_p2p_log_log", "getauxval"]:
        pass
    elif name in ["memcpy", "memmove", "__memcpy_chk"]:
        uc.mem_write(args[0], bytes(uc.mem_read(args[1], args[2])))
        result = args[0]
    elif name == "strlen":
        while uc.mem_read(args[0] + result, 1) != b"\0":
            result += 1
    elif name == "imm_p2p_misc_rand_hex":
        uc.mem_write(args[0], bytes((0xA0 + i) % 256 for i in range(args[1])))
    elif name == "memcmp":
        a = bytes(uc.mem_read(args[0], args[2]))
        b = bytes(uc.mem_read(args[1], args[2]))
        result = 0 if a == b else 1
    elif name == "memset":
        uc.mem_write(args[0], bytes([args[1] & 255]) * args[2])
        result = args[0]
    elif name in named:
        uc.reg_write(C.UC_ARM64_REG_PC, named[name])
        return
    else:
        raise RuntimeError("unsupported import " + name)
    uc.reg_write(X[0], result)
    uc.reg_write(C.UC_ARM64_REG_PC, uc.reg_read(C.UC_ARM64_REG_LR))


hook_handle = u.hook_add(UC_HOOK_CODE, hook)


def invoke(addr, args):
    for i, v in enumerate(args):
        u.reg_write(X[i], v)
    u.reg_write(C.UC_ARM64_REG_SP, 0xEFF000)
    u.reg_write(C.UC_ARM64_REG_LR, 0x700000)
    u.emu_start(addr, 0x700000, count=100000)
    assert u.reg_read(C.UC_ARM64_REG_PC) == 0x700000
    return u.reg_read(X[0])


cases = []
for n in [24, 25, 26, 27, 28, 44, 104, 127, 128, 129, 1400]:
    ctx = alloc(0x200)
    src = alloc(n)
    out = alloc(4096)
    length = alloc(4)
    payload = bytes((i * 17 + 3) % 256 for i in range(n))
    u.mem_write(src, payload)
    result = invoke(
        named["relay_session_encode_tcp_in_kcp"], [ctx, src, n, out, length]
    )
    size = int.from_bytes(u.mem_read(length, 4), "little")
    actual = bytes(u.mem_read(out, size))
    expected = (
        struct.pack(">HHHH", 0xF600, 4 + n + (-n % 4), 7, n)
        + payload
        + b"\0" * (-n % 4)
    )
    assert result == 0 and actual == expected, (n, result, size)
    length2 = alloc(4)
    ptr = invoke(named["relay_session_decode_tcp_in_kcp"], [ctx, out, size, length2])
    n2 = int.from_bytes(u.mem_read(length2, 4), "little")
    assert n2 == n and bytes(u.mem_read(ptr, n2)) == payload
    cases.append(
        {
            "input_length": n,
            "record_length": size,
            "native_encoder_matches_independent_formula": True,
            "native_inverse_matches": True,
        }
    )
print(
    json.dumps({"artifact_hash_verified": True, "synthetic_only": True, "cases": cases})
)

import hmac
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

key = bytes(range(16))
kp = alloc(16)
u.mem_write(kp, key)
mdctx = alloc(64)
desc = invoke(named["mbedtls_md_info_from_type"], [9])
assert invoke(named["mbedtls_md_setup"], [mdctx, desc, 1]) == 0
enc = alloc(0x120)
dec = alloc(0x120)
assert invoke(named["mbedtls_aes_setkey_enc"], [enc, kp, 128]) == 0
assert invoke(named["mbedtls_aes_setkey_dec"], [dec, kp, 128]) == 0
ctx = alloc(0x200)


def p64(a, v):
    u.mem_write(a, struct.pack("<Q", v))


left = b"synthetic-client"
right = b"synthetic-peer"
lp = alloc(128)
rp = alloc(128)
u.mem_write(lp, left)
u.mem_write(rp, right)
for o, v in [
    (0, lp),
    (8, rp),
    (0x48, mdctx),
    (0x50, desc),
    (0x58, kp),
    (0x60, 16),
    (0x78, enc),
    (0x80, dec),
]:
    p64(ctx + o, v)
plain = b'{"synthetic":"handshake","value":1}'
pp = alloc(len(plain))
u.mem_write(pp, plain)
item = alloc(0x310)
p64(item + 0x118, pp)
u.mem_write(item + 0x120, struct.pack("<H", len(plain)))
out = alloc(4096)
ln = alloc(4)
assert invoke(0x9A08C, [ctx, item, out, ln]) == 0
n = int.from_bytes(u.mem_read(ln, 4), "little")
actual = bytes(u.mem_read(out, n))


def tlv(t, v):
    return struct.pack(">HH", t, len(v)) + v + b"\0" * (-len(v) % 4)


iv = bytes(range(0xA0, 0xB0))
pad = 16 - len(plain) % 16
op = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
cipher = op.update(plain + bytes([pad]) * pad) + op.finalize()
body = tlv(1, b"\0\0") + tlv(2, iv) + tlv(3, left) + tlv(4, right) + tlv(7, cipher)
pre = struct.pack(">HH", 0xF400, len(body) + 36) + body + struct.pack(">HH", 8, 32)
expected = pre + hmac.digest(key, pre, "sha256")
assert expected == actual, (len(expected), n)
print(
    json.dumps(
        {
            "synthetic_only": True,
            "native_handshake_record_matches_independent_aes_cbc_hmac_sha256": True,
            "record_length": n,
            "tlv_types": [1, 2, 3, 4, 7, 8],
            "hmac_covers_root_length_and_digest_tlv_header": True,
        }
    )
)

# Standard JSON and C formatting are host-side adapters. Protocol routines remain native.
objects = {}


def cstr(p):
    b = bytearray()
    while len(b) < 4096:
        v = bytes(u.mem_read(p + len(b), 1))
        if v == b"\0":
            return b.decode()
        b += v
    raise ValueError("string bound")


def node(v):
    p = alloc(64)
    objects[p] = v
    if isinstance(v, str):
        q = alloc(len(v.encode()) + 1)
        u.mem_write(q, v.encode())
        p64(p + 0x20, q)
    if isinstance(v, (float, int)):
        u.mem_write(p + 0x28, struct.pack("<i", int(v)))
        u.mem_write(p + 0x30, struct.pack("<d", float(v)))
    return p


basehook = hook


def jsonhook(uc, addr, size, _):
    name = imports.get(addr)
    if not name:
        return
    a = [uc.reg_read(r) for r in X[:6]]
    handled = True
    v = 0
    if name == "cJSON_CreateObject":
        v = node({})
    elif name == "cJSON_CreateNumber":
        v = node(
            int(
                struct.unpack("<d", struct.pack("<Q", uc.reg_read(C.UC_ARM64_REG_D0)))[
                    0
                ]
            )
        )
    elif name == "cJSON_CreateString":
        v = node(cstr(a[0]))
    elif name == "cJSON_AddItemToObject":
        objects[a[0]][cstr(a[1])] = objects[a[2]]
    elif name == "cJSON_PrintUnformatted":
        s = json.dumps(objects[a[0]], separators=(",", ":")).encode()
        v = alloc(len(s) + 1)
        u.mem_write(v, s)
    elif name == "cJSON_Parse":
        try:
            v = node(json.loads(cstr(a[0])))
        except ValueError:
            v = 0
    elif name == "cJSON_GetObjectItemCaseSensitive":
        val = objects[a[0]].get(cstr(a[1]))
        v = node(val) if val is not None else 0
    elif name == "cJSON_Delete":
        pass
    elif name == "__vsnprintf_chk":
        fmt = cstr(a[4])
        va = bytes(u.mem_read(a[5], 32))
        stack, grtop, vr = struct.unpack("<QQQ", va[:24])
        off = struct.unpack("<i", va[24:28])[0]
        params = []
        for j in range(fmt.count("%s")):
            p = int.from_bytes(
                u.mem_read(
                    grtop + off + j * 8 if off + j * 8 < 0 else stack + (off + j * 8), 8
                ),
                "little",
            )
            params.append(cstr(p))
        assert fmt.replace("%s", "").find("%") < 0, fmt
        s = (fmt % tuple(params)).encode()
        assert len(s) < a[1]
        u.mem_write(a[0], s + b"\0")
        v = len(s)
    elif name in ["strcmp", "strncmp"]:
        aa = cstr(a[0])
        bb = cstr(a[1])
        v = 0 if (aa == bb if name == "strcmp" else aa[: a[2]] == bb[: a[2]]) else 1
    elif name == "strstr":
        i = cstr(a[0]).find(cstr(a[1]))
        v = 0 if i < 0 else a[0] + i
    elif name == "__strlen_chk":
        v = len(cstr(a[0]))
    else:
        handled = False
    if handled:
        uc.reg_write(X[0], v)
        uc.reg_write(C.UC_ARM64_REG_PC, uc.reg_read(C.UC_ARM64_REG_LR))
    else:
        basehook(uc, addr, size, _)


u.hook_del(hook_handle)
u.hook_add(UC_HOOK_CODE, jsonhook)
uid = b"synthetic-uid"
dev = b"synthetic-device"
nonce = b"synthetic-client-nonce"
cred = (b"synthetic-credential-value-64-bytes" + b"Z" * 64)[:64]
for off, value in [(0x18, uid), (0x20, dev), (0x28, nonce), (0x68, cred)]:
    p = alloc(len(value) + 1)
    u.mem_write(p, value)
    p64(ctx + off, p)
p64(ctx + 0x70, 64)
u.mem_write(ctx + 0x10, struct.pack("<I", 1))


def decode_record(out, n):
    b = bytes(u.mem_read(out, n))
    pos = 4
    attrs = {}
    while pos < len(b):
        t, ln = struct.unpack(">HH", b[pos : pos + 4])
        attrs[t] = b[pos + 4 : pos + 4 + ln]
        pos += 4 + ln + (-ln % 4)
    op = Cipher(algorithms.AES(key), modes.CBC(attrs[2])).decryptor()
    plain = op.update(attrs[7]) + op.finalize()
    plain = plain[: -plain[-1]]
    return int.from_bytes(attrs[1], "big"), json.loads(plain)


out = alloc(4096)
ln = alloc(4)
assert invoke(named["relay_session_handshake_encode_request"], [ctx, out, ln]) == 0
n = int.from_bytes(u.mem_read(ln, 4), "little")
request_type, request = decode_record(out, n)
assert request_type == 0 and request == {
    "clientType": 1,
    "method": "request",
    "devId": dev.decode(),
    "uId": uid.decode(),
    "authorization": "random=" + nonce.decode(),
}


def server_record(signature, typ=1, method="response"):
    val = {
        "method": method,
        "statuscode": 200,
        "authorization": "signature=" + signature + ",random=synthetic-server-nonce",
    }
    plain = json.dumps(val, separators=(",", ":")).encode()
    p = alloc(len(plain))
    u.mem_write(p, plain)
    item = alloc(0x310)
    p64(item + 0x118, p)
    u.mem_write(item + 0x120, struct.pack("<H", len(plain)))
    u.mem_write(item, struct.pack("<H", typ))
    out = alloc(4096)
    ln = alloc(4)
    assert invoke(0x9A08C, [ctx, item, out, ln]) == 0
    return out, int.from_bytes(u.mem_read(ln, 4), "little")


signature = hmac.digest(cred, b":".join([right, left, uid, nonce]), "sha256").hex()
out, n = server_record(signature)
assert invoke(named["relay_session_handshake_handle_msg"], [ctx, out, n]) == 2
ack = alloc(4096)
ln = alloc(4)
assert invoke(named["relay_session_handshake_encode_ack"], [ctx, ack, ln]) == 0
n = int.from_bytes(u.mem_read(ln, 4), "little")
ack_type, ack_obj = decode_record(ack, n)
expected_ack = hmac.digest(
    cred,
    b":".join([right, left, uid, signature.encode(), b"synthetic-server-nonce"]),
    "sha256",
).hex()
assert ack_type == 2 and ack_obj["authorization"] == "signature=" + expected_ack
out, n = server_record("unused", 3, "complete")
assert invoke(named["relay_session_handshake_handle_msg"], [ctx, out, n]) == 3
print(
    json.dumps(
        {
            "synthetic_only": True,
            "request": request,
            "response_signature_verified_by_native": True,
            "ack_type": ack_type,
            "ack_fields": list(ack_obj),
            "ack_signature_matches_independent_hmac": True,
            "complete_accepted": True,
        }
    )
)


# All negative cases are offline and invoke the native verifier.
def signed(v):
    return v - (1 << 32) if v & (1 << 31) else v


negative = {}
u.mem_write(ctx + 0x40, b"\0\0")
out, n = server_record("0" * 64)
negative["wrong_challenge_signature"] = (
    signed(invoke(named["relay_session_handshake_handle_msg"], [ctx, out, n])) == 0
)
u.mem_write(ctx + 0x40, b"\0\0")
out, n = server_record(signature)
u.mem_write(out + n - 1, bytes([u.mem_read(out + n - 1, 1)[0] ^ 1]))
negative["changed_outer_hmac"] = (
    signed(invoke(named["relay_session_handshake_handle_msg"], [ctx, out, n])) == -1
)
u.mem_write(ctx + 0x40, b"\0\0")
out, n = server_record(signature)
assert invoke(named["relay_session_handshake_handle_msg"], [ctx, out, n]) == 2
negative["duplicate_response"] = (
    signed(invoke(named["relay_session_handshake_handle_msg"], [ctx, out, n])) == -4
)
for label, offset, value in [
    ("wrong_peer", 8, b"wrong-peer"),
    ("stale_session_nonce", 0x28, b"old-client-nonce"),
]:
    saved = bytes(u.mem_read(ctx + offset, 8))
    ptr = alloc(len(value) + 1)
    u.mem_write(ptr, value)
    p64(ctx + offset, ptr)
    u.mem_write(ctx + 0x40, b"\0\0")
    out, n = server_record(signature)
    negative[label] = (
        signed(invoke(named["relay_session_handshake_handle_msg"], [ctx, out, n])) == 0
    )
    u.mem_write(ctx + offset, saved)
assert all(negative.values()), negative
print(json.dumps({"native_negative_cases": negative, "no_network_io": True}))

# Verify digest enum meaning independently, rather than relying on symbol names.
for digest_type, algorithm in [(5, "sha1"), (9, "sha256")]:
    descriptor = invoke(named["mbedtls_md_info_from_type"], [digest_type])
    key_ptr, message_ptr, digest_ptr = alloc(16), alloc(3), alloc(64)
    u.mem_write(key_ptr, b"A" * 16)
    u.mem_write(message_ptr, b"abc")
    assert (
        invoke(
            named["mbedtls_md_hmac"],
            [descriptor, key_ptr, 16, message_ptr, 3, digest_ptr],
        )
        == 0
    )
    expected_digest = hmac.digest(b"A" * 16, b"abc", algorithm)
    assert bytes(u.mem_read(digest_ptr, len(expected_digest))) == expected_digest
print(
    json.dumps(
        {
            "digest_profiles": {"5": "HMAC-SHA1", "9": "HMAC-SHA256"},
            "independently_verified": True,
        }
    )
)


# A strict portable stream accumulator must handle split and coalesced records.
class Records:
    def __init__(self):
        self.pending = bytearray()

    def feed(self, data):
        self.pending.extend(data)
        result = []
        while len(self.pending) >= 4:
            kind, length = struct.unpack(">HH", self.pending[:4])
            if kind not in (0xF400, 0xF500, 0xF600) or length > 4092:
                raise ValueError("invalid carrier header")
            if len(self.pending) < length + 4:
                break
            result.append(bytes(self.pending[: length + 4]))
            del self.pending[: length + 4]
        return result


records = [
    struct.pack(">HHHH", 0xF600, 28, 7, 24) + bytes(range(24)),
    struct.pack(">HH", 0xF500, 0),
]
wire = b"".join(records)
for split in range(len(wire) + 1):
    accumulator = Records()
    assert accumulator.feed(wire[:split]) + accumulator.feed(wire[split:]) == records
    assert not accumulator.pending
accumulator = Records()
received = []
for value in wire:
    received.extend(accumulator.feed(bytes([value])))
assert received == records
for invalid in [struct.pack(">HH", 0xF600, 4093), struct.pack(">HH", 0xFFFF, 0)]:
    try:
        Records().feed(invalid)
    except ValueError:
        continue
    raise AssertionError("invalid stream header accepted")
print(
    json.dumps(
        {
            "split_positions_tested": len(wire) + 1,
            "bytewise_and_coalesced_records": True,
            "invalid_header_rejection": True,
        }
    )
)
