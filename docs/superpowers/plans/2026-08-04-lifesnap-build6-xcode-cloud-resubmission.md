# LifeSnap Build 6 Xcode Cloud Resubmission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce version 1.1 Build 6 on stable macOS 26 with public Xcode 26.6, verify the exact cloud-produced binary, and return it to a freshly confirmed App Review waiting state without changing product behavior or the production backend.

**Architecture:** Preserve the already-promoted backend and existing product source, close the Build 5 evidence truthfully, and make only release-configuration changes locally. Push the exact audited branch to the existing public repository, let Xcode Cloud perform a clean Apple-managed archive/sign/upload on a stable toolchain, then verify the artifact, TestFlight build, App Store Connect state, and Apple mail as independent gates.

**Tech Stack:** SwiftUI, XcodeGen 2.45.4, Xcode Cloud, Xcode 26.6 (`17F113`), iOS SDK build `23F81a`, Firebase App Check/App Attest, Vitest, Bash, GitHub, App Store Connect, TestFlight, Gmail read-only verification.

---

## Fixed Scope and Preconditions

- Worktree: `/Users/zhanglonglong/Projects/apps/LifeSnap-Action/.worktrees/lifesnap-apple-native-ui`
- Branch: `codex/lifesnap-build6-xcode-cloud`
- Design commit: `7771d15` before the later rebase onto `origin/main`
- App identity: version `1.1`, Build `6`, bundle `com.zll.lifesnapaction`
- Apple Developer Team: `YMUG864233`
- Stable cloud toolchain: macOS 26 build-family prefix `25`, Xcode 26.6 build `17F113`, iOS SDK build `23F81a`
- Production URL: `https://lifesnap-action-sxielk4wua-an.a.run.app`
- Production revision remains `lifesnap-action-00041-n9n`; no backend deployment or traffic mutation is authorized by this plan.
- Xcode Cloud repository access is approved only for `zll6796096/LifeSnap-Action`.
- Xcode Cloud must not create an API key, GitHub Actions secret, exported signing key, or provisioning-profile secret.
- Any new legal agreement, credential creation, broader repository scope, or unexpected permission request is a hard pause for user confirmation.

### Task 1: Close the Cloud Run zero-percent traffic regression fix

**Files:**
- Modify: `scripts/promote-verified-candidate.sh:715-742`
- Modify: `src/shared/__tests__/cloudbuild-contract.test.ts:564-590`

- [ ] **Step 1: Review the existing focused diff**

Run:

```bash
git diff -- scripts/promote-verified-candidate.sh src/shared/__tests__/cloudbuild-contract.test.ts
```

Expected implementation:

```python
percent = item.get("percent", 0)
```

and:

```python
sum(item.get("percent", 0) for item in prepromotion_traffic)
sum(item.get("percent", 0) for item in prepromotion_status_traffic)
```

The regression test must remove `percent` only from the zero-percent candidate tag in both `spec.traffic` and `status.traffic`, run the real promotion script fixture, and assert `promotion_result=PENDING_GATE_E`.

- [ ] **Step 2: Run the focused contract suite**

Run:

```bash
npx vitest run src/shared/__tests__/cloudbuild-contract.test.ts
```

Expected: 62 tests pass, including `accepts Cloud Run zero-percent tag entries that omit percent`.

- [ ] **Step 3: Run shell and diff checks**

Run:

```bash
bash -n scripts/promote-verified-candidate.sh
git diff --check -- scripts/promote-verified-candidate.sh src/shared/__tests__/cloudbuild-contract.test.ts
```

Expected: both commands exit 0 with no output from `git diff --check`.

- [ ] **Step 4: Commit only the regression fix**

Run:

```bash
git add scripts/promote-verified-candidate.sh src/shared/__tests__/cloudbuild-contract.test.ts
git diff --cached --check
git commit -m "fix(release): accept omitted zero-percent traffic"
```

Expected: one commit containing only the script and its regression test.

### Task 2: Record Build 5 as an invalid binary

**Files:**
- Create: `docs/verification/yotei-snap-release/build5-app-store-validation.txt`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md:24-44`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md:128-170`
- Modify: `docs/app-store/app-review-notes.md:1-31`

