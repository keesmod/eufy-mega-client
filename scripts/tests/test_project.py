"""Library release metadata and tarball boundary regressions."""

import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release_project as project

ROOT = Path(__file__).resolve().parents[2]


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("package.json", "package-lock.json", "CHANGELOG.md"):
            shutil.copyfile(ROOT / name, self.root / name)

    def test_current_metadata_is_coherent(self):
        self.assertEqual(project.metadata(self.root)["repository"], project.REPOSITORY)

    def test_stale_lockfile_rejected(self):
        p = self.root / "package-lock.json"
        data = json.loads(p.read_text())
        data["packages"][""]["version"] = "0.0.1"
        p.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "versions differ"):
            project.metadata(self.root)

    def test_missing_release_notes_rejected(self):
        with self.assertRaisesRegex(ValueError, "changelog"):
            project.changelog(self.root, "99.0.0")

    def test_code_change_without_new_version_rejected(self):

        def fake_run(root, *args):
            return (
                "src/client.ts\n"
                if args[1] == "diff"
                else (self.root / args[-1].split(":", 1)[1]).read_text()
            )

        with (
            patch.object(project, "run", fake_run),
            self.assertRaisesRegex(ValueError, "version bump"),
        ):
            project.check_changes(self.root, "a" * 40, project.metadata(self.root))

    def test_tarball_links_rejected_before_unpacking(self):
        meta = project.metadata(self.root)
        with tarfile.open(self.root / project.asset_names(meta)[0], "w:gz") as archive:
            link = tarfile.TarInfo("package/dist/index.js")
            link.type = tarfile.SYMTYPE
            link.linkname = "/tmp/unrelated"
            archive.addfile(link)
        with self.assertRaisesRegex(ValueError, "links or non-files"):
            project.verify_archives(self.root, meta)

    def test_unexpected_private_file_rejected(self):
        meta = project.metadata(self.root)
        with tarfile.open(self.root / project.asset_names(meta)[0], "w:gz") as archive:
            info = tarfile.TarInfo("package/credentials.json")
            info.size = 2
            archive.addfile(info, io.BytesIO(b"{}"))
        with self.assertRaisesRegex(ValueError, "unexpected files"):
            project.verify_archives(self.root, meta)

    def test_production_lock_detects_runtime_but_ignores_dev_changes(self):
        before = {
            "packages": {
                "": {"version": "1.0.0"},
                "node_modules/runtime": {"version": "1.0.0", "integrity": "first"},
                "node_modules/test": {"version": "1.0.0", "dev": True},
            }
        }
        changed = json.loads(json.dumps(before))
        changed["packages"]["node_modules/test"]["version"] = "2.0.0"
        self.assertEqual(
            project.production_lock(before), project.production_lock(changed)
        )
        changed["packages"]["node_modules/runtime"]["integrity"] = "second"
        self.assertNotEqual(
            project.production_lock(before), project.production_lock(changed)
        )


if __name__ == "__main__":
    unittest.main()
