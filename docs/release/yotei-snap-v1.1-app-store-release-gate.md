# よていスナップ 1.1 Build 4 App Store Release Gate

## Scope

- Apple-native UI redesign
- Apple-native page-turn AppIcon
- User-visible rename to よていスナップ
- App Store Japanese name and subtitle refresh
- App Check/App Attest integrity verification and per-installation quota protection
- Privacy disclosures for the unlinked installation identifier, HMAC quota records, and replay protection
- No bundle ID change

## Immutable Identity

| Field | Required value |
|---|---|
| Bundle ID | `com.zll.lifesnapaction` |
| Marketing version | `1.1` |
| Build | `4` |
| App Store name | `よていスナップ` |
| Japanese subtitle | `紙の案内を予定に変える` |
| Target / scheme | `LifeSnapAction` |

## Gate Status

| Gate | Status | Evidence |
|---|---|---|
| Release contract | PASS | `npm run validate:ios-release` exited 0; identity, App Attest production entitlement, Firebase 12.17.0 pin, v2 endpoint, Firebase plist identity, semantic launch screen, version/build, and the exact 17 opaque AppIcon descriptors passed |
| Privacy disclosures | LOCAL PASS | Runtime `/privacy` source and five App Store/release drafts disclose App Check/App Attest, the unlinked installation UUID/HMAC, quota retention, and no application persistence of document content |
| iOS tests | PASS | 12/12 passed, 0 failed, 0 skipped on `LifeSnap iPhone 15` (`56C4DC85-0732-49CF-8389-10D16B2BBDC3`), iOS 26.5 (23F77) |
| Simulator visual acceptance | PASS | Exact normally signed Release bundle verified on clean light and dark iPhone 15 simulators; five evidence paths are listed below |
| Backend regression | PASS | `npm test`: 9 files and 230/230 tests passed; `npm run lint` and `npm run build` exited 0 |
| Gemini Paid Plan | VERIFIED | AI Studio displayed `Paid 1`; the LifeSnap key in project `zhang23-23` displayed `Tier 1` / prepaid; masked identity comparison with Secret Manager passed |
| Prior production backend | PASS | Revision `lifesnap-action-00039-rwn` is the sole untagged `100%` target; this is retained historical evidence and is not Build 4 App Check acceptance |
| Build 4 App Check backend | PENDING | This local disclosure task did not deploy, invoke, tag, or promote a backend; candidate and production acceptance remain separate future gates |
| Signing identity | PENDING | Distribution identity not checked; local simulator ad-hoc signature verification is not App Store signing evidence |
| Archive | PENDING | Not run |
| Export validation | PENDING | Not run |
| Build 4 upload | PENDING | Not run |
| App Store metadata | PENDING | Not changed |
| App Review submission | PENDING | Not submitted |

## Observed Local Evidence

### Release contract

```bash
npm run validate:ios-release
```

Result: `PASS` (exit 0). The contract reported `All よていスナップ release-contract checks passed`, including the App Attest production entitlement, exact Firebase iOS SDK version `12.17.0`, `/api/v2/extract`, absence of a hard-coded App Check token, consistent Firebase bundle/project/app identifiers, and the exact 17 expected icon descriptors. The Firebase API key value was not printed.

### Current privacy disclosure contract

- App-generated random installation UUID: stored only in the device Keychain and sent to the backend in a request header.
- Server quota identity: the original UUID is not persisted; Firestore stores only an HMAC digest and counters. The identifier is unlinked and used for App Functionality and Fraud Prevention.
- Firestore quota retention: short-window counters expire logically after 24 hours; daily quota records expire within 30 days.
- Firebase replay protection: consumed App Check token handling may be retained by Firebase for up to 30 days, separately from Firestore quota records.
- Document processing: uploaded images, raw Gemini output, and extracted document content have no よていスナップ application persistence.
- App Check/App Attest: Apple and Firebase process the attestation/assertion objects required for app-integrity and replay checks.