- [ ] **Step 1: Create sanitized Build 5 validation evidence**

Create the file with exactly these non-sensitive fields:

```text
received_at_utc=2026-08-04T09:05:14Z
received_at_jst=2026-08-04T18:05:14+09:00
app_version=1.1
app_build=5
submission_result=INVALID_BINARY
error_code=ITMS-90111
error_category=Unsupported SDK or Xcode version
required_action=Build and upload a new binary with a currently supported non-beta toolchain
host_product=macOS 27.0 beta
host_build=26A5378n
compiler_product=Xcode 26.6
compiler_build=17F113
```

Do not include the mailbox address, message ID, Apple account, device identifier, certificate fingerprint, or any link containing a private token.

- [ ] **Step 2: Correct the release-gate table and remaining gates**

Replace the Build 5 submission claims with these states:

```markdown
| Build 5 upload | BLOCKED (historical) | App Store Connect received and processed the binary, then Apple mail rejected it as `ITMS-90111`; the beta host build marker makes it invalid for App Review |
| Build 6 local configuration | PENDING | Build number, Team assignment, release validator, and branch verification have not yet completed |
| Xcode Cloud stable archive | PENDING | No stable-macOS cloud archive has run |
| Build 6 processing | PENDING | No Build 6 binary has been uploaded |
| Build 6 App Review submission | PENDING | No Build 6 item has been submitted |
```

The `Remaining Apple Release Gates` section must say that Build 5 did not reach substantive App Review and that Build 6 is required. Preserve manual release as a later independent gate.

- [ ] **Step 3: Correct the reviewer-note header**

Change the header prose so it no longer calls Build 5 the production review build. Keep the verified review path and privacy statements as reusable draft content, but label the exact reviewer-facing note as pending Build 6 until Build 6 passes processing.

- [ ] **Step 4: Verify there is no contradictory current-state claim**

Run:

```bash
rg -n "Build 5.*production review build|Build 5.*審査待ち|Build 5.*App Review submission.*PASS|ITMS-90111|INVALID_BINARY" \
  docs/app-store/app-review-notes.md \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md \
  docs/verification/yotei-snap-release/build5-app-store-validation.txt
```

Expected: `ITMS-90111` and `INVALID_BINARY` are present; no current-state line claims Build 5 remains a valid waiting-for-review build. Historical timestamped evidence may retain the initially observed `審査待ち` only when the same paragraph also records the later invalidation.

- [ ] **Step 5: Commit the Build 5 correction**

Run:

```bash
git add docs/verification/yotei-snap-release/build5-app-store-validation.txt \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md \
  docs/app-store/app-review-notes.md
git diff --cached --check
git commit -m "docs(release): record Build 5 invalid binary"
```

Expected: the commit contains only Build 5 truth/evidence changes.

### Task 3: Write the Build 6 and Xcode Cloud signing contract first

**Files:**
- Modify: `scripts/validate-yotei-snap-release.sh:121-193`
- Test: `scripts/validate-yotei-snap-release.sh`

- [ ] **Step 1: Change the validator before changing the project**

Replace the Build 5 assertions with Build 6 and add exact Team/signing assertions:

```bash
assert_contains "$project_yml" 'CURRENT_PROJECT_VERSION: "6"' 'project.yml build version'

yml_team_count=$(grep -cF 'DEVELOPMENT_TEAM: YMUG864233' "$project_yml" 2>/dev/null || true)
yml_signing_count=$(grep -cF 'CODE_SIGN_STYLE: Automatic' "$project_yml" 2>/dev/null || true)
assert_equal "$yml_team_count" '2' 'project.yml Team assignments'
assert_equal "$yml_signing_count" '2' 'project.yml automatic signing assignments'
```

Replace the generated-project checks with:

```bash
build_count=$(grep -cF 'CURRENT_PROJECT_VERSION = 6;' "$pbxproj" 2>/dev/null || true)
team_count=$(grep -cF 'DEVELOPMENT_TEAM = YMUG864233;' "$pbxproj" 2>/dev/null || true)
signing_count=$(grep -cF 'CODE_SIGN_STYLE = Automatic;' "$pbxproj" 2>/dev/null || true)
assert_equal "$marketing_count" '2' 'project.pbxproj marketing version occurrences'
assert_equal "$build_count" '2' 'project.pbxproj build version occurrences'
assert_equal "$team_count" '4' 'project.pbxproj Team assignment occurrences'
assert_equal "$signing_count" '4' 'project.pbxproj automatic signing occurrences'
```

- [ ] **Step 2: Run the validator and verify the RED state**

Run:

```bash
npm run validate:ios-release
```

Expected: nonzero exit. Failures must specifically report missing Build 6 and Team/automatic-signing assignments because the project still contains Build 5 and empty Team values. If the command fails for a different reason, fix the test edit before proceeding.

- [ ] **Step 3: Review the validator diff**

Run:

```bash
git diff --check -- scripts/validate-yotei-snap-release.sh
git diff -- scripts/validate-yotei-snap-release.sh
```

Expected: only the Build 6 and exact signing prerequisites are added; no privacy, endpoint, entitlement, icon, or Firebase assertion is weakened.

### Task 4: Implement Build 6 and automatic signing in the source project

**Files:**
- Modify: `ios/project.yml:18-51`
- Regenerate: `ios/LifeSnapAction.xcodeproj/project.pbxproj`
- Verify: `ios/LifeSnapAction.xcodeproj/xcshareddata/xcschemes/LifeSnapAction.xcscheme`

- [ ] **Step 1: Update the app target settings**

Use exactly:

```yaml
      MARKETING_VERSION: "1.1"
      CURRENT_PROJECT_VERSION: "6"
      DEVELOPMENT_TEAM: YMUG864233
      CODE_SIGN_STYLE: Automatic
```

Keep `API_BASE_URL`, bundle identifier, entitlements path, deployment target, target family, Swift version, and Firebase pin unchanged.

- [ ] **Step 2: Update the test target settings**

Use exactly:

```yaml
      DEVELOPMENT_TEAM: YMUG864233
      CODE_SIGN_STYLE: Automatic
```

Keep the test bundle identifier and target dependency unchanged.

- [ ] **Step 3: Regenerate the tracked Xcode project**

Run:

```bash
(cd ios && xcodegen generate --spec project.yml)
```

Expected: XcodeGen 2.45.4 exits 0 and updates the tracked generated project from the source YAML.

- [ ] **Step 4: Verify the GREEN state**

Run:

```bash
npm run validate:ios-release
```

Expected: all release-contract assertions pass, including Build 6, two YAML Team/signing assignments, four generated Team assignments, and four generated automatic-signing assignments.

- [ ] **Step 5: Verify Xcode Cloud can discover an archivable product**

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/LifeSnapAction.xcodeproj \
  -describeAllArchivableProducts -json
```

Expected JSON values:

```json
{
  "bundleIdentifier": "com.zll.lifesnapaction",
  "displayName": "LifeSnapAction",
  "productName": "LifeSnapAction",
  "productType": "app"
}
```

The containing schemes array must include `LifeSnapAction`, and the destination platform must be iOS.

- [ ] **Step 6: Verify the shared scheme archives only the app**

Run:

```bash
rg -n 'buildForArchiving = "YES"|BuildableName = "LifeSnapAction.app"|BuildableName = "LifeSnapActionTests.xctest"' \
  ios/LifeSnapAction.xcodeproj/xcshareddata/xcschemes/LifeSnapAction.xcscheme
```

Expected: the app has `buildForArchiving="YES"`; the test bundle has `buildForArchiving="NO"`.

- [ ] **Step 7: Commit the validator and generated configuration together**

Run:

```bash
git add scripts/validate-yotei-snap-release.sh \
  ios/project.yml \
  ios/LifeSnapAction.xcodeproj/project.pbxproj \
  ios/LifeSnapAction.xcodeproj/xcshareddata/xcschemes/LifeSnapAction.xcscheme
