Describe the problem and resulting behavior.

## Validation

List checks run, applicable hardware/HA evidence and behavior still unverified.

## Release impact

- [ ] Name affected components and the candidate version, or state why this is CI/docs only, or mark this as a release PR.
- [ ] Runtime changes use an unpublished `X.Y.Z-beta.N` candidate and update the changelog section of its stable part, with upgrade/rollback guidance naming the previous stable version. A release PR sets plain `X.Y.Z` and dates `## X.Y.Z - YYYY-MM-DD`. Keep `package.json` and the lockfile root aligned.
- [ ] Preserve exact dependency pins and attribution; update compatibility evidence when needed.
- [ ] The required `ci` check passes on the current PR commit.

For a release PR or a beta publication:

- [ ] A stable release has its run approval (batch release run or hotfix lane) and the merge freeze is in effect.
- [ ] After the merge, confirm `ci` on main and run the Release workflow. Rehearse a stable release first and inspect its package artifact. A beta may publish on its first run.
- [ ] Supply sanitized acceptance evidence. Confirm public tag, assets and checksums.
- [ ] After a stable release in a batch run, or in a hotfix that the camera needs or that camera main's client beta pin requires (see the hotfix lane), continue with the camera release PR (`scripts/bump_client.py X.Y.Z`). Otherwise, lift the freeze after the reporter follow-ups.

See [the release flow](https://github.com/keesmod/eufy-mega-client/blob/main/docs/RELEASING.md), including its batch release run and betas sections.