### iOS tests

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-final-test-derived \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet
```

Result: `PASS` (exit 0), 12/12 tests passed, 0 failed, 0 skipped. Test device: `LifeSnap iPhone 15` (`56C4DC85-0732-49CF-8389-10D16B2BBDC3`), iOS 26.5 (23F77). The signing override applies only to tests.

### Normally signed simulator Release

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/yotei-snap-launch-adaptive-derived \
  build -quiet

codesign --verify --deep --strict --verbose=2 \
  /tmp/yotei-snap-launch-adaptive-derived/Build/Products/Release-iphonesimulator/LifeSnapAction.app
```

Result: `PASS` (both exited 0). `CODE_SIGNING_ALLOWED` was not overridden. The compiled app is `com.zll.lifesnapaction`, version `1.1`, build `4`, display name `よていスナップ`, and launch storyboard `LaunchScreen`. The simulator signature is ad-hoc, its 31-entry `Info.plist` is bound, resources are sealed, and `LaunchScreen.storyboardc` is present.

### Simulator visual acceptance

- Light: `YoteiSnap-AdaptiveLight-iPhone15-20260730223844` (`E1DA6F95-D286-4667-B8C1-2E45D2DBAC8C`), iPhone 15, iOS 26.5 (23F77).
- Dark: `YoteiSnap-AdaptiveDark-iPhone15-20260730223844` (`BC4A4E3F-BAA7-4574-A9B1-E6B5C12D48F5`), iPhone 15, iOS 26.5 (23F77).
- Home icon/name: `docs/verification/yotei-snap-release/home-screen-light.png`.
- Real light launch frame: `docs/verification/yotei-snap-release/launch-screen-light.png`.
- Light transition: `docs/verification/yotei-snap-release/launch-transition-light-contact-sheet.png`.
- Dark transition: `docs/verification/yotei-snap-release/launch-transition-dark-contact-sheet.png`.
- Sanitized transition provenance: `docs/verification/yotei-snap-release/launch-transition-evidence.txt`.

Result: `PASS`. Both recordings are unique clean first launches of the same normally signed Release bundle. Light black-mismatch frames: `0`; dark light-flash frames: `0`; SplashBoard denylist rejections: `0` for each simulator. Normal/default simulator signing is required for valid SplashBoard evidence; a `CODE_SIGNING_ALLOWED=NO` installed product is not accepted.

### Backend regression

```bash
npm test
npm run lint
npm run build
```

Result: `PASS`. Vitest passed 9 files and 230/230 tests. TypeScript lint/type-check and the esbuild production bundle both exited 0.

### Current Gemini Paid Plan and production backend

- Gemini Paid Plan state was freshly verified on 2026-07-31 JST: AI Studio displayed `Paid 1`; the LifeSnap key belongs to project `zhang23-23` and displayed `Tier 1` / prepaid; the masked AI Studio key identity matched Secret Manager `lifesnap-gemini-api-key:latest`.
- The Cloud Billing API was not enabled or called. No billing or payment setting was changed.
- The immutable release image was copied without rebuild or source deploy into revision `lifesnap-action-00039-rwn`: Cloud Build `14c3eff7-a07c-479b-81c5-453b0d5e7256`, source `8e1b6f5eb679c95a420c7307f5bedf4fe5a5a50d`, digest `sha256:8bb5f60e05db572fa9232c1bec894620567025ee61b1d19f44cd3fe3ce338a26`.
- At zero traffic, the tagged candidate passed exact digest, provenance, runtime service account, `NODE_ENV=production`, `MOCK_MODE=false`, and Secret Manager reference checks. `/health`, current `/privacy`, and synthetic `/api/extract` smoke checks passed; extraction returned HTTP 200, a schema-complete response, and `Cache-Control: no-store`.
- The exact candidate was promoted with a resource-version-conditional service replacement. The unchanged production URL passed the same strict smoke checks. Final traffic is one untagged `100%` target to `lifesnap-action-00039-rwn`; `lifesnap-action-00037-89l` is at `0%`; no candidate tag remains.
- No uploaded document contents, OCR text, raw Gemini output, credentials, key suffix, account identifier, or payment data were recorded.

