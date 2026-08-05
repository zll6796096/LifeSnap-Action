# LifeSnap Build 6 Stable Xcode Cloud Resubmission Design

## Approval and Decision

The user approved this design direction on 2026-08-04 JST: connect the existing public GitHub repository to Xcode Cloud, use Apple-managed signing on a stable macOS/Xcode environment, create version 1.1 Build 6, and resubmit it to App Review.

The selected approach is Xcode Cloud. GitHub Actions with exported signing credentials and a second local stable-macOS installation are explicitly rejected for this release because they add credential exposure or unsafe disk/operating-system work.

## Real Objective

Produce a version 1.1 Build 6 binary that passes Apple's toolchain validation and returns to an independently verified App Review waiting state without changing the app's product behavior or the already-promoted production backend.

The governing rule is evidence before status: a successful archive, upload, or initial App Store Connect status must not be promoted into an App Review acceptance claim. Mail, build processing, submission state, approval, manual release, and storefront availability remain separate gates.

## Root Cause and Evidence

Build 5 was compiled with public Xcode 26.6 (`17F113`) but on macOS 27.0 beta (`26A5378n`). Apple rejected the submitted binary with `ITMS-90111: Unsupported SDK or Xcode version` and instructed the developer to upload a new binary built with a currently supported toolchain.

Local evidence shows:

- `/Applications/Xcode.app` is public Xcode 26.6 (`17F113`) with iOS SDK build `23F81a`.
- The current host is macOS 27.0 beta build `26A5378n`.
- Public Xcode's GUI is incompatible with the current host, although its command-line tools can still run.
- Products built on the current host record beta `BuildMachineOSBuild=26A5378n` even when `DTXcodeBuild=17F113`.
- Apple currently lists Xcode 26.6 as a public release.
- GitHub's `macos-26` runner is a stable macOS 26 image and includes Xcode 26.6 (`17F113`).
- The repository has no signing secrets, App Store Connect API key, macOS archive workflow, or configured Xcode Cloud workflow.

The release hypothesis is therefore: a clean Xcode Cloud archive built on stable macOS 26 with public Xcode 26.6 will remove the beta build-machine marker that caused Build 5 to fail toolchain validation.

## Scope

### In scope

- Advance the iOS build number from 5 to 6 in both source-of-truth and tracked generated project files.
- Update the release validator to require Build 6.
- Assign the existing Apple Developer Team to the app target in the project configuration as required for Xcode Cloud automatic signing, keeping the source-of-truth and generated project synchronized.
- Preserve the current bundle identifier, marketing version, production URL, App Attest production entitlement, Firebase configuration, permissions, privacy behavior, and manual-release setting.
- Publish the exact release branch to the existing public GitHub repository.
- Connect that repository to Xcode Cloud using the user's already-approved persistent access.
- Create an archive workflow pinned to a stable public Xcode/macOS environment; beta or floating beta aliases are forbidden.
- Build and upload version 1.1 Build 6 with Apple-managed signing.
- Inspect the produced app/archive metadata and signing state.
- Verify the processed Build 6 on a real iPhone through TestFlight before App Review submission.
- Update reviewer notes and release evidence to record Build 5's actual invalid-binary result and Build 6's observed state.
- Submit Build 6 and independently check both App Store Connect and Apple notification mail.

### Out of scope

- Product features or changes to the Scan -> Confirm -> Schedule flow.
- Backend deployment, Cloud Run traffic, Secret Manager, Gemini configuration, billing, quota behavior, or privacy-label changes.
- Creating or exporting an App Store Connect API key, `.p12`, private signing key, or provisioning-profile secret.
- Adding a GitHub Actions signing workflow.
- Reinstalling, downgrading, repartitioning, or deleting the current macOS system.
- Automatic App Store release, phased release, pricing, territories, ratings, or storefront metadata beyond replacing the selected build and build-specific review note.
- Treating review approval as permission to release manually.

## Architecture and Data Flow

1. **Audited source branch**
   - Work remains in the existing isolated worktree on `codex/lifesnap-build6-xcode-cloud`.
   - Only the Build 6 configuration, Xcode Cloud signing prerequisite, release evidence, and already-in-scope Build 5 closeout changes are committed.
   - The branch is pushed without force and remains the exact source revision selected by Xcode Cloud.

2. **Xcode Cloud repository connection**
   - Xcode Cloud receives the approved persistent connection to `zll6796096/LifeSnap-Action`.
   - No new credential is written to the repository or GitHub Actions secrets.
   - The workflow uses the `LifeSnapAction` scheme and Release archive action.

