# よていスナップ 1.1 Build 6 Resubmission Release Gate

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
| Required next build | `6` (stable Xcode Cloud archive and processing passed; submitted to App Review; exact TestFlight device smoke explicitly skipped without a PASS claim) |
| App Store name | `よていスナップ` |
| Japanese subtitle | `紙の案内を予定に変える` |
| Target / scheme | `LifeSnapAction` |

## Gate Status

| Gate | Status | Evidence |
|---|---|---|
| 2026-08-04 Build 5 release contract | PASS (historical) | During the Build 5 release operation, `npm run validate:ios-release` exited 0 against synchronized `CURRENT_PROJECT_VERSION=5` in `ios/project.yml` and the tracked `ios/LifeSnapAction.xcodeproj/project.pbxproj`, before Build 6 preparation; this is time-bound operation evidence, not a claim that the validator at the current documentation-only HEAD independently proves Build 5 |
| Privacy disclosures | LIVE PASS | Current Japanese `/privacy` page returned HTTP 200 with the expected localized title, language marker, and update marker at the stable production URL |
| Historical iOS tests | PASS | 12/12 passed, 0 failed, 0 skipped on `LifeSnap iPhone 15` (`56C4DC85-0732-49CF-8389-10D16B2BBDC3`), iOS 26.5 (23F77) |
| Historical simulator visual acceptance | PASS | Exact normally signed Release bundle verified on clean light and dark iPhone 15 simulators; five evidence paths are listed below |
| Historical backend regression | PASS | During the 2026-08-04 pre-Build 6 release operation, `npm test` passed 10 files and 309/309 tests; `npm run lint` and `npm run build` exited 0. The earlier 9-file/230-test baseline is recorded separately below |
| Gemini Paid Plan | VERIFIED | AI Studio displayed `Paid 1`; the LifeSnap key in project `zhang23-23` displayed `Tier 1` / prepaid; masked identity comparison with Secret Manager passed |
| Production backend | PASS | Revision `lifesnap-action-00041-n9n` is the sole untagged `100%` target at the stable URL; exact image digest, source, runtime service account, environment, secrets, labels, and structured-log allowlist passed |
| Build 5 physical App Attest | PASS (historical) | Public Xcode 26.6 Release on a real iPhone: `app_attest_provider=PASS`, `v2_extract=PASS`, `replay_rejected=PASS`; 1/1 test passed |
| Build 5 signing identity | PASS (historical) | Exported IPA is signed by Apple Distribution for team `YMUG864233`; strict deep signature validation passed and `get-task-allow=false` |
| Build 5 archive | PASS (historical) | Public Xcode 26.6 (`17F113`) archived version 1.1 Build 5 with the stable production API URL and production App Attest entitlement |
| Build 5 export validation | PASS (historical) | Exported IPA identity, public toolchain metadata, production URL, distribution signature, and production entitlement passed inspection |
| Build 4 upload | BLOCKED (historical) | Upload succeeded, but App Store Connect rejected review submission because it was compiled with Xcode 27 beta |
| Build 5 upload | BLOCKED (historical) | App Store Connect received and processed the binary, then Apple mail rejected it as `ITMS-90111`; the beta host build marker makes it invalid for App Review |
| Build 5 App Store metadata | PASS (historical) | Seven Japanese 1320 × 2868 RGB screenshots, current support/privacy URL, the Build 5 review note, manual release, existing ratings, and no-login state were saved for the invalidated submission attempt; Build 6 later reused the verified metadata with its Build 6-specific reviewer note |
| Build 6 local configuration | PASS | Build number, source/generated project, Team assignment, automatic signing, shared archive scheme, and release validator passed |
| Xcode Cloud stable archive | PASS | Workflow `Build 6 App Store` produced cloud Build 6 from exact source `755ecd1651ec5186e5b0baba8fcfad6916c0d92e`; both the archive and App Store IPA report version 1.1 Build 6, macOS build `25G72`, Xcode build `17F113`, SDK build `23F81a`, the stable production API URL, a valid strict distribution signature, `get-task-allow=false`, and production App Attest |
| Build 6 processing | PASS | App Store Connect TestFlight displays version 1.1 Build 6 as `提出準備完了`; bounded Gmail coverage from `2026-08-05T02:35:00+0900` returned the matching Xcode Cloud success mail and no `ITMS-`, invalid-binary, action-needed, or unsupported-toolchain mail |
| Exact Build 6 TestFlight device smoke | SKIPPED (user-directed) | The user explicitly chose direct App Review submission based on prior testing; the exact cloud-produced Build 6 was not smoke-tested on the real iPhone, and no Build 6 device-smoke PASS is claimed |
| Build 6 App Review submission | PASS | App Store Connect displays one submitted item, iOS 1.1 Build 6, with status `審査待ち` and submission time 2026-08-05 16:35 JST; the Build 6 reviewer note was saved, seven Japanese screenshots remain present, manual release remains selected, and a bounded post-submission Gmail search returned zero Apple messages and no pagination token |
| Build 6 App Review approval | PENDING | Build 6 has not been approved |
| Build 6 manual release | PENDING | No approved Build 6 version has been manually released |
| Build 6 storefront availability | PENDING | Build 6 availability has not been verified on the storefront |

