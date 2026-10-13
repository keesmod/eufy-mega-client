"""Compiled library release invariants and clean-consumer checks.

release.py imports this module before its own definitions exist, so hooks
import release lazily.
"""

import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

REPOSITORY = "keesmod/eufy-mega-client"
# The only changelog headings a PR may add. Older headings stay as they are.
HEADING = re.compile(
    r"## (?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    r" - (?:Unreleased|[0-9]{4}-[0-9]{2}-[0-9]{2})"
)


def run(root, *args):
    return subprocess.run(
        args, cwd=root, text=True, check=True, capture_output=True, timeout=180
    ).stdout


def section(text, stable):
    """The X.Y.Z changelog section as (heading, body), or None."""
    match = re.search(
        r"^(## " + re.escape(stable) + r"(?: [^\n]*)?)\n(.*?)(?=^## |\Z)",
        text,
        re.M | re.S,
    )
    return match and match.groups()


def dated(text, stable):
    return bool(
        re.search(
            r"^## " + re.escape(stable) + r" - [0-9]{4}-[0-9]{2}-[0-9]{2}$", text, re.M
        )
    )


def changelog(root, version):
    """Release notes for version. A beta reads its X.Y.Z section."""
    import release

    stable = release.stable_part(version)
    found = section((root / "CHANGELOG.md").read_text(), stable)
    if not found or len(found[1].strip()) < 20:
        raise ValueError("Missing substantive changelog entry for " + stable)
    return found[1].strip()


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


def runtime_changed(root, rev):
    """Whether the shipped library differs between rev and the checkout."""
    # Without renames, a file moved out of src/ also lists its old path.
    paths = run(
        root, "git", "diff", "--name-only", "--no-renames", rev, "HEAD"
    ).splitlines()
    previous = json.loads(run(root, "git", "show", rev + ":package.json"))
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
        p.startswith(("src/", "vendor/"))
        or p in ("scripts/copy-assets.mjs", "tsconfig.json")
        for p in paths
    )
    changed |= any(current.get(k) != previous.get(k) for k in keys)
    scripts = previous.get("scripts", {}), current.get("scripts", {})
    changed |= scripts[0].get("build") != scripts[1].get("build")
    old_lock = json.loads(run(root, "git", "show", rev + ":package-lock.json"))
    new_lock = json.loads((root / "package-lock.json").read_text())
    return changed or production_lock(old_lock) != production_lock(new_lock)


def check_release(root, meta):
    """A stable release needs its dated changelog heading."""
    import release

    version = meta["version"]
    if not release.is_prerelease(version) and not dated(
        (root / "CHANGELOG.md").read_text(), version
    ):
        raise ValueError(
            f"Release {version} needs the heading '## {version} - YYYY-MM-DD'"
        )


def check_changes(root, base, meta):
    """Pull request rules against the base commit.

    Runtime changes accumulate in one unpublished candidate. A plain version
    reaches main only through a release PR, which passes check_release.
    """
    import release

    version = meta["version"]
    previous = json.loads(run(root, "git", "show", base + ":package.json"))["version"]
    if release.version_key(version) < release.version_key(previous):
        raise ValueError(f"Library version cannot decrease below {previous}")
    text = (root / "CHANGELOG.md").read_text()
    old_text = run(root, "git", "show", base + ":CHANGELOG.md")
    known = set(re.findall(r"^## .*$", old_text, re.M))
    for heading in re.findall(r"^## .*$", text, re.M):
        if heading not in known and not HEADING.fullmatch(heading):
            raise ValueError(
                "Add only '## X.Y.Z - Unreleased' or '## X.Y.Z - YYYY-MM-DD' "
                f"headings, not '{heading}'"
            )
    if version != previous and not release.is_prerelease(version):
        check_release(root, meta)
    if not runtime_changed(root, base):
        return
    stable = release.stable_part(version)
    major, minor, patch, beta = release.parse_version(version)
    # Messages name the next valid candidate.
    raise_to = f"Raise the version, for example to {major}.{minor}.{patch + 1}-beta.1"
    if version == previous and dated(old_text, stable):
        raise ValueError(f"The {stable} batch is closed by its release PR. {raise_to}")
    if version == previous and beta is None:
        raise ValueError(
            f"Runtime changes need a beta candidate, not {version}. {raise_to}"
        )
    if section(text, stable) == section(old_text, stable):
        raise ValueError(
            f"Runtime changes require updated release notes in the {stable} section"
        )
    # A version above the base is unpublished, because main never falls below
    # a published version. Lookup failures are fatal.
    if version == previous and release.published(release.GitHub(REPOSITORY), version):
        raise ValueError(
            f"{version} is published. Raise the version, for example to "
            f"{stable}-beta.{beta + 1}"
        )


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
