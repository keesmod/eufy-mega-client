# Community validation dependency review, 2026-09-11

Decision receipt for [#117](https://github.com/keesmod/eufy-mega-client/issues/117).
Current issue bodies and Project fields remain authoritative. No hardware acceptance
or product implementation is completed by this review. The existing acceptance
criteria and original evidence remain in every issue.

The review covered all open E6 validation/release obligations, their native
dependencies, and the four foundation-dependent stories with stale blocker wording.
Only the unconditional native edge from client #63 to #54 is removed. Its map
acceptance remains conditional on the actual release slice. All other native
dependencies and parent links are preserved.

| Existing obligation                                                   | Classification and next action                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [client #21](https://github.com/keesmod/eufy-mega-client/issues/21)   | Closed native prerequisites, Ready scope review still needed. See the issue for the scoped next action.        |
| [client #22](https://github.com/keesmod/eufy-mega-client/issues/22)   | SoloCam software prerequisite and dated reporter evidence. See the issue for the scoped next action.           |
| [client #23](https://github.com/keesmod/eufy-mega-client/issues/23)   | Closed native prerequisites, Ready scope review still needed. See the issue for the scoped next action.        |
| [client #41](https://github.com/keesmod/eufy-mega-client/issues/41)   | Closed native prerequisites, Ready scope review still needed. See the issue for the scoped next action.        |
| [client #56](https://github.com/keesmod/eufy-mega-client/issues/56)   | Implementation prerequisite, then community validation. See the issue for the scoped next action.              |
| [client #57](https://github.com/keesmod/eufy-mega-client/issues/57)   | Implementation prerequisite, then community validation. See the issue for the scoped next action.              |
| [client #59](https://github.com/keesmod/eufy-mega-client/issues/59)   | Implementation prerequisite, then community validation. See the issue for the scoped next action.              |
| [client #60](https://github.com/keesmod/eufy-mega-client/issues/60)   | Implementation prerequisite, then community validation. See the issue for the scoped next action.              |
| [client #61](https://github.com/keesmod/eufy-mega-client/issues/61)   | Implementation prerequisite, then community validation. See the issue for the scoped next action.              |
| [client #62](https://github.com/keesmod/eufy-mega-client/issues/62)   | Implementation prerequisite, then community validation. See the issue for the scoped next action.              |
| [client #63](https://github.com/keesmod/eufy-mega-client/issues/63)   | Release scope, conditional map acceptance. See the issue for the scoped next action.                           |
| [client #96](https://github.com/keesmod/eufy-mega-client/issues/96)   | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #97](https://github.com/keesmod/eufy-mega-client/issues/97)   | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #98](https://github.com/keesmod/eufy-mega-client/issues/98)   | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #99](https://github.com/keesmod/eufy-mega-client/issues/99)   | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #100](https://github.com/keesmod/eufy-mega-client/issues/100) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #101](https://github.com/keesmod/eufy-mega-client/issues/101) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #102](https://github.com/keesmod/eufy-mega-client/issues/102) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #103](https://github.com/keesmod/eufy-mega-client/issues/103) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #104](https://github.com/keesmod/eufy-mega-client/issues/104) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #105](https://github.com/keesmod/eufy-mega-client/issues/105) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #106](https://github.com/keesmod/eufy-mega-client/issues/106) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #108](https://github.com/keesmod/eufy-mega-client/issues/108) | Exact inventory and model/type/transport evidence missing. See the issue for the scoped next action.           |
| [client #109](https://github.com/keesmod/eufy-mega-client/issues/109) | Exact inventory and model/type/transport evidence missing. See the issue for the scoped next action.           |
| [client #110](https://github.com/keesmod/eufy-mega-client/issues/110) | Exact inventory and model/type/transport evidence missing. See the issue for the scoped next action.           |
| [client #111](https://github.com/keesmod/eufy-mega-client/issues/111) | Exact inventory and model/type/transport evidence missing. See the issue for the scoped next action.           |
| [client #112](https://github.com/keesmod/eufy-mega-client/issues/112) | Exact inventory and model/type/transport evidence missing. See the issue for the scoped next action.           |
| [client #113](https://github.com/keesmod/eufy-mega-client/issues/113) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #114](https://github.com/keesmod/eufy-mega-client/issues/114) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [client #115](https://github.com/keesmod/eufy-mega-client/issues/115) | Software-covered profile, exact community hardware evidence missing. See the issue for the scoped next action. |
| [camera #30](https://github.com/keesmod/ha-eufy-cam/issues/30)        | Upstream security remediation, not hardware coverage. See the issue for the scoped next action.                |
| [mower #12](https://github.com/keesmod/eufy-robomow-ha/issues/12)     | Closed native prerequisites, Ready scope review still needed. See the issue for the scoped next action.        |
| [mower #8](https://github.com/keesmod/eufy-robomow-ha/issues/8)       | Required mower implementation, physical safety or migration gate. See the issue for the scoped next action.    |
| [mower #9](https://github.com/keesmod/eufy-robomow-ha/issues/9)       | Required mower implementation, physical safety or migration gate. See the issue for the scoped next action.    |
| [mower #10](https://github.com/keesmod/eufy-robomow-ha/issues/10)     | Required mower implementation, physical safety or migration gate. See the issue for the scoped next action.    |
| [mower #11](https://github.com/keesmod/eufy-robomow-ha/issues/11)     | Required mower implementation, physical safety or migration gate. See the issue for the scoped next action.    |

Camera [#10](https://github.com/keesmod/ha-eufy-cam/issues/10) remains the original
community investigation. The current retest and audio diagnostic request stays
there without a duplicate issue. Client [#51](https://github.com/keesmod/eufy-mega-client/issues/51)
retains its independent map-semantics blocker even though its native predecessors
are closed. Hardware-related E3 #43/#44/#46 and E4 #54 retain their actual control,
setting and lifecycle prerequisites. The completed camera #20/#21/#24/#31 and
client #55/#58 evidence is not reopened or generalized to other models.

The software-covered exact eufyCam and admitted battery-doorbell combinations
wait for community hardware evidence. Older candidate battery models additionally
need exact model/type/owner evidence. Family and mower acceptance still needs its
linked implementation or migration prerequisites. No model count is a release quota.

The process adds no mandatory global release gate. Continue with the existing
SoloCam feedback path and client #21 before #22 when executable. Acute user failures,
unsafe behavior and blocked upgrades take precedence. No successor starts automatically.

This delivery contains documentation and form changes only. The HA feedback button,
automatic prefill and full beta-channel tooling remain outside its scope. No new
story, runtime change, hardware test, publication or deployment is required.