git diff --cached --check
git commit -m "chore(ios): prepare Build 6 for Xcode Cloud"
```

Expected: one synchronized source/generated configuration commit. If XcodeGen did not change the shared scheme, Git ignores that explicit path safely.

### Task 5: Prepare Build 6 review notes and local evidence

**Files:**
- Modify: `docs/app-store/app-review-notes.md`
- Modify: `docs/app-store/screenshot-plan.md`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`
- Add: `docs/verification/yotei-snap-release/app-store-screenshots/01-capture.png`
- Add: `docs/verification/yotei-snap-release/app-store-screenshots/02-consent.png`
- Add: `docs/verification/yotei-snap-release/app-store-screenshots/03-processing.png`
- Add: `docs/verification/yotei-snap-release/app-store-screenshots/04-review.png`
- Add: `docs/verification/yotei-snap-release/app-store-screenshots/05-needs-review.png`
- Add: `docs/verification/yotei-snap-release/app-store-screenshots/06-no-action.png`
- Add: `docs/verification/yotei-snap-release/app-store-screenshots/07-success.png`
- Add: `docs/verification/yotei-snap-security/device-app-attest-smoke.txt`
- Add: `docs/verification/yotei-snap-security/build5-device-app-attest-smoke.txt`

- [ ] **Step 1: Advance the reviewer-facing note to Build 6**

The exact note must begin:

```text
Build 6 (version 1.1) is the production review build.
```

Keep the existing no-login/no-payment path, per-upload consent, transient processing, Google Gemini disclosure, Calendar behavior, production App Check/App Attest statement, and stable privacy URL. Do not add internal revision IDs, source hashes, billing details, credential details, or device identifiers to the reviewer-facing block.

- [ ] **Step 2: Update the release-gate table to local-ready/cloud-pending**

Use these exact state boundaries:

```markdown
| Build 6 local configuration | PASS | Build number, source/generated project, Team assignment, automatic signing, shared archive scheme, and release validator passed |
| Xcode Cloud stable archive | PENDING | The approved stable workflow has not run |
| Build 6 processing | PENDING | No Build 6 binary has completed App Store Connect processing |
| Exact Build 6 TestFlight device smoke | PENDING | The cloud-produced build has not been installed on the real iPhone |
| Build 6 App Review submission | PENDING | Build 6 has not been submitted |
```

Keep production backend PASS independent and retain Build 4/5 failures as historical rows.

- [ ] **Step 3: Verify all seven screenshots mechanically**

Run:

```bash
for screenshot_file in docs/verification/yotei-snap-release/app-store-screenshots/*.png; do
  sips -g pixelWidth -g pixelHeight -g hasAlpha "$screenshot_file"
done
```

Expected for every file: `pixelWidth: 1320`, `pixelHeight: 2868`, `hasAlpha: no`.

- [ ] **Step 4: Scan evidence for forbidden sensitive fields**

Run:

```bash
rg -n -i 'password|authorization:|bearer |api[_-]?key|app.?check.?token|installation.?id|device.?id|udid|email|phone' \
  docs/verification/yotei-snap-security/device-app-attest-smoke.txt \
  docs/verification/yotei-snap-security/build5-device-app-attest-smoke.txt \
  docs/verification/yotei-snap-release/build5-app-store-validation.txt || true
```

Expected: no matches.

- [ ] **Step 5: Commit the Build 6 documentation and sanitized evidence**

Run:

```bash
git add docs/app-store/app-review-notes.md \
  docs/app-store/screenshot-plan.md \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md \
  docs/verification/yotei-snap-release/app-store-screenshots \
  docs/verification/yotei-snap-security/device-app-attest-smoke.txt \
  docs/verification/yotei-snap-security/build5-device-app-attest-smoke.txt
git diff --cached --check
git commit -m "docs(release): prepare Build 6 evidence"
```

Expected: documentation, screenshots, and sanitized device evidence only.

### Task 6: Run full local gates, rebase, publish, and open a draft PR

**Files:**
- Verify all tracked and untracked in-scope changes
- No new implementation file

- [ ] **Step 1: Run the complete local verification gate**

Run:

```bash
npm test
npm run lint
npm run build
bash -n scripts/promote-verified-candidate.sh
bash -n scripts/validate-yotei-snap-release.sh
npm run validate:ios-release
git diff --check
```

