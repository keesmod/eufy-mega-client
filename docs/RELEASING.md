# Releases

Releases use **Actions → Release → Run workflow** on `main`. The default is a
full rehearsal. Publishing is a separate, explicit selection on the same form.
Versions are stable `X.Y.Z` or beta `X.Y.Z-beta.N`. A beta is published as a
GitHub prerelease that never becomes the latest release. This flow does not
create npm releases.

Every release also runs [the complete dependency security checks](DEPENDENCY_SECURITY.md),
including development dependencies. The same checks run daily between releases.

## Versions and candidates

The package version is the release version. A version is published once the tag
`v<version>` exists or a GitHub release uses that tag. Versions follow semver
precedence: `0.29.3-beta.1` < `0.29.3-beta.2` < `0.29.3` < `0.29.4-beta.1`. A
beta `X.Y.Z-beta.N` takes its release notes from the `X.Y.Z` section of
`CHANGELOG.md`. Documentation written in a PR names that stable part.

Changelog headings have two forms. `## X.Y.Z - Unreleased` marks an open batch.
`## X.Y.Z - YYYY-MM-DD` marks a batch dated by its release PR. CI rejects any
other heading that a PR adds. Older headings are never inspected or rewritten.

Runtime changes are files under `src/` and `vendor/`, `scripts/copy-assets.mjs`,
the root `tsconfig.json`, the `dependencies`, `optionalDependencies`, `exports`,
`engines`, `files`, `type` and `scripts.build` fields of `package.json`, and the
production entries of the lockfile. Validate applies these rules to every PR
against its base commit:

- The version never decreases.
- A PR with runtime changes leaves the version at an unpublished value and
  changes the changelog section of its stable part. Several PRs accumulate in
  one candidate.
- A plain `X.Y.Z` version reaches main only through a release PR, the PR that
  changes the version to `X.Y.Z`. It passes the release checks, so its heading
  is dated. A PR that keeps a plain version cannot change runtime.
- A dated section at the base closes that batch. A runtime PR must then raise
  the version, also while the release itself is not published yet.
- CI and documentation changes keep the version and need no changelog entry.

The usual sequence after the stable release `0.29.2`:

| PR                               | Version                                 | Changelog                          |
| -------------------------------- | --------------------------------------- | ---------------------------------- |
| First runtime change             | `0.29.3-beta.1` or `0.30.0-beta.1`      | adds `## 0.29.3 - Unreleased`      |
| Further runtime changes          | keeps `0.29.3-beta.1` while unpublished | extends the `0.29.3` section       |
| After `v0.29.3-beta.1` is public | `0.29.3-beta.2`                         | extends the `0.29.3` section       |
| Release PR                       | `0.29.3`                                | dates it, `## 0.29.3 - 2026-10-20` |

When a runtime PR keeps the base version, CI looks up its tag and every page of
GitHub releases with the workflow token. A failed lookup fails the check. The
release workflow creates the tag before its draft, so the tag lookup also covers
drafts that a read-only token cannot list. A version above the base needs no
lookup, because main never falls below a published version. Each rejection names
the next valid candidate.

## Prepare a pull request

Keep `package.json`, the lockfile's root version and its root package entry
aligned. `npm version 0.29.3-beta.1 --no-git-tag-version` updates all three.
Preserve the MIT license, NOTICE and the upstream source attribution. Update API
and compatibility documentation where the behavior changes.

Update the candidate's `CHANGELOG.md` section with the user-visible behavior,
upgrade steps, compatibility limits and rollback instructions. Rollback names the
previous stable version.

All Validate checks must pass on the current PR commit. The final **ci** check
fails if any prerequisite failed, timed out, was cancelled or skipped. Protect
`main` by requiring a pull request, up-to-date branches, resolved conversations
and the GitHub Actions `ci` check; disallow force pushes and branch deletion.
No second maintainer approval is required for this single-maintainer project.

After merge, check `ci` on the resulting `main` commit. Branch CI alone is not
release evidence. Each Release run calls the same complete Validate workflow
from its own commit, so the release cannot use an older green run.

On a push to main, Validate also fails when `v<version>` is tagged at an earlier
commit and runtime changed since that tag. This catches a PR that passed while
its version was unpublished and merged after the publication. Open a PR that
raises the version. A tag at the pushed commit passes, so reruns of a published
commit stay green.

## Batch release run