## Observed Local Evidence

### Historical Build 5 release contract (2026-08-04 operation)

```bash
npm run validate:ios-release
```

Historical result: `PASS` (exit 0). During the 2026-08-04 Build 5 release operation, `ios/project.yml`, the tracked `ios/LifeSnapAction.xcodeproj/project.pbxproj`, and the release validator were temporarily synchronized to `CURRENT_PROJECT_VERSION=5` before Build 6 preparation. The contract reported `All よていスナップ release-contract checks passed`, including the App Attest production entitlement, exact Firebase iOS SDK version `12.17.0`, `/api/v2/extract`, absence of a hard-coded App Check token, consistent Firebase bundle/project/app identifiers, and the exact 17 expected icon descriptors. The Firebase API key value was not printed. This PASS records that observed temporary Build 5 state; the validator at the current documentation-only HEAD is not independently claimed to prove Build 5.

### Build 6 local configuration

```bash
npm run validate:ios-release
```

Result: `PASS` (exit 0) at local source configuration commit `0a80e6bb63f16b9bd64cd775f31f6fb1da53fa01` (not claimed as pushed). Build number `6`, the source and tracked generated project, Team assignment, automatic signing, the shared archive scheme, and the release validator passed. This is local configuration evidence only; it does not prove an Xcode Cloud archive, App Store Connect processing, installation of the exact cloud binary on the real iPhone, submission, approval, manual release, or storefront availability.

### Historical physical-device evidence scope

- `docs/verification/yotei-snap-security/device-app-attest-smoke.txt` records the earlier historical Gate D backend-candidate promotion binding. It does not record an app binary identity and is not an exact Build 6/TestFlight binary run.
- `docs/verification/yotei-snap-security/build5-device-app-attest-smoke.txt` records a separate, later historical Build 5 physical-device binary smoke. It is not an exact Build 6/TestFlight binary run.
- These files describe separate runs and do not assert a shared run identifier. Neither file proves installation or smoke of the exact cloud-produced Build 6 TestFlight binary. The user explicitly chose to skip that run and proceed directly to App Review, so the gate is `SKIPPED (user-directed)`, not `PASS`.

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

### Historical backend regression runs

```bash
npm test
npm run lint
npm run build
```

- Earlier baseline: `PASS`. Vitest passed 9 files and 230/230 tests. TypeScript lint/type-check and the esbuild production bundle both exited 0.
- 2026-08-04 pre-Build 6 release operation: `PASS`. Vitest passed 10 files and 309/309 tests. TypeScript lint/type-check and the esbuild production bundle both exited 0.

### Historical Gemini Paid Plan and prior production backend

The following 2026-07-31 evidence is retained for provenance only. It was superseded by the Build 5 finalization evidence above and must not be read as the current control-plane state.