Expected: 10 test files and at least 309 tests pass; lint, build, both shell parsers, release validator, and diff check exit 0. Record the exact fresh test count rather than copying the minimum expectation if the suite grows.

- [ ] **Step 2: Review the complete branch state**

Run:

```bash
git status --short --branch
git diff origin/main...HEAD --stat
git log --oneline --decorate origin/main..HEAD
```

Expected: no uncommitted or untracked files remain. Every branch-only commit is in scope for Build 6 or the already-used promotion fix.

- [ ] **Step 3: Rebase the clean branch onto reviewed `origin/main`**

Run:

```bash
git fetch --prune origin
git rebase origin/main
```

Expected: the design, promotion fix, Build 5 correction, Build 6 configuration, and Build 6 evidence commits replay without losing any changes. Resolve only in-scope conflicts; do not reset, stash, clean, or discard.

- [ ] **Step 4: Re-run the full gate after rebase**

Run the exact Step 1 command block again.

Expected: identical PASS boundaries after rebasing.

- [ ] **Step 5: Use the GitHub publish workflow**

Before staging, pushing, or opening the PR, invoke the `github:yeet` skill and follow its credential, staging, push, and PR requirements.

Run:

```bash
git push -u origin codex/lifesnap-build6-xcode-cloud
```

Expected: non-force push succeeds and the remote branch points to the exact locally verified HEAD.

- [ ] **Step 6: Create the draft PR**

Create a draft PR targeting `main` with title:

```text
Prepare LifeSnap 1.1 Build 6 for Xcode Cloud
```

The body must contain:

```markdown
## Summary
- records Build 5's ITMS-90111 invalid-binary outcome
- advances version 1.1 to Build 6 with explicit automatic Team signing
- preserves the production backend and product behavior while preparing stable Xcode Cloud distribution

## Verification
- npm test
- npm run lint
- npm run build
- npm run validate:ios-release
- focused Cloud Run promotion regression

## Release boundary
- no backend deployment or traffic change
- Xcode Cloud archive, Build 6 processing, TestFlight device smoke, and App Review resubmission remain separate external gates
```

- [ ] **Step 7: Wait for the existing GitHub CI**

Run:

```bash
gh pr checks --watch
```

Expected: `LifeSnap Action CI` succeeds for the exact PR head SHA. Do not configure Xcode Cloud from a failing PR head.

### Task 7: Configure the first Xcode Cloud distribution workflow

**External state:**
- Xcode Cloud connection to `zll6796096/LifeSnap-Action`
- New workflow: `Build 6 App Store`
- No repository files unless Xcode explicitly creates a required shared configuration file

- [ ] **Step 1: Confirm the remote source before opening Xcode**

Run:

```bash
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/codex/lifesnap-build6-xcode-cloud)"
git status --short --branch
```

Expected: SHA equality test exits 0 and the worktree is clean.

- [ ] **Step 2: Open the tracked project in Xcode 27 beta only as the configuration client**

Open:

```text
/Users/zhanglonglong/Projects/apps/LifeSnap-Action/.worktrees/lifesnap-apple-native-ui/ios/LifeSnapAction.xcodeproj
```

Do not archive, export, or upload from the beta host. Confirm Signing & Capabilities displays Team `YMUG864233`, automatic signing, and bundle `com.zll.lifesnapaction`.

- [ ] **Step 3: Start Xcode Cloud setup from the Cloud report pane**

Use Report navigator -> Cloud -> Get Started or Set Up Distribution. Confirm the existing `LifeSnapAction` App Store Connect record; do not create a new app record or bundle identifier.

- [ ] **Step 4: Approve only the pre-authorized repository connection**

Connect exactly:

```text
zll6796096/LifeSnap-Action
```

If the authorization screen cannot restrict access to that repository, requests another repository or organization, creates a credential, or presents a new legal agreement, stop without accepting it and request user confirmation.

- [ ] **Step 5: Configure the workflow exactly**

Set:

