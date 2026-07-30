# よていスナップ 1.1 Build 4 App Store Release Gate

## Scope

- Apple-native UI redesign
- Apple-native page-turn AppIcon
- User-visible rename to よていスナップ
- App Store Japanese name and subtitle refresh
- No bundle ID, backend, data-flow, or privacy-behavior change

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
| Release contract | PASS | `npm run validate:ios-release` exited 0; identity, semantic launch screen, version/build, and the exact 17 opaque AppIcon descriptors passed |
| iOS tests | PASS | 12/12 passed, 0 failed, 0 skipped on `LifeSnap iPhone 15` (`56C4DC85-0732-49CF-8389-10D16B2BBDC3`), iOS 26.5 (23F77) |
| Simulator visual acceptance | PASS | Exact normally signed Release bundle verified on clean light and dark iPhone 15 simulators; five evidence paths are listed below |
| Backend regression | PASS | `npm test`: 3 files and 29/29 tests passed; `npm run lint` and `npm run build` exited 0 |
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

Result: `PASS` (exit 0). The contract reported `All よていスナップ release-contract checks passed`, including the exact 17 expected icon descriptors.

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

Result: `PASS`. Vitest passed 3 files and 29/29 tests. TypeScript lint/type-check and the esbuild production bundle both exited 0.

## Remaining Task 5B Blockers

- The live external privacy-copy state has not been re-verified or changed in this task.
- The current App Store Paid Service state remains unresolved.
- These external blockers do not invalidate the observed local Task 5 evidence and are not authorization for archive, upload, metadata mutation, or App Review submission.

## External-State Rule

Archive, upload, metadata save, App Review submission, review approval, and storefront availability are separate states. Record only observed state and never promote one state into another.

## Evidence Log

Append timestamped, sanitized evidence here during execution. Do not include credentials, provisioning secrets, personal contact details, document contents, or raw App Store session data.

- `2026-07-30T23:12:35+0900` (`2026-07-30T14:12:35Z`) — Local Task 5 verification at source commit `6e7f930ed453cffe498726219347fd44dc7dfe7b`: release contract PASS; backend 29/29 PASS plus lint/build PASS; iOS 12/12 PASS; normally signed Release identity/signature PASS; clean adaptive light/dark simulator visual acceptance PASS. Distribution signing, archive, export, upload, App Store metadata, App Review submission, live privacy-copy verification, and Paid Service resolution were not performed.
