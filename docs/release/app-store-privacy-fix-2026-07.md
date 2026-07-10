# App Store Privacy Fix Evidence - 2026-07

## Scope

This evidence file supports GitHub Issue #2: explicit AI upload consent, privacy alignment, Gemini Paid Service verification, backend log minimization, Build 3, Cloud Run deployment, and App Review resubmission readiness.

No API key value, image bytes, base64 payloads, raw Gemini response, OCR text, names, addresses, amounts, or document summaries are recorded here.

## First-Principles Gate

- Real objective: make LifeSnap's AI image upload behavior reviewable, consent-based, privacy-consistent, and verifiably safe for App Store Review.
- Relevant rule: risk control and acceptance evidence before release speed.
- Minimal verifiable deliverable: tests, privacy evidence, production deployment smoke tests, archive result, PR, and CI status.
- Out of scope: unrelated product features, account system, cloud document archive, analytics/tracking, and App Store final UI submission without credentials.

## Gemini Paid Service Verification

Verified at UTC: 2026-07-10T01:06:23Z

| Item | Evidence |
|---|---|
| Cloud Run service | `lifesnap-action` |
| Cloud Run region | `asia-northeast1` |
| Cloud Run project | `zhang23-23` / `788259830737` |
| Live URL at verification | `https://lifesnap-action-sxielk4wua-an.a.run.app` |
| Ready revision at verification | `lifesnap-action-00029-yed` |
| Production key source | Secret Manager `lifesnap-gemini-api-key:latest` |
| Gemini key project | `zhang23-23` / `788259830737` |
| API key display name | `lifesnap-gemini-production-20260704-rotated` |
| API key resource | `projects/788259830737/locations/global/keys/6140dbe6-e7bf-411c-817b-976629f53311` |
| Billing enabled | `true` |
| Billing account | masked as `***0DF9` |
| Billing account open | `true` |
| Generative Language API | `generativelanguage.googleapis.com` enabled |
| API key restriction | `apiTargets.service=generativelanguage.googleapis.com` |
| Paid Service gate | `PASS` |

Commands used, with secret values kept out of stdout and docs:

```bash
gcloud run services describe lifesnap-action --region asia-northeast1 --format=json
gcloud secrets versions access "$SECRET_VERSION" --secret="$SECRET_NAME" --project="$RUN_PROJECT_ID"
gcloud services api-keys lookup "$GEMINI_API_KEY" --format='value(name)'
unset GEMINI_API_KEY
gcloud projects describe "$KEY_PROJECT_NUMBER" --format='value(projectId)'
gcloud billing projects describe "$KEY_PROJECT_ID" --format=json
gcloud billing accounts describe "$BILLING_ACCOUNT_NAME" --format='value(open)'
gcloud services list --enabled --project="$KEY_PROJECT_ID" --filter='config.name:generativelanguage.googleapis.com'
gcloud services api-keys describe "$KEY_ID" --project="$KEY_PROJECT_ID" --location=global --format=json
```

## Implementation Evidence

## iOS Consent Gate

| Requirement | Status | Evidence |
|---|---|---|
| No upload before consent | PASS | `AppFlowCoordinatorTests.testSelectingImageDoesNotCallAPIBeforeConsent` |
| Cancel clears image and makes 0 API calls | PASS | `AppFlowCoordinatorTests.testCancelConsentClearsPendingImageAndDoesNotCallAPI` |
| Agree calls API once | PASS | `AppFlowCoordinatorTests.testAgreeCallsAPIExactlyOnceAndClearsPendingImageOnSuccess` |
| Retry requires renewed consent | PASS | `AppFlowCoordinatorTests.testRetryRequiresConsentBeforeUploadingAgain` |
| Privacy URL centralized | PASS | `APIClient.privacyPolicyURL` test |
| Consent text covers Gemini/data/purpose/refusal | PASS | `AppFlowCoordinatorTests.testConsentCopyContainsRequiredDisclosureAndActions` |

UI implementation:

- `ios/LifeSnapAction/ViewModels/AppFlowCoordinator.swift`
- `ios/LifeSnapAction/Views/UploadConsentView.swift`
- `ios/LifeSnapAction/Services/APIClient.swift`