```text
Name: Build 6 App Store
Start condition: Manual
Branch: codex/lifesnap-build6-xcode-cloud
Environment: Clean
Xcode: 26.6 (17F113), public release
Restrict editing: Enabled
Action: Archive
Platform: iOS
Scheme: LifeSnapAction
Deployment Preparation: TestFlight and App Store
External TestFlight groups: None
```

Do not choose `Latest Beta`, Xcode 27 beta, a beta macOS environment, an automatic push trigger, or an external tester group.

- [ ] **Step 6: Start one manual build**

Confirm the branch and exact head SHA immediately before clicking Start Build. Record only the workflow name, Xcode Cloud build number, branch, commit SHA, and start timestamp.

- [ ] **Step 7: Verify Xcode Cloud accepted the workflow state**

In App Store Connect -> LifeSnapAction -> Xcode Cloud, verify one workflow named `Build 6 App Store`, manual start condition, clean environment, archive action, and `TestFlight and App Store` deployment preparation.

### Task 8: Wait for and inspect the stable cloud archive

**Files:**
- Create: `docs/verification/yotei-snap-release/build6-xcode-cloud-artifact.txt`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Wait on state changes, not a fixed sleep**

Monitor the Xcode Cloud build until it reaches Succeeded, Failed, or Needs Attention. If it fails, read the complete failing step and return to systematic debugging; do not start a duplicate build before identifying the cause.

- [ ] **Step 2: Download and retain the build artifacts**

Download the exported app archive and logs from Xcode or App Store Connect into a private temporary directory created with:

```bash
release_workspace=$(mktemp -d /tmp/lifesnap-build6-cloud.XXXXXXXX)
chmod 700 "$release_workspace"
```

Do not commit the archive, IPA, provisioning profile, raw build log, account information, or signing certificate.

- [ ] **Step 3: Resolve the exact app path**

For an `.xcarchive` artifact:

```bash
APP_PATH="$release_workspace/LifeSnapAction.xcarchive/Products/Applications/LifeSnapAction.app"
```

For an `.ipa` artifact:

```bash
mkdir "$release_workspace/ipa"
ditto -x -k "$release_workspace/LifeSnapAction.ipa" "$release_workspace/ipa"
APP_PATH="$release_workspace/ipa/Payload/LifeSnapAction.app"
```

Require exactly one existing `LifeSnapAction.app` before continuing.

- [ ] **Step 4: Inspect identity and stable toolchain metadata**

