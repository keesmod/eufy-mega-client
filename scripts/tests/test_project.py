"""Library release rules and tarball boundary regressions."""

import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release
import release_project as project

ROOT = Path(__file__).resolve().parents[2]
NOTES = "- A user-visible change with upgrade and rollback text.\n"
# Headings from before the current rules. CI never inspects them.
HISTORY = "## 0.12.0 - Unreleased\n\nHistorical notes.\n\n## Older notes\n\nKept.\n"


def entry(version, date="Unreleased", notes=NOTES):
    return f"## {version} - {date}\n\n{notes}\n"


STABLE = entry("0.29.2", "2026-10-12")


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

    def test_beta_reads_its_stable_section(self):
        changelog = self.root / "CHANGELOG.md"
        changelog.write_text("# Changelog\n\n" + entry("0.29.3") + STABLE)
        for version in ("0.29.3-beta.1", "0.29.3-beta.12", "0.29.3"):
            with self.subTest(version=version):
                self.assertEqual(project.changelog(self.root, version), NOTES.strip())
        # A beta heading is not a section, and an empty section does not
        # borrow the notes of the next one.
        for text in (
            entry("0.29.3-beta.1") + STABLE,
            "## 0.29.3 - Unreleased\n" + STABLE,
        ):
            with self.subTest(text=text):
                changelog.write_text("# Changelog\n\n" + text)
                with self.assertRaisesRegex(ValueError, "entry for 0.29.3$"):
                    project.changelog(self.root, "0.29.3-beta.1")

    def test_stable_release_needs_its_dated_heading(self):
        changelog = self.root / "CHANGELOG.md"
        for version, text, accepted in (
            ("0.29.3", entry("0.29.3", "2026-10-20"), True),
            ("0.29.3", entry("0.29.3"), False),
            ("0.29.3", entry("0.29.3", "2026-10-20 (draft)"), False),
            ("0.29.3", STABLE, False),
            ("0.29.3-beta.1", entry("0.29.3"), True),
        ):
            with self.subTest(version=version, text=text):
                changelog.write_text("# Changelog\n\n" + text + STABLE)
                meta = {"repository": project.REPOSITORY, "version": version}
                if accepted:
                    project.check_release(self.root, meta)
                else:
                    with self.assertRaisesRegex(
                        ValueError, "needs the heading '## 0.29.3 - YYYY-MM-DD'"
                    ):
                        project.check_release(self.root, meta)

    def test_beta_tarball_name(self):
        self.assertEqual(
            project.asset_names({"version": "0.29.3-beta.1"}),
            ["keesmod-eufy-mega-client-0.29.3-beta.1.tgz"],
        )

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


