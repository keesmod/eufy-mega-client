"""Library release metadata and tarball boundary regressions."""

import io
import json
from pathlib import Path
import shutil
import subprocess
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
                "src/client.ts\nCHANGELOG.md\n"
                if args[1] == "diff"
                else (self.root / args[-1].split(":", 1)[1]).read_text()
            )

        with (
            patch.object(project, "run", fake_run),
            self.assertRaisesRegex(ValueError, "version bump"),
        ):
            project.check_changes(self.root, "a" * 40, project.metadata(self.root))

    def write_candidate(self, **overrides):
        candidate = {
            "version": project.metadata(self.root)["version"],
            "issue": "https://github.com/keesmod/eufy-mega-client/issues/63",
        }
        candidate.update(overrides)
        (self.root / "release-candidate.json").write_text(json.dumps(candidate))

    def candidate_run(
        self,
        *,
        paths="src/client.ts\nCHANGELOG.md\n",
        tag="",
        pages=None,
        previous_version=None,
    ):
        def fake_run(root, *args):
            if args[0] == "gh":
                self.assertEqual(
                    args,
                    (
                        "gh",
                        "api",
                        "--paginate",
                        "--slurp",
                        "repos/keesmod/eufy-mega-client/releases?per_page=100",
                    ),
                )
                return json.dumps([[]] if pages is None else pages)
            if args[1] == "ls-remote":
                self.assertEqual(
                    args[3], "https://github.com/keesmod/eufy-mega-client.git"
                )
                return tag
            if args[1] == "diff":
                return paths
            value = json.loads((self.root / args[-1].split(":", 1)[1]).read_text())
            if previous_version and args[-1].endswith(":package.json"):
                value["version"] = previous_version
            return json.dumps(value)

        return fake_run

    def test_explicit_unpublished_batch_accepts_same_version(self):
        self.write_candidate()
        with patch.object(project, "run", self.candidate_run()):
            project.check_changes(self.root, "a" * 40, project.metadata(self.root))

    def test_candidate_requires_new_release_notes_for_runtime_change(self):
        self.write_candidate()
        with (
            patch.object(project, "run", self.candidate_run(paths="src/client.ts\n")),
            self.assertRaisesRegex(ValueError, "updated release notes"),
        ):
            project.check_changes(self.root, "a" * 40, project.metadata(self.root))

    def test_candidate_rejects_existing_tag(self):
        self.write_candidate()
        with (
            patch.object(
                project, "run", self.candidate_run(tag="abc\trefs/tags/v0.12.0\n")
            ),
            self.assertRaisesRegex(ValueError, "remote tag"),
        ):
            project.check_unpublished_candidate(self.root, project.metadata(self.root))

    def test_candidate_rejects_published_or_draft_release_on_later_page(self):
        self.write_candidate()
        version = project.metadata(self.root)["version"]
        for draft in (False, True):
            with self.subTest(draft=draft):
                pages = [
                    [{"tag_name": "v0.1.0"}],
                    [{"tag_name": "v" + version, "draft": draft}],
                ]
                with (
                    patch.object(project, "run", self.candidate_run(pages=pages)),
                    self.assertRaisesRegex(ValueError, "release or draft"),
                ):
                    project.check_unpublished_candidate(
                        self.root, project.metadata(self.root)
                    )

    def test_candidate_rejects_stale_or_foreign_scope(self):
        for change in (
            {"version": "0.0.1"},
            {"issue": "https://github.com/other/repo/issues/63"},
            {"bypass": True},
        ):
            with self.subTest(change=change):
                self.write_candidate(**change)
                with (
                    patch.object(project, "run") as remote,
                    self.assertRaisesRegex(ValueError, "tracking issue"),
                ):
                    project.check_unpublished_candidate(
                        self.root, project.metadata(self.root)
                    )
                remote.assert_not_called()

    def test_candidate_remote_failure_is_not_treated_as_absence(self):
        self.write_candidate()
        for failure in (
            subprocess.CalledProcessError(1, "gh"),
            subprocess.TimeoutExpired("git", 180),
        ):
            with self.subTest(failure=type(failure).__name__):
                with (
                    patch.object(project, "run", side_effect=failure),
                    self.assertRaises(type(failure)),
                ):
                    project.check_unpublished_candidate(
                        self.root, project.metadata(self.root)
                    )

    def test_candidate_rejects_malformed_release_inventory(self):
        self.write_candidate()
        for pages in ([], {}, [None], [[{}]]):
            with self.subTest(pages=pages):
                with (
                    patch.object(project, "run", self.candidate_run(pages=pages)),
                    self.assertRaisesRegex(ValueError, "Invalid release inventory"),
                ):
                    project.check_unpublished_candidate(
                        self.root, project.metadata(self.root)
                    )

    def test_version_downgrade_rejected_even_without_runtime_changes(self):
        self.write_candidate()
        with (
            patch.object(
                project,
                "run",
                self.candidate_run(paths="README.md\n", previous_version="99.0.0"),
            ),
            self.assertRaisesRegex(ValueError, "cannot decrease"),
        ):
            project.check_changes(self.root, "a" * 40, project.metadata(self.root))

    def test_new_version_and_documentation_changes_need_no_candidate_lookup(self):
        for paths, previous_version in (
            ("src/client.ts\nCHANGELOG.md\n", "0.0.1"),
            ("README.md\n", None),
        ):
            with self.subTest(paths=paths):
                with (
                    patch.object(
                        project,
                        "run",
                        self.candidate_run(
                            paths=paths, previous_version=previous_version
                        ),
                    ),
                    patch.object(project, "check_unpublished_candidate") as candidate,
                ):
                    project.check_changes(
                        self.root, "a" * 40, project.metadata(self.root)
                    )
                candidate.assert_not_called()

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