Stable releases happen on request, in one run together with ha-eufy-cam. One
approval covers the whole run: this stable release, the camera release PR whose
merge updates the stable Home Assistant app, and both GitHub releases.

1. Start the merge freeze in both repositories.
2. Open the release PR. It sets the version to `X.Y.Z`, the stable part of the
   candidate, dates `## X.Y.Z - YYYY-MM-DD`, completes the upgrade and rollback
   text and points the README install URL at `X.Y.Z`. It normally changes
   nothing else. CI runs the release checks on it.
3. Merge it and wait for `ci` on the resulting main commit.
4. Rehearse and publish that commit as described below.
5. Continue with the camera release PR, which pins this stable version with
   `scripts/bump_client.py X.Y.Z`. See the camera
   [release guide](https://github.com/keesmod/ha-eufy-cam/blob/main/docs/RELEASING.md).
6. Lift the freeze once the camera run is complete, after its bench check and
   reporter follow-ups.

## Betas

A beta lets willing testers install a candidate before its stable release. Publish
it from main with the Release workflow and the beta version as input.

- A beta may be published on its first run without a separate rehearsal. That run
  still validates, builds and verifies the package before it creates the tag.
- An acceptance text without hardware results is enough, for example
  `Prerelease for opt-in testing of ha-eufy-cam#149. CI only, no hardware result yet.`
- The notes open with a sentence that this is a prerelease of `X.Y.Z` for opt-in
  testing, followed by the current `X.Y.Z` section.
- The asset is `keesmod-eufy-mega-client-X.Y.Z-beta.N.tgz`. Consumers pin it by
  its exact URL and integrity, like a stable release.
- A beta must be newer than every public release, stable or beta. It never becomes
  the latest release. After its publication, the next runtime PR raises `N`.
- ha-eufy-cam can pin a client beta on its main between stable releases with
  `scripts/bump_client.py X.Y.Z-beta.N`. A stable camera release requires a
  stable client pin.

## Hotfix lane

A hotfix is a stable release of current main between batch runs. There are no
release branches. Work that must not ship is reverted first, in an ordinary PR
under the candidate rules. Land the fix as a beta candidate, or with a small fix
directly in the release PR, then follow the batch release run. When the camera
needs the fix, its release PR pins the new stable version. When ha-eufy-cam main
pins a client beta, every camera hotfix needs a client stable release at or
above that beta, so revert client work that must not ship first. An advisory in
a transitive dependency of the camera bridge can be fixed in the bridge lockfile
without a client release.

## Merge freeze

From the approval of a batch or hotfix run until the run is complete, only the
release PRs of that run merge to main. Publication uses only the commit that was
rehearsed. When a run stops with `main advanced`, compare the rehearsed commit
with current main. If only documentation changed, rehearse and publish current
main. A runtime change after the approval needs a new approval. Before the
release PR merges, such a change joins the candidate under its current version.

A tag created at a superseded commit uses up its version, because tags never
move. A runtime PR merged after a release PR has to raise the version, so the
dated version can no longer be published from main. Versions never decrease.
Release the newer version instead and keep the unpublished section as history.

## Rehearse and publish

1. Merge the release PR or the beta candidate and wait for `main` CI.
2. Open **Actions → Release → Run workflow**, select `main`, enter the version
   without `v`, and leave **publish** unchecked.
3. Inspect the successful run and download its `release-package` artifact. It
   contains the compiled `.tgz`, `SHA256SUMS` and
   `release-manifest.json` with source commit, component versions and file hashes.
4. Name the changed features and affected transport paths. Protocol, device
   commands and media changes need bounded tests on representative affected
   hardware and HA routes, with one controlling bridge, preserved private state
   and verified cleanup. Reviewed community results can supply this evidence.
   Record the exact versions, observation duration, method and anything unproven.
   CI cannot prove physical sound, battery life or a live migration. Changes that
   do not affect hardware need no new physical tests. Record that rationale.
5. Run **Release** again on the same `main` commit and version, tick **publish**,
   and supply a sanitized acceptance summary or evidence link. The summary is
   included in the public release notes. Never include credentials, serials,
   recognized names, private footage or raw diagnostic logs.
6. The pipeline repeats validation, checks the requested version and current
   `main`, creates the exact tag and a draft, uploads the tested files, downloads
   and verifies them, then publishes. It downloads and verifies the public assets
   once more. Only the publish job has repository write access.

The main branch must still point at the candidate when publication begins and
immediately before the draft becomes public. If it advanced, rerun from current
main. A new version must be newer than every public release, betas included.
Reusing an existing tag at another commit is rejected. A merge or a pushed tag
alone does not publish a release. Releases do not deploy to a Home Assistant
instance.

## Hardware coverage and release scope

Follow the [community evidence policy](COMMUNITY_VALIDATION.md).
A missing test for an otherwise implemented model is not a release or upgrade
veto. Keep previously tested combinations with their original versions and dates.
Do not demand every camera model or a fixed number of installations for each
release. Maintainer ownership of the hardware is not required.

State confirmed behavior, reported results, unconfirmed implementation, known
problems and missing support separately. Required software/security checks and
actual protocol, migration and safety gates remain. For a new protocol path or
major migration, arrange voluntary testing of a recoverable candidate before a
stable claim. Publish such a candidate as a beta.

Dependencies must match the release slice. Unchanged mower-map work cannot block
a camera-focused library or camera release. Changed shared behavior still needs
appropriate checks for affected consumers, and map or mower migrations retain
their actual acceptance requirements. Missing expected devices remain a migration
failure. A qualified release does not wait for completion of the whole programme.

For a known regression, identify affected versions, feature, model/topology and
recovery advice. Verify the fix on the affected path before claiming it resolved.
Keep unresolved validation in its existing issue without silently widening a
support claim. Documentation and report-form changes take effect on GitHub after
merge and do not need a product version bump, HA deployment or live-device test.

## Failure and recovery

The publisher retains the release ID returned when GitHub creates the draft.
Subsequent reads, uploads and publication use that ID. Downloads use asset IDs,
so delayed tag/list indexing cannot hide a draft created by the same run. An ID
read that returns 404 is retried up to four attempts, with 1, 2 and 4 seconds
between attempts and a 10-second timeout per request. Other errors stop the run.
Writes are never retried automatically. If creation has an uncertain outcome or
ID reads remain unavailable, inspect the exact draft and rerun only the failed
job after confirming its tag, commit, notes and assets.

A failed or cancelled build cannot publish. A download, checksum or package
mismatch leaves the candidate as a draft. Rerunning the same commit can resume
missing uploads; reuse the original acceptance summary. Draft notes must match
the candidate before publication. Existing assets are verified and never overwritten. A mismatched
existing asset or an unrelated manual draft requires inspection, not automatic
deletion. Preserve valid published releases and tags.

If a failure occurs after the release became public, inspect the published
assets and run the verification again. The pipeline reports failure; it does not
silently remove a version users may already have installed. An identical already
published candidate is only verified, without uploading or publishing it again.

For a faulty product release, publish a corrected newer version and document
rollback. Do not move its old tag or replace a released file. The consuming
bridge's lockfile must continue to identify the exact library bytes it tested.

## Local checks

Use Python 3.11+ and Node.js 24. GitHub uses bounded Ubuntu jobs.

```sh
python3 scripts/check_workflows.py
python3 -m unittest discover -s scripts/tests -v
python3 scripts/release.py check
python3 scripts/release.py check --base "$(git rev-parse origin/main)"
```

With `--base`, the pull request rules run against that commit. The published
lookup needs an authenticated `gh` session.

Install development dependencies with `npm ci --ignore-scripts`. From a clean
committed checkout, build the complete bundle into a new empty directory:

```sh
python3 scripts/release.py build --directory /tmp/eufy-mega-release-candidate
python3 scripts/release.py verify --directory /tmp/eufy-mega-release-candidate
```

The builder clears generated output, compiles the ESM API and vendored CommonJS
protocol code, and checks the tarball's exact file list, declarations, protocol
assets, version and attribution. It installs that actual tarball in a temporary
consumer and tests public imports and shutdown without contacting Eufy.

A library release does not change Home Assistant automatically. After publication,
`scripts/bump_client.py VERSION` in `keesmod/ha-eufy-cam` verifies the release
assets and pins the exact release URL and lockfile integrity. That repository's
checks and releases follow separately. npm publication and cross-repository
auto-merging are not part of this process.

Actionlint and GitHub Actions are pinned to verified versions/checksums. Update
the pins deliberately and run the workflow validator. `scripts/release.py`,
`scripts/check_workflows.py`, `scripts/tests/test_release.py` and
`.github/workflows/release.yml` are byte-identical in both repositories. Apply
common fixes to both. Project-specific metadata, version rules and package checks
live in `release_project.py` and are tested in `scripts/tests/test_project.py`.