## Remaining Apple Release Gates

- Distribution signing identity remains unverified.
- A matching Build 4 App Check backend candidate, real-device evidence, production promotion, and live privacy-page verification remain separate pending gates.
- Archive, export validation, Build 4 upload, App Store metadata save, and App Review submission have not been performed.
- App Review approval and storefront availability remain separate future states.
- The verified backend and Paid Plan state are not authorization for any remaining Apple action.

## External-State Rule

Archive, upload, metadata save, App Review submission, review approval, and storefront availability are separate states. Record only observed state and never promote one state into another.

## Evidence Log

Append timestamped, sanitized evidence here during execution. Do not include credentials, provisioning secrets, personal contact details, document contents, or raw App Store session data.

- `2026-07-30T23:12:35+0900` (`2026-07-30T14:12:35Z`) — Local Task 5 verification at source commit `6e7f930ed453cffe498726219347fd44dc7dfe7b`: release contract PASS; backend 29/29 PASS plus lint/build PASS; iOS 12/12 PASS; normally signed Release identity/signature PASS; clean adaptive light/dark simulator visual acceptance PASS. Distribution signing, archive, export, upload, App Store metadata, App Review submission, live privacy-copy verification, and Paid Service resolution were not performed.
- `2026-07-30T23:53:29+0900` (`2026-07-30T14:53:29Z`) — Cloud Run zero-traffic candidate deployed from clean local source commit `8e1b6f5eb679c95a420c7307f5bedf4fe5a5a50d`: regional Cloud Build `14c3eff7-a07c-479b-81c5-453b0d5e7256` succeeded and produced `lifesnap-action-00038-w7z` with image digest `sha256:8bb5f60e05db572fa9232c1bec894620567025ee61b1d19f44cd3fe3ce338a26`. Control-plane evidence reports `Ready=True`; the candidate is absent from the service traffic/tag map (`0%`, untagged), while `lifesnap-action-00037-89l` remains the sole `100%` target and `https://lifesnap-action-sxielk4wua-an.a.run.app` is unchanged. Runtime wiring remains `NODE_ENV=production`, `MOCK_MODE=false`, and Secret Manager reference `lifesnap-gemini-api-key:latest`. The candidate inherited the live template's stale `source-commit=54af5385680d7e835f81761955e44188d822ef87` label, so that label is not accepted as source provenance. No candidate endpoint or smoke route was invoked; candidate invocation, smoke, and promotion remain blocked until fresh Gemini Paid Plan verification, and no App Store action was taken.
- `2026-07-31T00:07:17+0900` (`2026-07-30T15:07:17Z`) — Task 5C quality-review evidence correction (append-only):
  - Cloud Build `14c3eff7-a07c-479b-81c5-453b0d5e7256` identifies the generation-pinned source archive as `gs://run-sources-zhang23-23-asia-northeast1/services/lifesnap-action/1785423145.90504-0cb0178307cd48968f7fd56d62be72dd.zip#1785423147902619`. A read-only review downloaded that exact generation (archive SHA-256 `3ed104a6137f87c7d16c5915dbdad71f723488be7895afdc0efdeeb72b9be3f8`) and compared each archive member with source commit `8e1b6f5eb679c95a420c7307f5bedf4fe5a5a50d`: all 108 uploaded regular files were present and byte-identical, with zero symlinks, missing paths, or byte mismatches. This finding covers only files present in the uploaded archive and makes no claim about files excluded by `.gcloudignore`.
  - The candidate inherited both stale labels `source-commit=54af5385680d7e835f81761955e44188d822ef87` and `release-build=acf54260-74d7-401f-b17a-d69a9c48a74e`; neither label is accepted as provenance for this candidate.
  - Candidate conditions are `Ready=True, reason=Retired`; `Active=False, reason=Retired`; and `ResourcesAvailable=Unknown, reason=Retired`. `ContainerReady=True` reports only that container image import completed; there is no `ContainerHealthy` condition. The service `latestReadyRevisionName` remains `lifesnap-action-00037-89l`. This proves control-plane revision creation and retirement only, not candidate startup health, serveability, or product acceptance.
  - No candidate URL or route was invoked during deployment or this review; zero candidate requests were issued by these tasks. Candidate invocation, smoke, and promotion remain blocked until fresh Gemini Paid Plan verification, and no App Store action was taken.