- Gemini Paid Plan state was freshly verified on 2026-07-31 JST: AI Studio displayed `Paid 1`; the LifeSnap key belongs to project `zhang23-23` and displayed `Tier 1` / prepaid; the masked AI Studio key identity matched Secret Manager `lifesnap-gemini-api-key:latest`.
- The Cloud Billing API was not enabled or called. No billing or payment setting was changed.
- The immutable release image was copied without rebuild or source deploy into revision `lifesnap-action-00039-rwn`: Cloud Build `14c3eff7-a07c-479b-81c5-453b0d5e7256`, source `8e1b6f5eb679c95a420c7307f5bedf4fe5a5a50d`, digest `sha256:8bb5f60e05db572fa9232c1bec894620567025ee61b1d19f44cd3fe3ce338a26`.
- At zero traffic, the tagged candidate passed exact digest, provenance, runtime service account, `NODE_ENV=production`, `MOCK_MODE=false`, and Secret Manager reference checks. `/health`, current `/privacy`, and synthetic `/api/extract` smoke checks passed; extraction returned HTTP 200, a schema-complete response, and `Cache-Control: no-store`.
- The exact candidate was promoted with a resource-version-conditional service replacement. The unchanged production URL passed the same strict smoke checks. Final traffic is one untagged `100%` target to `lifesnap-action-00039-rwn`; `lifesnap-action-00037-89l` is at `0%`; no candidate tag remains.
- No uploaded document contents, OCR text, raw Gemini output, credentials, key suffix, account identifier, or payment data were recorded.

## Remaining Apple Release Gates

- Build 5 did not reach substantive App Review. The 18:04 `審査待ち` observation was transient and was superseded at 18:05:14 JST by Apple validation error `ITMS-90111`, which made the binary invalid.
- Build 6 local configuration passed at local commit `0a80e6bb63f16b9bd64cd775f31f6fb1da53fa01`; no pushed/public-source claim is made for that commit in this document.
- The approved stable Xcode Cloud workflow produced cloud Build 6 from exact source `755ecd1651ec5186e5b0baba8fcfad6916c0d92e`; the sanitized archive/IPA evidence is recorded in `docs/verification/yotei-snap-release/build6-xcode-cloud-artifact.txt`.
- Build 6 processing is `PASS` from TestFlight `提出準備完了` and bounded Apple-mail evidence. A private internal group named `Build 6 Internal` was created after explicit user confirmation with one current App Store Connect user and only version 1.1 Build 6; automatic distribution is disabled and no external group or public link exists. The exact-cloud-binary real-iPhone smoke was then explicitly skipped by the user and is not claimed as PASS.
- The Build 6 reviewer note was saved, invalid Build 5 was detached without deleting its history, and version 1.1 was submitted with exactly one iOS item for Build 6. App Store Connect displayed `審査待ち` at 2026-08-05 16:35 JST. App Review approval remains pending.
- Manual release is a later independent gate after approval; release, propagation, and storefront availability must each be verified separately.
- The verified production backend and historical Build 5 evidence do not authorize or prove any Build 6 Apple action.

## Build 5 Submission Attempt Evidence (Invalid Binary)

