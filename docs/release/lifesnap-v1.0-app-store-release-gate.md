# LifeSnap Action v1.0 App Store Release Gate

Date: 2026-07-10

## Scope

This gate covers the App Store rejection fix for explicit AI upload consent, privacy alignment, Gemini Paid Service verification, backend log minimization, Build 3 archive/upload, and Cloud Run production deployment.

Out of scope: account system, Google login, dashboard, document archive, history center, cloud sync, payment/subscription, Android, AI provider migration, and final App Store Connect Submit for Review UI action.

## Decision

Backend/privacy gate: **PASS**.

iOS consent gate: **PASS**.

Cloud Run deployment gate: **PASS**.

Archive/upload gate: **UPLOADED**.

App Review final submission gate: **FINAL_UI_ACTION_REQUIRED**.

## Required Evidence Summary

| Gate | Result | Evidence |
|---|---|---|
| Gemini Paid Service | PASS | Production key maps to `zhang23-23`; billing enabled true; billing account open; Generative Language API enabled; API key restricted to `generativelanguage.googleapis.com` |
| Explicit per-upload consent | PASS | XCTest covers no API before consent, cancel 0 calls, agree 1 call, retry requires consent |
| Backend content-safe logging | PASS | Structured logs only include request_id, mime, bytes, latency, model, status, route |
| Production errors hide internals | PASS | Backend tests verify Gemini error response has stable code/message and no details |
| `/privacy` alignment | PASS | Local tests and live smoke verify Paid Service and limited-log disclosure |
| Static privacy audit | PASS | No raw Gemini response logging, no legacy encoded-image request fallback, no tracked response artifacts, no API key literals |
| Cloud Run deploy | PASS | `lifesnap-action-00030-h5m` serves 100% traffic |
| Live smoke | PASS | `/health` 200, `/privacy` 200, `/api/extract` 200 with 1x1 synthetic PNG, no-store header |
| Marketing version | PASS | `1.0` |
| Build number | PASS | `3` |
| Release archive | PASS | Archive succeeded at `/tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/LifeSnapAction.xcarchive` |
| App Store export | PASS | IPA signed with Apple Distribution, Store provisioning profile, `get-task-allow=false` |
| App Store upload | UPLOADED | Xcode upload log: `Uploaded LifeSnapAction`; uploaded package is processing |
| Final App Review submit | FINAL_UI_ACTION_REQUIRED | Codex did not click final Submit for Review; Build 3 processing/export compliance may require ASC UI confirmation |

## Commands Run

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
XcodeBuildMCP test_sim: LifeSnap iPhone 15, 6 passed
XcodeBuildMCP test_sim: iPad Pro 13-inch (M5), 6 passed
XcodeBuildMCP build_run_sim: LifeSnap iPhone 15, succeeded
XcodeBuildMCP build_run_sim: iPad Pro 13-inch (M5), succeeded
```

Cloud Run:

```bash
gcloud run deploy lifesnap-action \
  --project zhang23-23 \
  --region asia-northeast1 \
  --source . \
  --set-secrets GEMINI_API_KEY=lifesnap-gemini-api-key:latest \
  --set-env-vars NODE_ENV=production,MOCK_MODE=false \
  --allow-unauthenticated \
  --quiet

gcloud run services update-traffic lifesnap-action \
  --project zhang23-23 \
  --region asia-northeast1 \
  --to-revisions lifesnap-action-00030-h5m=100 \
  --quiet

gcloud run services update-traffic lifesnap-action \
  --project zhang23-23 \
  --region asia-northeast1 \
  --update-tags candidate=lifesnap-action-00030-h5m \
  --quiet
```

Archive/export/upload:

```bash
xcodebuild -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/LifeSnapAction.xcarchive \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=YMUG864233 \
  CODE_SIGN_STYLE=Automatic \
  archive

xcodebuild -exportArchive \
  -archivePath /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/LifeSnapAction.xcarchive \
  -exportPath /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/export \
  -exportOptionsPlist ios/exportOptions.plist \
  -allowProvisioningUpdates

xcodebuild -exportArchive \
  -archivePath /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/LifeSnapAction.xcarchive \
  -exportPath /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/upload-export \
  -exportOptionsPlist /tmp/lifesnap-appstore-privacy-fix-20260710-vm61Le/uploadOptions.plist \
  -allowProvisioningUpdates
```

## Live Production State

| Item | Value |
|---|---|
| Service | `lifesnap-action` |
| Region | `asia-northeast1` |
| Project | `zhang23-23` |
| Live revision | `lifesnap-action-00030-h5m` |
| Traffic | 100% |
| Candidate tag | `lifesnap-action-00030-h5m` |
| Live URL | `https://lifesnap-action-sxielk4wua-an.a.run.app` |
| Alternate URL | `https://lifesnap-action-788259830737.asia-northeast1.run.app` |

## App Store Connect Next Step

Build `3` has been uploaded and is processing. A human must confirm the build is processed, answer export compliance if prompted, select Build `3`, paste the review notes from `docs/release/app-review-resubmission-checklist.md`, and click Submit for Review.
