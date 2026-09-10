#!/usr/bin/env python3
"""Check catalogue accounting and evidence references without contacting devices."""

import hashlib
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/MODEL_MATRIX.md"
FEATURES = [
    "Type", "Model / evaluated topology", "Discovery", "Available state",
    "Battery", "Stored snapshot", "Live video", "Live audio", "Events",
    "Recordings", "Evidence", "Remaining work",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def table(text, section):
    content = text.split("## " + section + "\n", 1)[1].split("\n## ", 1)[0]
    return [
        [cell.strip() for cell in line.strip().strip("|").split("|")]
        for line in content.splitlines()
        if line.startswith("|")
    ]


def check(text):
    source = (ROOT / "vendor/src/http/types.ts").read_bytes()
    digest = hashlib.sha256(source).hexdigest()
    require(f"`{digest}`" in text, "Catalogue digest changed. Review and repin the matrix.")
    enum = source.decode().split("export enum DeviceType {", 1)[1].split("\n}", 1)[0]
    expected = dict(re.findall(r"^\s*(\w+)\s*=\s*(\d+)", enum, re.M))
    sections = ["Catalogue rows", "Connection owners in the catalogue", "Explicit non-camera exclusions"]
    accounted = {}
    cameras = {}
    for section in sections:
        rows = table(text, section)[2:]
        for row in rows:
            require(len(row) >= 3 and all(row), f"Incomplete {section} row: {row}")
            number, name = row[:2]
            name = name.strip("`")
            require(name not in accounted, f"Duplicate enum row: {name}")
            require(expected.get(name) == number, f"Unknown enum or wrong number: {name}={number}")
            accounted[name] = number
            if section == "Catalogue rows":
                require(len(row) == 8, f"Incomplete catalogue row: {name}")
                require("[" in row[6], f"Missing identity evidence: {name}")
                cameras[number] = row
    require(accounted == expected, f"Missing enum rows: {sorted(expected.keys() - accounted.keys())}")

    # Camera predicates miss several camera-bearing and unresolved catalogue entries.
    device = (ROOT / "vendor/src/http/device.ts").read_text()
    predicate = device.split("static isCamera(type: number): boolean {", 1)[1].split("\n  }", 1)[0]
    camera_names = set(re.findall(r"DeviceType\.(\w+)", predicate))
    camera_names.update(name for name in expected if "CAMERA" in name or "CAM" in name)
    camera_names.update(["LOCK_8530", "LOCK_8531", "LOCK_85V0", "SMART_DROP"])
    for name in camera_names:
        require(expected[name] in cameras, f"Camera candidate incorrectly excluded: {name}")

    feature_rows = table(text, "Core features by protocol type")
    # The first table defines evidence codes. Select the actual feature table.
    start = next(i for i, row in enumerate(feature_rows) if row[0] == "Type")
    require(feature_rows[start] == FEATURES, "Feature columns changed or missing")
    covered = set()
    for row in feature_rows[start + 2:]:
        require(len(row) == len(FEATURES) and all(row), f"Incomplete feature row: {row}")
        number = row[0]
        require(number in cameras and number not in covered, f"Unknown/duplicate feature row: {number}")
        require("[" in row[-2] and "[" in row[-1], f"Missing evidence or obligation: {number}")
        for value in row[2:10]:
            require(value.split()[0] in {"H", "P", "X", "F", "B1/U", "B2/U", "U", "N/A"},
                    f"Unknown feature evidence code: {number}: {value}")
            if value.startswith("H"):
                require("[H0]" in row[-2], f"Hardware claim without hardware evidence: {number}")
            if value.startswith(("P", "F")):
                require("[R1]" in row[-2], f"Reporter claim without reporter evidence: {number}")
        covered.add(number)
    require(covered == cameras.keys(), f"Missing feature rows: {sorted(cameras.keys() - covered)}")

    definitions = re.findall(r"^\[([^\]]+)\]:\s+(\S+)", text, re.M)
    refs = dict(definitions)
    require(len(refs) == len(definitions), "Duplicate link definitions")
    prose = re.sub(r"^\[[^\]]+\]:.*$", "", text, flags=re.M)
    # Remove inline links and code, then check full and shortcut references.
    inline = re.findall(r"\[[^\]]+\]\(([^)]+)\)", prose)
    prose = re.sub(r"\[[^\]]+\]\([^)]+\)", "", prose)
    prose = re.sub(r"`[^`]*`", "", prose)
    prose = re.sub(r"\[[^\]]+\](\[[^\]]+\])", r"\1", prose)
    for key in re.findall(r"\[([^\]]+)\]", prose):
        require(key in refs, f"Unbound evidence link: {key}")
    for target in [*refs.values(), *inline]:
        parsed = urlsplit(target)
        if parsed.scheme:
            require(parsed.scheme == "https", f"Unexpected link scheme: {target}")
            if parsed.netloc == "github.com" and "/blob/" in parsed.path:
                match = re.fullmatch(r"/keesmod/eufy-mega-client/blob/([a-f0-9]{40})/(.+)", parsed.path)
                require(match is not None, f"Code evidence must use an immutable client commit: {target}")
                path = ROOT / unquote(match[2])
                require(path.is_file(), f"Missing code evidence file: {path}")
                if parsed.fragment:
                    lines = re.fullmatch(r"L(\d+)(?:-L(\d+))?", parsed.fragment)
                    require(lines is not None, f"Invalid code line fragment: {target}")
                    limit = len(path.read_text().splitlines())
                    require(1 <= int(lines[1]) <= int(lines[2] or lines[1]) <= limit,
                            f"Invalid code line range: {target}")
        elif parsed.path:
            require((MATRIX.parent / unquote(parsed.path)).is_file(), f"Missing local link: {target}")
    require(";" not in text, "Semicolons are not used in project prose")
    return f"Matrix valid: {len(cameras)} camera types, {len(expected)} enum entries, {len(covered)} feature rows, {len(refs)} references"


if __name__ == "__main__":
    try:
        print(check(MATRIX.read_text()))
    except (ValueError, IndexError, StopIteration) as error:
        sys.exit(f"Model matrix check failed: {error}")