- App Store Connect rejected Build 4 at the add-to-review step solely because its binary was built with Xcode 27 beta; no claim was made that Build 4 entered review.
- The project build number and release validator were advanced to Build 5 because App Store Connect does not accept a second upload of version 1.1 Build 4.
- Public Xcode 26.6 (`17F113`, iOS SDK build `23F81a`) produced the Build 5 archive. The exported IPA reports `DTXcode=2660`, `DTXcodeBuild=17F113`, version `1.1`, build `5`, bundle `com.zll.lifesnapaction`, and the stable production API URL.
- The exported IPA is signed by Apple Distribution, has `get-task-allow=false`, and retains `com.apple.developer.devicecheck.appattest-environment=production`; `codesign --verify --deep --strict` passed.
- A real-iPhone Release test built by public Xcode 26.6 passed the production App Attest provider, v2 extraction, and replay-rejection path: 1 test, 0 failures.
- The public-Xcode archive was uploaded successfully. Xcode 27 beta provided only the authenticated upload transport; it did not compile or relink the Build 5 binary. Apple nevertheless rejected the resulting binary because its recorded beta host build marker was unsupported.
- App Store Connect already contains seven ordered Japanese 6.9-inch screenshots. All are 1320 × 2868 RGB PNGs without alpha, and the re-encoding preserved identical RGB pixels.
- Build 5 export compliance was answered as implementing none of the listed custom or non-Apple-system encryption algorithms, consistent with the inspected source and linked binary. App Store Connect then showed the build as submission-ready.
- At 2026-08-04 18:04 JST, App Store Connect initially displayed `提出物がApp Reviewに送信されました`, version/submission status `審査待ち`, one submitted item, and zero draft items for version 1.1 Build 5. This was a transient initial observation, not substantive App Review acceptance.
- At 2026-08-04 18:05:14 JST, Apple mail invalidated Build 5 with `ITMS-90111: Unsupported SDK or Xcode version`. The recorded `macOS 27.0 beta` host build `26A5378n` requires a new binary produced and uploaded with a currently supported non-beta toolchain.

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
- `2026-08-04T18:04:00+0900` (`2026-08-04T09:04:00Z`) — Final production/App Store execution: exact candidate `lifesnap-action-00041-n9n` passed real-iPhone App Attest/v2/replay evidence and was promoted to the sole untagged 100% production target; final stable URL health, Japanese privacy page, negative App Check cases, one legacy extraction, control-plane binding, and structured-log allowlist passed. Build 4 was uploaded but rejected from review because Xcode 27 beta compiled it. Version 1.1 Build 5 was then produced by public Xcode 26.6 (`17F113`), reverified on the real iPhone, distribution-exported with production App Attest and `get-task-allow=false`, uploaded, processed, export-compliance-cleared, bound to version 1.1, and submitted with seven RGB screenshots and the current reviewer note. App Store Connect displayed submission success and `審査待ち`; manual release remains selected, so approval, manual release, and storefront availability are not yet proven.
- `2026-08-04T18:05:14+0900` (`2026-08-04T09:05:14Z`) — Apple mail invalidated version 1.1 Build 5 with `ITMS-90111: Unsupported SDK or Xcode version`. App Store Connect had received and processed the upload, but the binary recorded beta host `macOS 27.0 beta` build `26A5378n`; the earlier 18:04 `審査待ち` observation was transient and did not establish substantive App Review acceptance. Build 6 from a currently supported non-beta toolchain is required. Manual release remains a later independent gate.
- `2026-08-05T02:46:31+0900` (`2026-08-04T17:46:31Z`) — Stable Xcode Cloud Build 6 evidence: workflow `Build 6 App Store`, manual branch `codex/lifesnap-build6-xcode-cloud`, exact source `755ecd1651ec5186e5b0baba8fcfad6916c0d92e`, Xcode `26.6 (17F113)`, macOS `26.6 (25G72)`, and iOS SDK build `23F81a`. The downloaded archive and App Store IPA both report `com.zll.lifesnapaction` version 1.1 Build 6 and the unchanged production API URL; strict code-sign verification passed, the application identifier suffix is exact, `get-task-allow=false`, and the signed App Attest entitlement is `production`. App Store Connect automatically received the build, export compliance was truthfully cleared from inspected source/binary evidence, and TestFlight displays `提出準備完了`. A bounded read-only Gmail check from the upload window found the matching Xcode Cloud success notification and no blocking `ITMS-`, invalid-binary, action-needed, or unsupported-toolchain mail. The exact TestFlight device smoke is still pending because there are zero existing testers and no new tester, email address, or group was created. App Review submission, approval, manual release, and storefront availability remain pending separate gates.
- `2026-08-05T16:35:00+0900` (`2026-08-05T07:35:00Z`) — Direct Build 6 App Review submission after explicit user direction: App Store Connect private internal group `Build 6 Internal` contains one current internal tester and only version 1.1 Build 6; automatic distribution is disabled, and no external tester group or public link exists. The exact Build 6 real-iPhone smoke was explicitly skipped and is not recorded as PASS. The invalid Build 5 association was removed without deleting Build 5 history, Build 6 was bound to version 1.1, the exact Build 6 reviewer note was saved, seven Japanese screenshots and the stable support/privacy URL remained present, and manual release remained selected. App Store Connect displayed exactly one submitted iOS 1.1 Build 6 item with status `審査待ち` and submission time 2026-08-05 16:35 JST. A bounded read-only Gmail search after the submission timestamp returned zero Apple messages with `next_page_token=null`; this is evidence of no immediate mail result, not approval. App Review approval, manual release, propagation, and storefront availability remain pending separate gates.