3. **Stable cloud archive**
   - The workflow explicitly chooses public Xcode 26.6 (`17F113`) or the exact currently supported public successor after verifying Apple's release page.
   - The workflow must run on stable macOS 26; beta macOS/Xcode selections are forbidden.
   - Apple manages distribution signing and upload to App Store Connect.

4. **Artifact inspection**
   - Verify version `1.1`, build `6`, bundle `com.zll.lifesnapaction`, public `DTXcodeBuild`, supported `DTSDKBuild`, and a stable `BuildMachineOSBuild` beginning with the macOS 26 build-family prefix `25`.
   - Verify the stable production API URL, App Attest production entitlement, Apple Distribution signature, `get-task-allow=false`, and strict deep code-signature validity.
   - A `26A5378n` or other beta build-machine marker is a hard failure.

5. **Exact Build 6 device acceptance**
   - Install the processed Build 6 from TestFlight on the real iPhone.
   - Confirm launch, per-upload consent, and one valid production `/api/v2/extract` result.
   - Preserve the existing replay-rejection evidence as source/backend evidence, but do not mislabel it as a test of the exact cloud-produced binary.
   - Record only sanitized statuses; never record images, extracted content, App Check tokens, installation identifiers, account details, or device identifiers.

6. **App Review resubmission**
   - Wait for Build 6 processing and export-compliance readiness.
   - Require no new `ITMS-90111` or other blocking Apple mail before selecting the build.
   - Replace Build 5 with Build 6 on version 1.1, update the review note's build number, retain the accepted screenshots and metadata, and submit one item.
   - Verify the resulting version and submission state directly in App Store Connect and then recheck Apple mail.

## External Access and Security Guardrails

- The user explicitly approved Xcode Cloud's persistent access to the existing public GitHub repository.
- Do not broaden access to other repositories, organizations, private data, or credentials.
- Do not create API keys, signing secrets, or GitHub Actions secrets.
- If Xcode Cloud asks to accept a new legal agreement, create credentials, broaden repository scope, or grant unexpected permissions, stop at that action and request a new confirmation.
- Do not expose Apple account email, phone, device identifier, team member data, access tokens, provisioning contents, or certificate fingerprints in committed evidence or the final report.
- The existing Cloud Build trigger remains disabled until the reviewed release changes are merged and its exact-state restoration guard passes.

## Failure Handling

- If Build 6 contains a beta `BuildMachineOSBuild`, stop before upload and correct the workflow environment.
- If archive/signing fails, preserve logs and diagnose the exact boundary; do not export signing material to GitHub as a workaround.
- If upload or processing produces another Apple validation error, stop and investigate that exact error before creating Build 7.
- If App Store Connect removes or invalidates the submission, record the observed state and do not claim `Waiting for Review`.
- If repository connection, account authorization, or two-factor authentication requires the user, pause only at the authentication boundary and keep all prepared work intact.
- No rollback of the production backend is indicated because this design does not change it.

## Acceptance Criteria

The Build 6 resubmission is complete only when all of the following are true:

1. The release branch contains synchronized Build 6 settings and passes the repository's full test, lint, build, shell, and iOS release-contract checks.
2. Xcode Cloud archives the exact pushed commit on stable macOS using a public supported Xcode.
3. Artifact inspection confirms stable toolchain/build-machine metadata, correct identity, production configuration, distribution signing, and production App Attest entitlement.
4. Build 6 finishes App Store Connect processing without `ITMS-90111` or another unresolved binary issue.
5. The exact TestFlight Build 6 launches on the real iPhone and completes one consent-gated production extraction.
6. App Store Connect accepts version 1.1 Build 6 as the only submitted item and displays a fresh waiting-for-review state.
7. A bounded Apple-mail recheck shows no blocking validation or rejection message for Build 6.
8. Release evidence records Build 5 as invalid, Build 6's exact observed state, all skipped reasons, Git status, and remaining Apple/manual-release gates.

Approval, manual release, propagation, direct Japan storefront availability, and search visibility remain future independent acceptance gates.

## Verification Commands

Repository gates:

```bash
npm test
npm run lint
npm run build
bash -n scripts/promote-verified-candidate.sh
npm run validate:ios-release
git diff --check
git status --short --branch
```

Cloud artifact metadata and signing gates, using paths exported from the downloaded Xcode Cloud artifact:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :BuildMachineOSBuild' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :DTXcodeBuild' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :DTSDKBuild' "$APP_PATH/Info.plist"
codesign --verify --deep --strict "$APP_PATH"
codesign -d --entitlements :- "$APP_PATH"
```

The final App Store checks are UI/mail observations because this environment has no authenticated App Store Connect CLI or API key. They must record the exact displayed state and message timestamp rather than infer success from an earlier action.