Run:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :APIBaseURL' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :BuildMachineOSBuild' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :DTXcodeBuild' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :DTSDKBuild' "$APP_PATH/Info.plist"
```

Expected exact values:

```text
com.zll.lifesnapaction
1.1
6
https://lifesnap-action-sxielk4wua-an.a.run.app
25... stable macOS 26 build
17F113
23F81a
```

Any `BuildMachineOSBuild=26A5378n` or other beta marker is a hard failure before App Review submission.

- [ ] **Step 5: Inspect distribution signing and entitlements**

Run:

```bash
codesign --verify --deep --strict "$APP_PATH"
codesign -d --entitlements "$release_workspace/entitlements.plist" "$APP_PATH"
plutil -extract application-identifier raw "$release_workspace/entitlements.plist"
plutil -extract get-task-allow raw "$release_workspace/entitlements.plist"
plutil -extract com.apple.developer.devicecheck.appattest-environment raw "$release_workspace/entitlements.plist"
```

Expected: strict verification exits 0; application identifier ends in `com.zll.lifesnapaction`; `get-task-allow=false`; App Attest environment is `production`. Do not print or commit the provisioning profile.

- [ ] **Step 6: Write only sanitized artifact evidence**

Create `build6-xcode-cloud-artifact.txt` only after collecting the two runtime-dependent values. Set `source_commit` to the literal output of `git rev-parse HEAD`. Set `build_machine_os_build` to the literal `BuildMachineOSBuild` extracted from the downloaded app and require it to begin with `25`. The remaining keys and literal values must be:

```text
workflow=Build 6 App Store
branch=codex/lifesnap-build6-xcode-cloud
app_version=1.1
app_build=6
bundle_id=com.zll.lifesnapaction
api_base_url=https://lifesnap-action-sxielk4wua-an.a.run.app
dtxcode_build=17F113
dtsdk_build=23F81a
signature_verification=PASS
get_task_allow=false
app_attest_environment=production
```

Write `source_commit` after `branch` and `build_machine_os_build` after `api_base_url`, using the observed non-sensitive values. No placeholder or secret may remain before commit.

- [ ] **Step 7: Update the release gate to archive PASS only**

Mark `Xcode Cloud stable archive` PASS with exact source/toolchain evidence. Keep Build 6 processing, exact TestFlight device smoke, and App Review submission separate until observed.

### Task 9: Verify Build 6 processing and the exact TestFlight binary

**Files:**
- Create: `docs/verification/yotei-snap-security/build6-testflight-device-smoke.txt`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Verify App Store Connect processing**

In TestFlight, require Build 6 to show version 1.1, build 6, and a processed/ready state. If export compliance is requested, inspect the exact binary/source encryption usage and answer that it uses none of the listed custom or non-Apple-system algorithms only if the source and linked-binary check still support that answer.

- [ ] **Step 2: Perform a bounded Apple-mail check**

Search read-only Gmail from the Xcode Cloud upload timestamp for Apple/App Store Connect mail about LifeSnapAction Build 6. Stop if any `Action needed`, `ITMS-`, invalid binary, or unsupported toolchain message appears. Do not mark messages read, archive, label, delete, or follow links from email.

- [ ] **Step 3: Make Build 6 available to the existing internal tester only**

Use the existing internal TestFlight tester/account. Do not add external testers, public links, new email addresses, or new groups.

- [ ] **Step 4: Install the exact TestFlight Build 6 on the real iPhone**

Prefer TestFlight automatic update or iPhone Mirroring under Computer Use. If the device requires an authentication code, password, or a physical confirmation that Computer Use cannot perform, pause only at that boundary and ask the user to complete that single action; keep the rest of the test under Codex control.

- [ ] **Step 5: Confirm the installed identity**

Use the connected-device inventory or in-app/TestFlight build display to verify version 1.1 Build 6 before testing. Do not record the device identifier.

- [ ] **Step 6: Run the exact Build 6 smoke**

On Build 6:

1. Launch `よていスナップ`.
2. Select the existing synthetic non-personal test image.
3. Verify the per-upload consent screen appears before network processing.
4. Tap `同意して続ける`.
5. Verify one production `/api/v2/extract` request succeeds and the app reaches review, needs-review, or no-action according to the synthetic image.
6. Do not add the synthetic event to the user's Calendar.

The existing replay-rejection evidence remains source/backend evidence and must not be relabeled as exact cloud-binary evidence.

- [ ] **Step 7: Write sanitized Build 6 device evidence**

Use exactly:

```text
distribution=TestFlight
app_version=1.1
app_build=6
consent_before_upload=PASS
production_v2_extract=PASS
calendar_write_performed=false
personal_image_used=false
exact_cloud_binary=PASS
```

Do not include image content, extracted text, App Check tokens, installation identifiers, account data, or device identifiers.

- [ ] **Step 8: Update the release gate**

Mark Build 6 processing PASS only from TestFlight/App Store Connect evidence. Mark exact TestFlight device smoke PASS only from the real-device result. Keep App Review submission PENDING.

### Task 10: Bind Build 6 and resubmit version 1.1

**Files:**
- Modify: `docs/app-store/app-review-notes.md`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Recheck metadata before selecting the build**

Verify seven Japanese screenshots remain accepted, support/privacy URL remains:

```text
https://lifesnap-action-sxielk4wua-an.a.run.app/privacy
```

Verify manual release remains selected and no login, subscription, payment, pricing, territory, rating, or privacy-answer field changed.

- [ ] **Step 2: Select Build 6 for version 1.1**

Remove the invalid Build 5 association if App Store Connect still displays it, then select processed Build 6. Do not delete Build 5 from build history.

- [ ] **Step 3: Save the exact Build 6 reviewer note**

Paste the fenced reviewer-facing block from `docs/app-store/app-review-notes.md`. It must say Build 6, no account/login/payment, per-upload consent, transient image processing, Google Gemini third party, Calendar write behavior, Firebase App Check with Apple App Attest, and the stable privacy URL.

- [ ] **Step 4: Submit exactly one iOS 1.1 item**

Review the submission modal and require:

```text
Platform: iOS
Version: 1.1
Build: 6
Items: 1
Release mode: Manual
```

Then submit to App Review. Do not enable automatic release.

- [ ] **Step 5: Verify the resulting App Store Connect state**

Require the version page and submission page to display a fresh waiting-for-review state (`審査待ち` / `Waiting for Review`) for Build 6, with zero draft items. Record the observed timestamp and exact Japanese/English label.

- [ ] **Step 6: Recheck Apple mail after submission**

Search from the submission timestamp for Build 6 mail. A success notification or absence of an immediate toolchain error supports the waiting state; it does not prove review approval. If `ITMS-90111` or another blocking mail appears, update the release gate to BLOCKED and stop before creating another build.

### Task 11: Final evidence, Git review, PR integration choice, and trigger restoration

**Files:**
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`
- Modify: `docs/app-store/app-review-notes.md`
- Add: `docs/verification/yotei-snap-release/build6-xcode-cloud-artifact.txt`
- Add: `docs/verification/yotei-snap-security/build6-testflight-device-smoke.txt`

