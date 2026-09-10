"""Offline synthetic map command and stream oracle for the original Tuya artifact.

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

heap=0xb00000
captures=[]
def alloc(n):
 global heap
 p=heap;heap+=(n+15)//16*16;return p
def string(p):return bytes(u.mem_read(p,1024)).split(b'\0')[0]
def hook(uc,address,size,ctx):
 name=imports.get(address)
 if not name:return
 a=[uc.reg_read(r) for r in X[:8]];result=0
 if 'AsyncSendCommand' in name:
  captures.append({'main':a[1],'sub':a[2],'payload':bytes(uc.mem_read(a[3],a[4])).hex()});uc.emu_stop();return
 if name in ['LOGI','LOGE','usleep','gettimeofday'] or 'mutex' in name or 'StartDownload' in name:pass
 elif 'NetProtocolSupported' in name:result=1
 elif 'CommandReqIdGen' in name:result=17
 elif name=='strncpy':
  v=string(a[1])[:a[2]];uc.mem_write(a[0],v+b'\0'*(a[2]-len(v)));result=a[0]
 elif name in ['strlen','__strlen_chk']:result=len(string(a[0]))
 elif name=='memcmp':result=0 if uc.mem_read(a[0],a[2])==uc.mem_read(a[1],a[2]) else 1
 elif name in ['_Znwm','_Znam']:result=alloc(a[0])
 elif name in ['_ZdlPv','_ZdaPv']:pass
 elif name=='memset':uc.mem_write(a[0],bytes([a[1]&255])*a[2]);result=a[0]
 elif 'ParseStream' in name:
  # Synthetic RapidJSON DOM for {files:[...]} at documented library ABI input.
  files=[b'map.bin',b'clean.bin',b'nav.bin'];member=alloc(48);arr=alloc(24*len(files))
  uc.mem_write(a[0],struct.pack('<I',1));uc.mem_write(a[0]+8,struct.pack('<Q',member));uc.mem_write(a[0]+22,struct.pack('<H',3))
  uc.mem_write(member,b'files');uc.mem_write(member+21,bytes([16]));uc.mem_write(member+22,struct.pack('<H',0x1000));uc.mem_write(member+24,struct.pack('<I',len(files)));uc.mem_write(member+32,struct.pack('<Q',arr));uc.mem_write(member+46,struct.pack('<H',4))
  for i,f in enumerate(files):uc.mem_write(arr+i*24,f+b'\0');uc.mem_write(arr+i*24+23,b'\x10')
  result=a[0]
 elif 'basic_string' in name and 'C2' in name:
  s=string(a[1]);uc.mem_write(a[0],bytes([len(s)*2])+s+b'\0');result=a[0]
 elif name in named:uc.reg_write(C.UC_ARM64_REG_PC,named[name]);return
 else:raise RuntimeError('adapter '+name)
 uc.reg_write(X[0],result & ((1<<64)-1));uc.reg_write(C.UC_ARM64_REG_PC,uc.reg_read(C.UC_ARM64_REG_LR))
command_hook=u.hook_add(UC_HOOK_CODE,hook)
manager=0x800000
u.mem_write(manager+0x300458,struct.pack('<I',6))
u.mem_write(0xf00000,b'mapalbum\0')
u.mem_write(0xf01000,b'{"files":["map.bin","clean.bin","nav.bin"]}\0')
def invoke(part,values):
 for reg,v in zip(X,values):u.reg_write(reg,v)
 u.reg_write(C.UC_ARM64_REG_SP,0x1700000);u.reg_write(C.UC_ARM64_REG_LR,0x700000)
 u.emu_start(next(v for n,v in named.items() if part in n),0x700000,count=100000)
 assert captures,hex(u.reg_read(C.UC_ARM64_REG_PC))
invoke('14QueryAlbumFile',[manager,0,0xf00000])
invoke('17StartDownLoadFile',[manager,0xf00000,0,0xf01000,1])
invoke('20CancelUpDownloadFile',[manager])
assert [(r['main'],r['sub']) for r in captures]==[(100,12),(100,13),(100,13)]
assert bytes.fromhex(captures[0]['payload'])==struct.pack('<I',0)+b'mapalbum'.ljust(112,b'\0')
expected=struct.pack('<II',5,0)+b'mapalbum'.ljust(48,b'\0')+struct.pack('<II',0,3)+b''.join(s.ljust(48,b'\0') for s in [b'map.bin',b'clean.bin',b'nav.bin'])
assert bytes.fromhex(captures[1]['payload'])==expected
assert bytes.fromhex(captures[2]['payload'])==struct.pack('<II',0,4)+bytes(64)
u.hook_del(command_hook)


stream=bytearray();received=[];heap=0xb00000;task=0x800000
u.mem_write(task,struct.pack('<Q',0x900000));u.mem_write(0x900000,struct.pack('<Q',0x900100));u.mem_write(0x900118,struct.pack('<Q',0x3e0100));u.mem_write(task+8,struct.pack('<I',1));u.mem_write(task+0x444,b'\1')
def hook(uc,address,size,ctx):
 global heap
 a=[uc.reg_read(r) for r in X[:8]];name=imports.get(address);result=0
 if address==0x3e0100:
  received.append({'index':a[4],'count':a[2],'total':a[5],'size':a[7],'type':int.from_bytes(uc.mem_read(uc.reg_read(C.UC_ARM64_REG_SP),4),'little'),'name':bytes(uc.mem_read(a[3],48)).split(b'\0')[0].decode(),'data':bytes(uc.mem_read(a[6],a[7])).decode()})
 elif not name:return
 elif name=='ThingP2PRecvData':
  assert a[1]==5
  wanted=int.from_bytes(uc.mem_read(a[3],4),'little');n=min(wanted,len(stream),7)
  if n:uc.mem_write(a[2],bytes(stream[:n]));del stream[:n]
  else:uc.mem_write(task+0x38,b'\1');result=-1
  uc.mem_write(a[3],struct.pack('<I',n))
 elif name=='_Znam':result=heap;heap+=(a[0]+15)//16*16
 elif name in ['LOGI','usleep','_ZdaPv']:pass
 else:raise RuntimeError(name)
 uc.reg_write(X[0],result & ((1<<64)-1));uc.reg_write(C.UC_ARM64_REG_PC,uc.reg_read(C.UC_ARM64_REG_LR))
u.hook_add(UC_HOOK_CODE,hook)
def packet(index,name,data,end,total):
 b=bytearray(80);struct.pack_into('<IIIII',b,0,1,1000,0x10002,index,3);b[20:20+len(name)]=name.encode();struct.pack_into('<III',b,68,len(data),total,end);return b+data
stream+=packet(0,'map.bin.stream',b'abc',0,6)+packet(1,'map.bin.stream',b'def',1,6)+packet(2,'cleanPath.bin.stream',b'path',1,4)+packet(3,'navPath.bin.stream',b'nav',1,3)
u.reg_write(X[0],task);u.reg_write(C.UC_ARM64_REG_SP,0x1700000);u.reg_write(C.UC_ARM64_REG_LR,0x700000)
u.emu_start(0x1b1f4,0x700000,count=100000)
assert [r['type'] for r in received]==[1,2,3,3]
assert ''.join(r['data'] for r in received)=='abcdefpathnav'
print(json.dumps({'originalCommandCases':3,'originalStreamCallbacks':4,'splitReadMaximum':7,'orderingAndCompletionVerified':True,'syntheticOnly':True}))