class ChangeTests(unittest.TestCase):
    """Pull request rules in a scratch repository: a base commit, then the head.

    The published lookup is replaced. Everything else runs the real git calls.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("package.json", "package-lock.json", "tsconfig.json"):
            shutil.copyfile(ROOT / name, self.root / name)
        self.write("src/index.ts", "export const value = 1;\n")
        self.write("README.md", "# Fixture\n")
        self.git("init", "-q")
        self.initial = self.commit()
        patcher = patch.object(release, "published", return_value=False)
        self.published = patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return subprocess.run(
            [
                "git",
                "-c",
                "user.name=Release test",
                "-c",
                "user.email=release-test@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
                *args,
            ],
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        ).stdout.strip()

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def edit_json(self, name, change):
        path = self.root / name
        value = json.loads(path.read_text())
        change(value)
        path.write_text(json.dumps(value, indent=2) + "\n")

    def state(self, version, *entries):
        """Set the package and lockfile version and the changelog sections."""
        self.edit_json("package.json", lambda p: p.update(version=version))

        def lock(value):
            value["version"] = value["packages"][""]["version"] = version

        self.edit_json("package-lock.json", lock)
        self.write("CHANGELOG.md", "# Changelog\n\n" + "".join(entries) + HISTORY)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", "fixture")
        return self.git("rev-parse", "HEAD")

    def base(self, version, *entries):
        self.git("reset", "-q", "--hard", self.initial)
        self.state(version, *entries)
        self.base_sha = self.commit()

    def source(self):
        with (self.root / "src/index.ts").open("a") as source:
            source.write("export const changed = true;\n")

    def head(self, version, *entries, edit=None):
        self.git("reset", "-q", "--hard", self.base_sha)
        self.state(version, *entries)
        if edit:
            edit()
        self.commit()
        return release.metadata(self.root, base=self.base_sha)

    def rejected(self, message, version, *entries, edit=None):
        with self.assertRaisesRegex(ValueError, message):
            self.head(version, *entries, edit=edit)

    def test_runtime_change_after_a_stable_release_opens_a_beta(self):
        self.base("0.29.2", STABLE)
        for version, stable in (
            ("0.29.3-beta.1", "0.29.3"),
            ("0.30.0-beta.1", "0.30.0"),
        ):
            with self.subTest(version=version):
                meta = self.head(version, entry(stable), STABLE, edit=self.source)
                self.assertEqual(meta["version"], version)
        self.published.assert_not_called()

    def test_runtime_changes_accumulate_in_an_unpublished_candidate(self):
        self.base("0.29.3-beta.1", entry("0.29.3"), STABLE)
        more = entry("0.29.3", notes=NOTES + "- Another change in the batch.\n")
        self.head("0.29.3-beta.1", more, STABLE, edit=self.source)
        self.published.assert_called_once()
        github, version = self.published.call_args.args
        self.assertEqual((github.repo, version), (project.REPOSITORY, "0.29.3-beta.1"))

    def test_published_candidate_must_be_raised(self):
        self.base("0.29.3-beta.1", entry("0.29.3"), STABLE)
        self.published.return_value = True
        more = entry("0.29.3", notes=NOTES + "- Another change in the batch.\n")
        self.rejected(
            r"^0\.29\.3-beta\.1 is published\. Raise the version, for example to "
            r"0\.29\.3-beta\.2$",
            "0.29.3-beta.1",
            more,
            STABLE,
            edit=self.source,
        )
        # A version above the base needs no lookup.
        self.head("0.29.3-beta.2", more, STABLE, edit=self.source)
        self.assertEqual(self.published.call_count, 1)

    def test_published_lookup_failure_is_fatal(self):
        self.base("0.29.3-beta.1", entry("0.29.3"), STABLE)
        self.published.side_effect = ValueError("GitHub API request failed: /releases")
        more = entry("0.29.3", notes=NOTES + "- Another change in the batch.\n")
        self.rejected(
            "GitHub API request failed", "0.29.3-beta.1", more, STABLE, edit=self.source
        )

    def test_runtime_change_needs_new_notes_in_its_stable_section(self):
        self.base("0.29.3-beta.1", entry("0.29.3"), STABLE)
        older = entry("0.29.2", "2026-10-12", NOTES + "- Edited old notes.\n")
        for version, entries in (
            ("0.29.3-beta.1", (entry("0.29.3"), STABLE)),
            ("0.29.3-beta.2", (entry("0.29.3"), STABLE)),
            ("0.29.3-beta.1", (entry("0.29.3"), older)),
        ):
            with self.subTest(version=version, entries=entries):
                self.rejected(
                    "updated release notes in the 0.29.3 section",
                    version,
                    *entries,
                    edit=self.source,
                )
        self.published.assert_not_called()

    def test_closed_batch_rejects_runtime_changes_under_the_base_version(self):
        # A published stable release, then a merged release PR that is not
        # published yet. Neither needs the lookup.
        late = NOTES + "- Late change.\n"
        for version, before, after, raised in (
            ("0.29.2", (STABLE,), (entry("0.29.2", "2026-10-12", late),), "0.29.3"),
            (
                "0.29.3",
                (entry("0.29.3", "2026-10-20"), STABLE),
                (entry("0.29.3", "2026-10-20", late), STABLE),
                "0.29.4",
            ),
        ):
            with self.subTest(version=version):
                self.base(version, *before)
                self.rejected(
                    f"^The {version} batch is closed by its release PR. Raise the "
                    f"version, for example to {raised}-beta.1$",
                    version,
                    *after,
                    edit=self.source,
                )
        self.published.assert_not_called()

    def test_runtime_change_keeping_a_plain_version_needs_a_beta(self):
        self.base("0.29.3", entry("0.29.3"), STABLE)
        more = entry("0.29.3", notes=NOTES + "- Another change.\n")
        self.rejected(
            "need a beta candidate, not 0.29.3. Raise the version, for example "
            "to 0.29.4-beta.1",
            "0.29.3",
            more,
            STABLE,
            edit=self.source,
        )
        self.published.assert_not_called()

    def test_version_cannot_decrease(self):
        for previous, version in (
            ("0.29.2", "0.29.1"),
            ("0.29.3", "0.29.3-beta.1"),
            ("0.29.3-beta.2", "0.29.3-beta.1"),
            ("0.30.0-beta.1", "0.29.9"),
        ):
            stable = dict.fromkeys(release.stable_part(v) for v in (previous, version))
            sections = [entry(v, "2026-10-20") for v in stable]
            with self.subTest(previous=previous, version=version):
                self.base(previous, *sections)
                self.rejected(f"cannot decrease below {previous}", version, *sections)

    def test_release_pr_sets_the_plain_version_with_a_dated_heading(self):
        released = entry("0.29.3", "2026-10-20")
        self.base("0.29.3-beta.2", entry("0.29.3"), STABLE)
        self.head("0.29.3", released, STABLE)
        self.rejected(
            "Release 0.29.3 needs the heading '## 0.29.3 - YYYY-MM-DD'",
            "0.29.3",
            entry("0.29.3"),
            STABLE,
        )
        # A hotfix may also carry its fix in the release PR.
        self.base("0.29.2", STABLE)
        self.head("0.29.3", released, STABLE, edit=self.source)
        self.rejected(
            "needs the heading", "0.29.3", entry("0.29.3"), STABLE, edit=self.source
        )
        self.published.assert_not_called()

    def test_other_changes_keep_any_version(self):
        def development():
            self.write("README.md", "# Fixture\n\nMore text.\n")
            self.write("docs/GUIDE.md", "# Guide\n")
            self.write("test/client.test.mjs", "// test\n")
            self.write("scripts/release_project.py", "# tooling\n")

            def package(value):
                value["description"] = "Changed description"
                value["scripts"]["test"] = "node --test"
                value["devDependencies"]["fixture-dev"] = "1.0.0"

            def lock(value):
                value["packages"]["node_modules/fixture-dev"] = {
                    "version": "1.0.0",
                    "dev": True,
                }

            self.edit_json("package.json", package)
            self.edit_json("package-lock.json", lock)

        for version, sections in (
            ("0.29.2", (STABLE,)),
            ("0.29.3", (entry("0.29.3", "2026-10-20"), STABLE)),
            ("0.29.3-beta.1", (entry("0.29.3"), STABLE)),
        ):
            with self.subTest(version=version):
                self.base(version, *sections)
                self.head(version, *sections, edit=development)
        self.published.assert_not_called()

    def test_added_headings_use_the_open_or_dated_form(self):
        self.base("0.29.2", STABLE)
        for heading in (
            "## 0.29.3-beta.1 - Unreleased",
            "## 0.29.3 (unreleased)",
            "## v0.29.3 - Unreleased",
            "## 0.29.3 - 20-10-2026",
            "## 0.29.3 - Unreleased ",
            "## 0.29.03 - Unreleased",
        ):
            with self.subTest(heading=heading):
                self.rejected(
                    re.escape(
                        "Add only '## X.Y.Z - Unreleased' or '## X.Y.Z - YYYY-MM-DD' "
                        f"headings, not '{heading}'"
                    ),
                    "0.29.2",
                    f"{heading}\n\n{NOTES}\n",
                    STABLE,
                )

    def test_build_inputs_without_a_new_version_are_rejected(self):
        self.base("0.29.2", STABLE)

        def tsconfig():
            self.edit_json(
                "tsconfig.json", lambda c: c["compilerOptions"].update(target="ES2024")
            )

        def build():
            self.edit_json(
                "package.json",
                lambda p: p["scripts"].update(build="tsc -p tsconfig.json"),
            )

        for edit in (tsconfig, build):
            with self.subTest(edit=edit.__name__):
                self.rejected("The 0.29.2 batch is closed", "0.29.2", STABLE, edit=edit)

    def test_runtime_set(self):
        self.base("0.29.2", STABLE)

        def package(change):
            return lambda: self.edit_json("package.json", change)

        def lock(dev):
            def change(value):
                item = {"version": "1.0.0", **({"dev": True} if dev else {})}
                value["packages"]["node_modules/fixture"] = item

            return lambda: self.edit_json("package-lock.json", change)

        def move_source():
            (self.root / "docs").mkdir(exist_ok=True)
            (self.root / "src/index.ts").rename(self.root / "docs/index.ts")

        for name, edit, expected in (
            ("source", self.source, True),
            ("vendor", lambda: self.write("vendor/src/x.ts", "export {};\n"), True),
            ("assets", lambda: self.write("scripts/copy-assets.mjs", "//\n"), True),
            ("moved source", move_source, True),
            ("dependency", package(lambda p: p["dependencies"].update(x="1")), True),
            (
                "optional",
                package(lambda p: p["optionalDependencies"].update(x="1")),
                True,
            ),
            (
                "exports",
                package(lambda p: p["exports"].update({"./x": "./x.js"})),
                True,
            ),
            ("engines", package(lambda p: p["engines"].update(node=">=25")), True),
            ("files", package(lambda p: p["files"].append("extra")), True),
            ("type", package(lambda p: p.update(type="commonjs")), True),
            ("build", package(lambda p: p["scripts"].update(build="tsc")), True),
            ("production lock", lock(dev=False), True),
            ("readme", lambda: self.write("README.md", "# Changed\n"), False),
            ("tests", lambda: self.write("test/x.test.mjs", "//\n"), False),
            ("tooling", lambda: self.write("scripts/check.py", "#\n"), False),
            ("test script", package(lambda p: p["scripts"].update(test="x")), False),
            (
                "dev dependency",
                package(lambda p: p["devDependencies"].update(x="1")),
                False,
            ),
            ("dev lock", lock(dev=True), False),
        ):
            with self.subTest(name=name):
                self.git("reset", "-q", "--hard", self.base_sha)
                edit()
                self.commit()
                self.assertIs(
                    project.runtime_changed(self.root, self.base_sha), expected
                )


if __name__ == "__main__":
    unittest.main()