- [ ] **Step 1: Append the exact Build 6 external-state log**

Record:

- stable Xcode Cloud workflow/build and exact source SHA;
- stable build-machine/Xcode/SDK metadata;
- App Store Connect processing result;
- exact TestFlight Build 6 device-smoke result;
- submission timestamp and exact waiting label;
- bounded mail result;
- manual release, approval, propagation, and storefront states as still separate.

- [ ] **Step 2: Run the final complete verification**

Run:

```bash
npm test
npm run lint
npm run build
bash -n scripts/promote-verified-candidate.sh
bash -n scripts/validate-yotei-snap-release.sh
npm run validate:ios-release
git diff --check
```

Expected: all fresh checks pass with zero failures.

- [ ] **Step 3: Review and commit final evidence explicitly**

Run:

```bash
git add docs/release/yotei-snap-v1.1-app-store-release-gate.md \
  docs/app-store/app-review-notes.md \
  docs/verification/yotei-snap-release/build6-xcode-cloud-artifact.txt \
  docs/verification/yotei-snap-security/build6-testflight-device-smoke.txt
git diff --cached --check
git diff --cached
git commit -m "docs(release): record Build 6 App Review submission"
```

Expected: only sanitized final release evidence is committed.

- [ ] **Step 4: Push without force and wait for PR CI**

Run:

```bash
git push
gh pr checks --watch
```

Expected: remote branch and PR head match the final evidence commit; CI succeeds.

- [ ] **Step 5: Invoke the finishing-a-development-branch skill**

Present the required integration choices. Do not merge, delete, or clean the worktree before the user selects a supported option.

- [ ] **Step 6: Restore the Cloud Build trigger only after reviewed main integration**

After the branch is merged and `origin/main` is verified to contain the final release commits, run:

```bash
git fetch origin
test "$(git rev-parse origin/main)" = "$(gh pr view --json mergeCommit --jq '.mergeCommit.oid')"
PROJECT_ID=zhang23-23 \
TRIGGER_REGION=global \
TRIGGER_ID=33acc4f7-4ae1-478f-8ccf-78e9596e121b \
  ./scripts/manage-lifesnap-trigger.sh restore
```

Expected: exact reviewed-main equality test exits 0 and the lifecycle script prints `trigger_lifecycle=RESTORED`. If the PR is not merged, the trigger remains disabled and that state is reported rather than bypassed.

- [ ] **Step 7: Report the final separated states**

The report must distinguish:

- production backend revision/traffic;
- Build 6 toolchain/artifact acceptance;
- TestFlight exact-binary device acceptance;
- App Store Connect processing/submission state;
- Apple review approval state;
- manual release state;
- Japan storefront availability;
- branch, commit, push, PR/CI, merge, trigger, and worktree status.

Do not describe `Waiting for Review` as approval or storefront availability.