## Backend Privacy Gate

| Requirement | Status | Evidence |
|---|---|---|
| Multipart-only upload | PASS | Legacy encoded-image request fallback removed from `server.ts`; static audit PASS |
| Memory-only multer | PASS | `multer.memoryStorage()` |
| No-store extract responses | PASS | backend test and live smoke `Cache-Control: no-store` |
| Production error response no internal details | PASS | backend test `does not expose internal Gemini errors in production responses` |
| Raw Gemini/image/OCR/content logs removed | PASS | structured logs only: request_id, mime, bytes, latency, model, status, route |
| `/privacy` required disclosures | PASS | backend test plus live `/privacy` smoke |
| Historical response artifacts removed | PASS | `test-results/backend/*.json` deleted |

## Verification Commands

Backend:

```bash
npm ci
npm test
npm run lint
npm run build
PORT=18080 NODE_ENV=production MOCK_MODE=false GEMINI_API_KEY=dummy node dist/server.cjs
```

iOS:

```text
XcodeBuildMCP test_sim on LifeSnap iPhone 15: 6 tests passed
XcodeBuildMCP test_sim on iPad Pro 13-inch (M5): 6 tests passed
XcodeBuildMCP build_run_sim on LifeSnap iPhone 15: succeeded
XcodeBuildMCP build_run_sim on iPad Pro 13-inch (M5): succeeded
```

Static privacy audit:

```bash
# Checked for removed raw Gemini-response logging, internal error detail leaks,
# legacy encoded-image request fallback code, leftover response artifacts, and
# literal API key strings.
```

All checks above passed on 2026-07-10.

## Cloud Run Deployment

| Item | Evidence |
|---|---|
| New revision | `lifesnap-action-00030-h5m` |
| Image digest | `sha256:202190a8660bc4cc617ef8ea6293e0611f26ae609cda08f7511f5e261c822a70` |
| Live traffic | 100% to `lifesnap-action-00030-h5m` |
| Candidate tag | `candidate` points to `lifesnap-action-00030-h5m` |
| Live URL | `https://lifesnap-action-sxielk4wua-an.a.run.app` |
| Alternate URL checked | `https://lifesnap-action-788259830737.asia-northeast1.run.app` |
| `/health` | 200 |
| `/privacy` | 200 and contains Paid Service disclosure |
| `/api/extract` | 200 using 1x1 synthetic PNG |
| `/api/extract` cache header | `Cache-Control: no-store` |
| Synthetic route | `no_action_detected` |
| New revision logs | Only structured metadata; no image/model/document content |

Live smoke command used a generated 1x1 PNG, not a personal document image.

## Build 3 Archive and Upload

| Item | Evidence |
|---|---|
| Marketing version | `1.0` |
| Build number | `3` |
| Source of version | `ios/project.yml` -> generated Xcode project -> `Info.plist` build setting expansion |
| Archive path | `/tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/LifeSnapAction.xcarchive` |
| Archive result | `ARCHIVE SUCCEEDED` |
| Archive bundle/version/build | `com.zll.lifesnapaction`, `1.0`, `3` |
| Export path | `/tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/export/LifeSnapAction.ipa` |
| Export result | `EXPORT SUCCEEDED` |
| Export signing | `Apple Distribution: LONGLONG ZHANG (YMUG864233)` |
| Export profile | `iOS Team Store Provisioning Profile: com.zll.lifesnapaction` |
| Entitlement | `get-task-allow=false` |
| UIDeviceFamily | `[1]` |
| Upload result | `Uploaded LifeSnapAction`; uploaded package is processing |

Upload command path:

```bash
xcodebuild -exportArchive \
  -archivePath /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/LifeSnapAction.xcarchive \
  -exportPath /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/upload-export \
  -exportOptionsPlist /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/uploadOptions.plist \
  -allowProvisioningUpdates
```

`altool` direct upload was attempted first and failed because CLI JWT or username/app-password authentication was not configured. The Xcode managed upload path succeeded.

## Remaining Human Action

Codex uploaded Build `3`, but did not perform the final App Store Connect Submit for Review UI action. App Store Connect may still require Build `3` processing completion and export compliance answers before final submission.