- `2026-07-31T00:23:41+0900` (`2026-07-30T15:23:41Z`) — Fresh Gemini Paid Plan and copy-only Cloud Run cutover evidence:
  - AI Studio displayed `Paid 1`; the LifeSnap key in project `zhang23-23` displayed `Tier 1` / prepaid; masked identity comparison with Secret Manager `lifesnap-gemini-api-key:latest` passed. The Cloud Billing API was not enabled or called, and no billing or payment setting was changed.
  - A resource-version-conditional service replacement created `lifesnap-action-00039-rwn` at zero traffic from the same immutable digest `sha256:8bb5f60e05db572fa9232c1bec894620567025ee61b1d19f44cd3fe3ce338a26`, Cloud Build `14c3eff7-a07c-479b-81c5-453b0d5e7256`, and source `8e1b6f5eb679c95a420c7307f5bedf4fe5a5a50d`. No rebuild or source deploy occurred.
  - Candidate runtime and strict smoke checks passed: exact non-stale provenance, preserved runtime service account/config/resources, `NODE_ENV=production`, `MOCK_MODE=false`, Secret Manager reference unchanged, `/health` HTTP 200 with status `ok`, current `/privacy` HTTP 200, and synthetic `/api/extract` HTTP 200 with a schema-complete response and `Cache-Control: no-store`. No response or document contents were recorded.
  - The exact candidate was conditionally promoted. The unchanged production URL passed the same strict smoke checks. Final control-plane state is one untagged `100%` target to `lifesnap-action-00039-rwn`, `lifesnap-action-00037-89l` at `0%`, latest ready revision `lifesnap-action-00039-rwn`, no traffic tags, and exact service/template/revision provenance. Rollback was not needed. No App Store action was taken.
- `2026-08-01T01:34:55+0900` (`2026-07-31T16:34:55Z`) — Corrected Local Task 11 provenance: the changes began from clean baseline `578a94f911a207b173ef7b7ec7e48dc80043d607`; that baseline was the starting point, not the object containing the Task 11 changes. Privacy disclosures and the initial release contract were implemented in `4fa177512fc4fedf9d851800bd25193c391414bb`; the strengthened runtime privacy test contract was added in `5cda94568a9df030841661739f573d9a8263e3af`. The reproducible, clean verification target was quality-fix commit `338a2b311c0747555610503acf559fd432dbdee4`: focused runtime privacy test 8/8 PASS; full backend test 9 files and 230/230 PASS; `bash -n`, TypeScript lint, and esbuild production bundle PASS; release validator PASS for App Attest production entitlement, Firebase iOS SDK 12.17.0, v2 extraction route, the sole App Check header assignment using a freshly obtained and validated token, Firebase plist identity, and redacted API-key presence; controlled `bash -x` verification confirmed the real Firebase API key appeared in neither trace nor validator stdout without printing either the key or trace. The subsequent provenance-only commit containing this correction changes only this release-gate evidence entry and does not alter runtime, tests, validator, privacy answers, or review notes. No cloud, App Store Connect, deployment, traffic, or real-network action was performed; Build 4 backend and live privacy acceptance remain pending.
