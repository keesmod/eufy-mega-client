"""Offline synthetic application-framing oracle for the original Tuya artifact.

The separately supplied primary artifact remains private. This tool performs no
network I/O and is never part of the standalone Linux runtime.
"""
import argparse
import hashlib
import io
import json
import struct
import zipfile
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE
import unicorn.arm64_const as C

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("artifact")
args = parser.parse_args()
archive = open(args.artifact, "rb").read()
assert hashlib.sha256(archive).hexdigest() == "70b22b37675ed7ef4d05fc97d5aeda7ea58b5bb5f7e53c8d698d5cbb06089ef0"
raw = zipfile.ZipFile(io.BytesIO(archive)).read("jni/arm64-v8a/libThingP2PFileTransSDK.so")
assert hashlib.sha256(raw).hexdigest() == "a07531b31f4a224d65e6595fb4325864b6c57c100a72a70b22789d920b71490a"
e = ELFFile(io.BytesIO(raw))
symbols = e.get_section_by_name(".dynsym")
named = {s.name: s["st_value"] for s in symbols.iter_symbols() if s["st_value"]}
plt = e.get_section_by_name(".plt")
imports = {plt["sh_addr"] + 32 + i * 16: symbols.get_symbol(r["r_info_sym"]).name for i, r in enumerate(e.get_section_by_name(".rela.plt").iter_relocations())}
u = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
u.mem_map(0, 0x400000)
u.mem_map(0x800000, 0x1000000)
for segment in e.iter_segments():
    if segment["p_type"] == "PT_LOAD":
        u.mem_write(segment["p_vaddr"], segment.data())
for r in e.get_section_by_name(".rela.dyn").iter_relocations():
    if r["r_info_type"] == 1027:
        u.mem_write(r["r_offset"], struct.pack("<Q", r["r_addend"]))
    elif r["r_info_type"] in (257, 1025):
        n = symbols.get_symbol(r["r_info_sym"]).name
        p = named.get(n, 0x3F0000 + len(imports) * 8)
        if n not in named:
            imports[p] = n
        u.mem_write(r["r_offset"], struct.pack("<Q", p + r["r_addend"]))
X = [getattr(C, "UC_ARM64_REG_X" + str(i)) for i in range(31)]
sent = []
received = []
stream = bytearray()

def hook(uc, address, size, context):
    name = imports.get(address)
    if not name:
        return
    a = [uc.reg_read(r) for r in X[:6]]
    result = 0
    if name == "memcpy":
        uc.mem_write(a[0], bytes(uc.mem_read(a[1], a[2])))
        result = a[0]
    elif name == "ThingP2PSendData":
        sent.append((a[0], a[1], bytes(uc.mem_read(a[2], a[3])), a[5]))
        result = a[3]
    elif name == "ThingP2PRecvData":
        wanted = int.from_bytes(uc.mem_read(a[3], 4), "little")
        if not stream:
            uc.mem_write(a[3], b"\0" * 4)
            result = -1
        else:
            part = bytes(stream[:wanted])
            del stream[:wanted]
            uc.mem_write(a[2], part)
            uc.mem_write(a[3], struct.pack("<I", len(part)))
    elif "OnCommandPackageRecved" in name:
        received.append((a[1], a[2], a[3], bytes(uc.mem_read(a[4], a[5]))))
    elif name in ["LOGI", "usleep"]:
        pass
    elif name in named:
        uc.reg_write(C.UC_ARM64_REG_PC, named[name])
        return
    else:
        raise RuntimeError("unsupported adapter: " + name)
    uc.reg_write(X[0], result & ((1 << 64) - 1))
    uc.reg_write(C.UC_ARM64_REG_PC, uc.reg_read(C.UC_ARM64_REG_LR))

u.hook_add(UC_HOOK_CODE, hook)

def invoke(symbol_part, values):
    address = next(v for n, v in named.items() if symbol_part in n)
    for reg, value in zip(X, values):
        u.reg_write(reg, value)
    u.reg_write(C.UC_ARM64_REG_SP, 0x1700000)
    u.reg_write(C.UC_ARM64_REG_LR, 0x700000)
    u.emu_start(address, 0x700000, count=100000)
    assert u.reg_read(C.UC_ARM64_REG_PC) == 0x700000

manager = 0x800000
u.mem_write(manager + 4, struct.pack("<I", 7))
u.mem_write(0xF00000, struct.pack("<I", 0x10000))
for request in [0, 1, 65535, 65536]:
    invoke("11SendCommandEiiiPKhi", [manager, request, 10, 0, 0xF00000, 4])
    expected = struct.pack("<IIIHHII", 0x12345678, request, 0, 10, 0, 4, 0x10000)
    assert sent[-1] == (7, 0, expected, 3)
    # Synthetic response uses the peer response flag and an independent version.
    stream.extend(struct.pack("<IIIHHII", 0x12345678, request, 1, 10, 0, 4, 0x10002))
    invoke("24RecvCommandPackageRunnerEv", [manager])
    assert received[-1] == (request, 10, 0, struct.pack("<I", 0x10002))
before = len(received)
stream.extend(struct.pack("<IIIHHII", 0, 17, 1, 10, 0, 4, 0x10002))
invoke("24RecvCommandPackageRunnerEv", [manager])
assert len(received) == before
print(json.dumps({"native_encoder_cases": 4, "native_receiver_cases": 4, "bad_marker_rejected": True, "synthetic_only": True, "hardware_authentication_proven": False}))
