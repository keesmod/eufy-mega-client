# Community evidence and upgrades

Users can install ordinary updates without their exact hardware having been
tested by a maintainer. A missing test result describes an evidence gap. It does
not, by itself, disable an implemented feature or block a qualified release.
Maintainers do not need to own every model.

Actual missing protocol support, known regressions, migration integrity and
physical safety still matter. A camera migration must detect missing expected
devices. Mower movement and setting writes retain explicit opt-in, fresh telemetry
and supervised validation. This policy changes no runtime capability or safety gate.

## Report what you observed

Use the camera project's [compatibility form](https://github.com/keesmod/ha-eufy-cam/issues/new?template=compatibility.yml).
Participation is voluntary. Successful, failed and partial results all help.
If an existing issue covers the same problem, add your results there instead of
opening another issue. A report is never required to install an upgrade.

Record model numbers, camera and owner firmware, direct or HomeBase connection,
client version if known, bridge and integration versions, HA version, observation
date, player and LAN/VPN/proxy route. Say unknown where a version is unavailable.
For several models or routes, identify which result belongs to each combination.
Do not substitute a marketing name such as S220 for a model number.

Report pass, fail or not tested separately for discovery, available state/battery,
stored snapshots, live video, audible live audio, recording listing and playback
with sound, events, closing/reopening viewers and restart recovery. State how you
checked the result and any observation interval. Closing a popup does not prove
device stop. A stored image does not prove a new exposure. A sent command or
connected push subscription does not prove the expected physical event.

Do not deliberately trigger unsafe behavior or network failures to complete a
report. Record untested effects honestly. Keep a backup when following an upgrade
guide. Stop testing a failing migration and follow its recovery instructions.

Diagnostics are optional. Review and redact any excerpt before submitting it.
Do not upload credentials, account details, full identifiers, private addresses,
raw captures, footage or lawn geometry. No automatic telemetry is collected by
this process. Mower observations belong in the existing mower issue, under the
same evidence rules and its stricter physical-control requirements.

## Review and record evidence

Keep recognition, software implementation and hardware observations separate.
Use these descriptions per feature in the existing [model matrix](MODEL_MATRIX.md)
and its linked evidence documents:

| Description                | Required evidence                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unconfirmed implementation | An identified implementation or software test, without a matching physical result.                                                                                                  |
| Reported working           | A reviewed user observation naming the feature and the known combination. Record missing version or method details as limits.                                                       |
| Confirmed behavior         | A reproducible checklist with exact versions, firmware, topology, method and adequate results for the claimed feature. Any required stop, cleanup or recovery evidence is included. |
| Known problem              | A dated failure report or reproduction, with the tested combination, affected feature and evidence source. Distinguish the observed symptom from an inferred cause.                 |
| Not implemented            | The required software path is absent. An untested path is not evidence that implementation is absent.                                                                               |

When neither implementation nor behavior is known, say unknown. Keep not tested
and not applicable explicit. These descriptions do not change public API enums.

A community report can establish confirmed behavior. Maintainer hardware ownership
or a second identical installation is not mandatory. The reviewer checks that the
method and results support the exact claim. A single successful snapshot cannot
confirm audio, events, recordings, recovery or a whole camera family.

For each accepted result, retain the source link, date, exact known combination,
feature, outcome, method, observation duration where relevant and limitations.
Link the existing defect or validation issue. Ask only for details needed to
resolve a material gap. Partial reports can be recorded immediately after review.
Do not wait for every checklist item to pass before recording useful evidence.

Keep conflicting observations side by side until their scope or cause is resolved.
Do not replace a failure with a later delivery announcement. A fix has software
evidence until a relevant retest establishes its hardware outcome. Preserve the
original source and identify any newer evidence that supersedes a claim.

Historical results retain their tested versions and date after a release. They
are not silently promoted to the newest version, but they also do not revert to
untested because a version changed. Silence and absence of bug reports are not
confirmation. No fixed number of installations is a release quota.

## Release decisions

For each release, name the changed features and affected protocol paths. Run the
required software, packaging and security checks. Choose practical validation for
those changes on representative affected paths and record the limits. Community
evidence can supply these physical checks.

Unrelated model tests and unmodified mower-map functionality do not block a camera
or camera-focused library update. A change to a shared component still requires
checks for both consumers where affected. A release that changes map acquisition,
decoding, lifecycle or migration must retain its applicable map acceptance gates.

For new protocol paths or major migrations, use willing testers and a recoverable
candidate before making a stable claim. Clearly identify how to install it, what
is experimental, which tests are requested and how to return to the previous
version. The existing publishing workflows currently support stable versions.
This policy does not add a beta channel or authorize treating an unvalidated
candidate as stable. Dedicated beta tooling can be considered later.

Document confirmed combinations, unconfirmed implemented features, known failures
and missing support separately in release notes. A known regression requires an
assessment of the actual affected feature and versions, a recovery path and a
focused fix. Restrict only behavior justified by the evidence. Do not remove or
move published tags or silently drop devices to complete an upgrade.

## Tracking and completion

Keep current work status in GitHub. In an existing validation issue, name whether
the next step needs community evidence, missing implementation, protocol research,
an upstream change or safe migration evidence. A Hardware pending label alone does
not mean the software is finished. Preserve genuine native dependencies.

An unavailable exact hardware combination is a Blocked validation obligation with
a concrete request for scoped community evidence. Partial results can be recorded
there while it remains open. Missing implementation stays Backlog or Blocked as
appropriate. Ready requires an executable scope, not merely closed predecessor
issues. Validation means acceptance is actively awaiting the requested results.

Software delivery can be Done when its own agreed criteria pass and separate
hardware obligations remain linked. A hardware-validation story and the feature
or epic remain open until their own criteria pass. Never redefine an unfinished
feature as delivered or create duplicate stories to clear a board.

The minimal process uses the existing matrix, issues and report form. A feedback
button in HA, automatic prefill and full beta tooling are outside this delivery.
