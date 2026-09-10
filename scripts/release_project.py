"""Compiled library release invariants and clean-consumer checks."""

import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

REPOSITORY = "keesmod/eufy-mega-client"


def run(root, *args):
    return subprocess.run(
        args, cwd=root, text=True, check=True, capture_output=True, timeout=180
    ).stdout


def changelog(root, version):
    text = (root / "CHANGELOG.md").read_text()
    match = re.search(
        r"^## " + re.escape(version) + r"(?:\s[^\n]*)?\n(.+?)(?=^## |\Z)",
        text,
        re.M | re.S,
    )
    if not match or len(match[1].strip()) < 20:
        raise ValueError("Missing substantive changelog entry for " + version)
    return match[1].strip()


def metadata(root):
    package = json.loads((root / "package.json").read_text())
    lock = json.loads((root / "package-lock.json").read_text())
    if (
        package["name"] != "@keesmod/eufy-mega-client"
        or package["type"] != "module"
        or package["license"] != "(MIT AND Apache-2.0)"
    ):
        raise ValueError("Unexpected library package identity")
    for value in (lock, lock["packages"][""]):
        if value["name"] != package["name"] or value["version"] != package["version"]:
            raise ValueError("Library package and lockfile versions differ")
    expected = {"types": "./dist/index.d.ts", "import": "./dist/index.js"}
    if package["exports"]["."] != expected:
        raise ValueError("Review release checks before changing public entry points")
    return {"repository": REPOSITORY, "version": package["version"]}


def production_lock(lock):
    keys = (
        "version",
        "resolved",
        "integrity",
        "dependencies",
        "optionalDependencies",
        "engines",
        "link",
    )
    return {
        name: {key: value[key] for key in keys if key in value}
        for name, value in lock["packages"].items()
        if name and not value.get("dev")
    }


def check_changes(root, base, meta):
    paths = run(root, "git", "diff", "--name-only", base, "HEAD").splitlines()
    previous = json.loads(run(root, "git", "show", base + ":package.json"))
    current = json.loads((root / "package.json").read_text())
    keys = (
        "dependencies",
        "optionalDependencies",
        "exports",
        "engines",
        "files",
        "type",
    )
    changed = any(
        p.startswith(("src/", "vendor/")) or p == "scripts/copy-assets.mjs"
        for p in paths
    )
    changed |= any(current.get(k) != previous.get(k) for k in keys)
    old_lock = json.loads(run(root, "git", "show", base + ":package-lock.json"))
    new_lock = json.loads((root / "package-lock.json").read_text())
    changed |= production_lock(old_lock) != production_lock(new_lock)
    if changed and tuple(map(int, meta["version"].split("."))) <= tuple(
        map(int, previous["version"].split("."))
    ):
        raise ValueError("Library runtime changes require a version bump and changelog")


def asset_names(meta):
    return ["keesmod-eufy-mega-client-" + meta["version"] + ".tgz"]


def package_members(root):
    paths = run(root, "git", "ls-files", "-z").rstrip("\0").split("\0")
    selected = {
        "package.json",
        "README.md",
        "LICENSE",
        "NOTICE.md",
        "CONTRIBUTING.md",
        "CHANGELOG.md",
    }
    selected.update(p for p in paths if p.startswith("docs/"))
    for name in paths:
        if name.startswith(("src/", "vendor/src/")):
            target = (
                name.replace("vendor/src/", "dist/vendor/", 1)
                if name.startswith("vendor/")
                else name.replace("src/", "dist/", 1)
            )
            if target.endswith(".ts"):
                selected.update((target[:-3] + ".js", target[:-3] + ".d.ts"))
            elif target.endswith((".crt", ".proto")):
                selected.add(target)
    selected.add("dist/vendor/package.json")
    return selected


def verify_archives(folder, meta):
    root = Path(__file__).resolve().parents[1]
    with tarfile.open(folder / asset_names(meta)[0], "r:gz") as archive:
        members = archive.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)) or any(not m.isfile() for m in members):
            raise ValueError("Tarball contains duplicate names, links or non-files")
        if set(names) != {"package/" + p for p in package_members(root)}:
            raise ValueError(
                "Tarball contains unexpected files or lacks compiled assets/attribution"
            )
        package = json.load(archive.extractfile("package/package.json"))
        if (
            package["version"] != meta["version"]
            or package["name"] != "@keesmod/eufy-mega-client"
        ):
            raise ValueError("Wrong embedded package version or name")
        boundary = json.load(archive.extractfile("package/dist/vendor/package.json"))
        if boundary != {"type": "commonjs"}:
            raise ValueError("Missing vendored CommonJS boundary")


def build(root, folder):
    # A clean build prevents removed sources or local files leaking from dist.
    shutil.rmtree(root / "dist", ignore_errors=True)
    run(root, "npm", "run", "build")
    packed = json.loads(
        run(
            root,
            "npm",
            "pack",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            str(folder),
        )
    )
    meta = metadata(root)
    if [item["filename"] for item in packed] != asset_names(meta):
        raise ValueError("npm produced an unexpected archive")
    verify_archives(folder, meta)
    with tempfile.TemporaryDirectory() as temp:
        consumer = Path(temp)
        (consumer / "package.json").write_text('{"private":true,"type":"module"}\n')
        run(
            consumer,
            "npm",
            "install",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            str(folder / asset_names(meta)[0]),
        )
        run(
            consumer,
            "node",
            "--input-type=module",
            "-e",
            """
import { EufyClient, EufyMegaClient, FileSessionStore, PortableMapAcquisition } from '@keesmod/eufy-mega-client';
if (typeof PortableMapAcquisition !== 'function') throw Error('Missing portable map adapter');
if (typeof FileSessionStore !== 'function') throw Error('Missing public export');
const client = new EufyMegaClient({credentials:{email:'fixture',password:'fixture',country:'NL'},
  sessionStore:{load:async()=>undefined,save:async()=>{}}});
await client.shutdown();
const camera = new EufyClient({security:{credentials:{email:'fixture',password:'fixture',country:'NL'},
  sessionStore:{load:async()=>undefined,save:async()=>{}}}});
let connected = false;
const mower = new EufyClient({mowers:{credentials:{email:'mower',password:'fixture',country:'NL'},
  sessionStore:{load:async()=>undefined,save:async()=>{}},
  adapter:()=>({get connected(){return connected},
    connect:async()=>{connected=true;return {state:'connected'}},
    shutdown:async()=>{connected=false}})}});
if (camera.mowers || mower.security) throw Error('Module isolation failed');
await mower.mowers.connect();
await camera.shutdown();
if (!mower.mowers.connected) throw Error('Cross-consumer shutdown');
await mower.shutdown();
""",
        )
