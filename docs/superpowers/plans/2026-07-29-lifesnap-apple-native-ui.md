# LifeSnap Apple-Native UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing seven-screen LifeSnap iOS flow in the approved document-first, Apple-native visual direction while preserving upload consent, extraction routing, calendar behavior, and non-persistence guarantees.

**Architecture:** Keep the existing coordinator-driven SwiftUI flow and service layer. Add one coordinator-owned, in-memory `reviewImage` reference for the document-first review screen, a small shared visual system built from semantic iOS colors and SF Symbols, and rewrite each view without gradients or AI-demo decoration. Verify behavioral changes with coordinator unit tests and verify visual changes with simulator captures compared against the selected reference.

**Tech Stack:** Swift 6, SwiftUI, UIKit image bridge, XCTest, Xcode 26.6, iOS 26.5 simulator.

---

## File Map

- Create `ios/LifeSnapAction/Views/DesignSystem.swift`: semantic colors, shared section treatment, primary/secondary action labels, and document thumbnail.
- Modify `ios/LifeSnapAction.xcodeproj/project.pbxproj`: add `DesignSystem.swift` to the Views group and app Sources phase.
- Modify `ios/LifeSnapAction/ViewModels/AppFlowCoordinator.swift`: transient review-image lifecycle and user-facing consent button copy.
- Modify `ios/LifeSnapAction/App/LifeSnapActionApp.swift`: pass the transient image into review screens and clear it on success.
- Modify `ios/LifeSnapAction/Views/CaptureView.swift`: Apple-native document capture home.
- Modify `ios/LifeSnapAction/Views/UploadConsentView.swift`: compact disclosure summary, expandable full disclosure, and fixed bottom consent action.
- Modify `ios/LifeSnapAction/Views/ProcessingView.swift`: native progress/error states and reduced-motion behavior.
- Modify `ios/LifeSnapAction/Views/ReviewView.swift`: approved document-first summary, native edit form, and fixed calendar action.
- Modify `ios/LifeSnapAction/Views/NeedsReviewView.swift`: field-level review warnings using the same form language.
- Modify `ios/LifeSnapAction/Views/NoActionView.swift`: neutral empty result.
- Modify `ios/LifeSnapAction/Views/SuccessView.swift`: compact system-success result.
- Modify `ios/LifeSnapActionTests/AppFlowCoordinatorTests.swift`: consent copy and transient-image lifecycle tests.
- Create `design-qa.md`: source-versus-simulator comparison record required for Product Design handoff.

### Task 1: Protect the Consent Copy and Transient Image Lifecycle

**Files:**
- Modify: `ios/LifeSnapActionTests/AppFlowCoordinatorTests.swift`
- Modify: `ios/LifeSnapAction/ViewModels/AppFlowCoordinator.swift`

- [ ] **Step 1: Change the consent-copy assertions to the approved human wording**

```swift
XCTAssertEqual(ConsentPurpose.firstUpload.primaryButtonTitle, "同意して続ける")
XCTAssertEqual(ConsentPurpose.retryUpload.primaryButtonTitle, "同意してもう一度試す")
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
xcodebuild -project ios/LifeSnapAction.xcodeproj -scheme LifeSnapAction \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/lifesnap-apple-ui-derived CODE_SIGNING_ALLOWED=NO \
  -only-testing:LifeSnapActionTests/AppFlowCoordinatorTests/testConsentCopyContainsRequiredDisclosureAndActions \
  test -quiet
```

Expected: FAIL because the production titles still contain `AI解析`.

- [ ] **Step 3: Implement the minimal consent-title change**

```swift
var primaryButtonTitle: String {
    switch self {
    case .firstUpload:
        return "同意して続ける"
    case .retryUpload:
        return "同意してもう一度試す"
    }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command again.

Expected: `** TEST SUCCEEDED **` with zero failures.

- [ ] **Step 5: Add lifecycle tests for calendar, no-action, success, and reset paths**

```swift
func testCalendarRouteMovesImageIntoTransientReviewState() async {
    let client = MockExtractionClient(result: .success(makeCalendarResponse()))
    let coordinator = makeCoordinator(client: client)

    coordinator.imageSelected(makeImage())
    await coordinator.startConsentedExtraction()

    XCTAssertNil(coordinator.captureVM.selectedImage)
    XCTAssertNotNil(coordinator.reviewImage)
    guard case .review = coordinator.currentScreen else {
        return XCTFail("Expected review screen")
    }
}

func testShowingSuccessClearsTransientReviewImage() async {
    let client = MockExtractionClient(result: .success(makeCalendarResponse()))
    let coordinator = makeCoordinator(client: client)

    coordinator.imageSelected(makeImage())
    await coordinator.startConsentedExtraction()
    guard case .review(let task) = coordinator.currentScreen else {
        return XCTFail("Expected review screen")
    }

    coordinator.showSuccess(for: task)

    XCTAssertNil(coordinator.reviewImage)
    guard case .success = coordinator.currentScreen else {
        return XCTFail("Expected success screen")
    }
}

func testResetClearsTransientReviewImage() async {
    let client = MockExtractionClient(result: .success(makeCalendarResponse()))
    let coordinator = makeCoordinator(client: client)

    coordinator.imageSelected(makeImage())
    await coordinator.startConsentedExtraction()
    coordinator.resetToCapture()

    XCTAssertNil(coordinator.reviewImage)
}
```

Add a complete calendar response fixture:

```swift
private func makeCalendarResponse() -> ExtractionResponse {
    ExtractionResponse(
        route: .calendarAction,
        documentType: "notice",
        taskType: "event",
        title: "エレベーター点検",
        dueDate: nil,
        startDatetime: "2026-10-25T14:00:00+09:00",
        endDatetime: "2026-10-25T16:00:00+09:00",
        amount: nil,
        issuer: "管理会社",
        location: nil,
        summary: "点検中はエレベーターを利用できません。",
        confidence: 0.91,
        riskFlags: [],
        evidence: nil,
        calendarEvent: CalendarEventData(
            title: "エレベーター点検",
            start: "2026-10-25T14:00:00+09:00",
            end: "2026-10-25T16:00:00+09:00",
            description: "点検中はエレベーターを利用できません。",
            location: nil
        )
    )
}
```

- [ ] **Step 6: Run the coordinator suite and verify RED**

Run:

```bash
xcodebuild -project ios/LifeSnapAction.xcodeproj -scheme LifeSnapAction \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/lifesnap-apple-ui-derived CODE_SIGNING_ALLOWED=NO \
  -only-testing:LifeSnapActionTests/AppFlowCoordinatorTests test -quiet
```

Expected: compilation fails because `reviewImage` and `showSuccess(for:)` do not exist.

- [ ] **Step 7: Implement the minimal in-memory lifecycle**

Add:

```swift
var reviewImage: UIImage?

func showSuccess(for task: CalendarTask) {
    reviewImage = nil
    currentScreen = .success(task)
}
```

Pass the submitted image into result handling and clear it by route:

```swift
private func handleExtractionResult(submittedImage: UIImage) {
    guard let extraction = extractionVM.extraction else { return }

    captureVM.clearPendingImage()

    switch extraction.route {
    case .calendarAction:
        reviewImage = submittedImage
        currentScreen = .review(CalendarTask(from: extraction))
    case .needsReview:
        reviewImage = submittedImage
        currentScreen = .needsReview(CalendarTask(from: extraction))
    case .noActionDetected:
        reviewImage = nil
        currentScreen = .noAction
    }
}
```

Also set `reviewImage = nil` in `imageSelected(_:)` and `resetToCapture()`.

- [ ] **Step 8: Run the coordinator suite and verify GREEN**

Run the Step 6 command again.

Expected: all coordinator tests pass with zero failures.

- [ ] **Step 9: Commit the behavioral slice**

```bash
git add ios/LifeSnapAction/ViewModels/AppFlowCoordinator.swift \
  ios/LifeSnapActionTests/AppFlowCoordinatorTests.swift
git commit -m "feat: retain review image only in memory"
```

### Task 2: Add the Shared Apple-Native Visual System

**Files:**
- Create: `ios/LifeSnapAction/Views/DesignSystem.swift`
- Modify: `ios/LifeSnapAction.xcodeproj/project.pbxproj`

- [ ] **Step 1: Add semantic colors and reusable presentation primitives**

The new file must define:

```swift
import SwiftUI

enum AppTheme {
    static let screen = Color(uiColor: .systemGroupedBackground)
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let separator = Color(uiColor: .separator)
    static let accent = Color.blue
}

struct PrimaryActionLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 52)
    }
}

struct DocumentThumbnail: View {
    let image: UIImage

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .frame(maxWidth: 132, maxHeight: 172)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.separator.opacity(0.5), lineWidth: 0.5)
            }
            .accessibilityLabel("読み取った書類")
    }
}

extension View {
    func appSectionStyle() -> some View {
        self
            .padding(16)
            .background(AppTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
```

- [ ] **Step 2: Add `DesignSystem.swift` to the Xcode project**

Add one PBX file reference, one build-file record, the Views group child, and the app Sources phase entry. Use unique 24-character identifiers and do not reorder unrelated project entries.

- [ ] **Step 3: Compile the app**

Run:

```bash
xcodebuild -project ios/LifeSnapAction.xcodeproj -scheme LifeSnapAction \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/lifesnap-apple-ui-derived CODE_SIGNING_ALLOWED=NO build -quiet
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit the visual foundation**

```bash
git add ios/LifeSnapAction/Views/DesignSystem.swift \
  ios/LifeSnapAction.xcodeproj/project.pbxproj
git commit -m "feat: add native iOS design system"
```

### Task 3: Rebuild Capture and Upload Consent

**Files:**
- Modify: `ios/LifeSnapAction/Views/CaptureView.swift`
- Modify: `ios/LifeSnapAction/Views/UploadConsentView.swift`

- [ ] **Step 1: Replace the capture-stage presentation**

Use `AppTheme.screen`, SF Symbol `doc.viewfinder`, a large semantic title, one solid-blue camera button, a secondary photo picker, and the existing privacy link. Keep `CameraView`, photo loading, and image callbacks unchanged.

The hierarchy must be:

```swift
ScrollView {
    VStack(alignment: .leading, spacing: 28) {
        Text("書類から予定を追加").font(.largeTitle.bold())
        Text("撮影または写真を選び、内容を確認してからカレンダーに追加します")
        Image(systemName: "doc.viewfinder")
        Button { viewModel.showCamera = true } label: {
            PrimaryActionLabel(title: "カメラで撮影", systemImage: "camera.fill")
        }
        PhotosPicker(selection: $selectedItem, matching: .images) {
            PrimaryActionLabel(title: "写真から選ぶ", systemImage: "photo.on.rectangle")
        }
        privacyDisclosure
    }
}
```

The primary button uses `.buttonStyle(.borderedProminent)` and the secondary uses `.buttonStyle(.bordered)`. Remove the custom hex-color extension after all callers have migrated to semantic colors.

- [ ] **Step 2: Rebuild upload consent with summary-first disclosure**

Set `ConsentCopy.title` to `画像の送信を確認`. Keep the existing full disclosure body unchanged. Add four concise disclosure rows:

```swift
DisclosureSummaryRow(icon: "doc.text.magnifyingglass", title: "目的", value: "予定・タスク情報の読み取り")
DisclosureSummaryRow(icon: "arrow.up.forward.app", title: "送信先", value: "LifeSnap と Google Gemini")
DisclosureSummaryRow(icon: "person.text.rectangle", title: "含まれる可能性", value: "氏名、住所、日付、金額など")
DisclosureSummaryRow(icon: "externaldrive.badge.xmark", title: "保存", value: "LifeSnap は画像や抽出内容を永続保存しません")
```

Wrap the complete legal body in a `DisclosureGroup("データの取り扱い詳細", isExpanded: $showsDetails)`. Keep the privacy link visible outside the disclosure group.

Use:

```swift
.safeAreaInset(edge: .bottom) {
    VStack(spacing: 8) {
        Button(action: onAgree) {
            PrimaryActionLabel(title: purpose.primaryButtonTitle, systemImage: "checkmark")
        }
        .buttonStyle(.borderedProminent)

        Button("キャンセル", action: onCancel)
            .frame(minHeight: 44)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 12)
    .background(.bar)
}
```

- [ ] **Step 3: Build and inspect both pages at 390×844**

Run the Task 2 build command. Boot the named simulator, install the built app, open it, and verify the capture page has one visual primary action. Exercise the photo path to confirm the consent button remains visible without scrolling.

- [ ] **Step 4: Commit capture and consent**

```bash
git add ios/LifeSnapAction/Views/CaptureView.swift \
  ios/LifeSnapAction/Views/UploadConsentView.swift
git commit -m "feat: simplify capture and consent screens"
```

### Task 4: Rebuild Processing, Empty, and Success States

**Files:**
- Modify: `ios/LifeSnapAction/Views/ProcessingView.swift`
- Modify: `ios/LifeSnapAction/Views/NoActionView.swift`
- Modify: `ios/LifeSnapAction/Views/SuccessView.swift`

- [ ] **Step 1: Replace processing decoration with native progress**

Use `@Environment(\.accessibilityReduceMotion)` and:

```swift
ProgressView()
    .controlSize(.large)
    .tint(.blue)
Text("予定を読み取っています").font(.title2.bold())
Text("日付・時間・場所を確認しています").foregroundStyle(.secondary)
```

Use `読み取りできませんでした` for errors, keep retry and cancel behavior, and remove the scanning ring and pulse animation.

- [ ] **Step 2: Replace the no-action screen**

Use `doc.questionmark`, title `予定は見つかりませんでした`, the approved explanation, and one `.borderedProminent` action titled `別の書類を選ぶ`. Remove entry animation.

- [ ] **Step 3: Replace the success screen**

Use one system-green `checkmark.circle.fill`, compact event summary rows, a solid-blue `カレンダーで確認` action, and a secondary `別の書類を追加` action. Keep `calshow:` behavior and remove the multi-ring bounce.

- [ ] **Step 4: Build the three states**

Run the Task 2 build command.

Expected: `** BUILD SUCCEEDED **` without Swift warnings from removed animation state.

- [ ] **Step 5: Commit status screens**

```bash
git add ios/LifeSnapAction/Views/ProcessingView.swift \
  ios/LifeSnapAction/Views/NoActionView.swift \
  ios/LifeSnapAction/Views/SuccessView.swift
git commit -m "feat: simplify status and result screens"
```

### Task 5: Implement the Approved Document-First Review

**Files:**
- Modify: `ios/LifeSnapAction/Views/ReviewView.swift`
- Modify: `ios/LifeSnapAction/Views/NeedsReviewView.swift`
- Modify: `ios/LifeSnapAction/App/LifeSnapActionApp.swift`

- [ ] **Step 1: Pass the transient source image to review screens**

Update signatures:

```swift
struct ReviewView: View {
    let sourceImage: UIImage?
    // existing task, calendarVM, and callbacks
}

struct NeedsReviewView: View {
    let sourceImage: UIImage?
    // existing task and callbacks
}
```

Pass `coordinator.reviewImage` from `ContentView`. Replace direct success-screen assignment with:

```swift
onConfirm: {
    coordinator.showSuccess(for: task)
}
```

- [ ] **Step 2: Rebuild the normal review page**

Match the selected reference in this order:

```swift
VStack(alignment: .leading, spacing: 20) {
    HStack(alignment: .firstTextBaseline) {
        Text("予定の確認").font(.largeTitle.bold())
        Spacer()
        Button(isEditing ? "完了" : "編集") { isEditing.toggle() }
    }

    if let sourceImage {
        VStack(alignment: .leading, spacing: 8) {
            Text("読み取った書類").font(.footnote).foregroundStyle(.secondary)
            DocumentThumbnail(image: sourceImage)
        }
    }

    if task.isPastDate {
        warningBanner(text: "この日時は過去です")
    }

    taskSummary
    contextSection
}
```

`taskSummary` contains grouped rows for `タイトル`, `日時`, `場所`, and `メモ`. Read-only rows use `.primary`/`.secondary`; edit rows use native `TextField`, `Toggle`, `DatePicker`, and a minimum-height `TextEditor`. Remove the confidence percentage completely.

Move the calendar action and `やり直す` into a bottom `safeAreaInset`. Keep the existing permission alert and confirmation dialog unchanged.

- [ ] **Step 3: Rebuild needs-review with the same form language**

Use the same title, optional thumbnail, field order, and semantic controls. Display localized risk messages beside the affected field or in a compact orange notice. Keep the date-edit requirement and disabled state, but label the enabled action `確認して追加画面へ`.

- [ ] **Step 4: Build and run the coordinator tests**

Run:

```bash
xcodebuild -project ios/LifeSnapAction.xcodeproj -scheme LifeSnapAction \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/lifesnap-apple-ui-derived CODE_SIGNING_ALLOWED=NO test -quiet
```

Expected: all tests pass.

- [ ] **Step 5: Commit the review flow**

```bash
git add ios/LifeSnapAction/App/LifeSnapActionApp.swift \
  ios/LifeSnapAction/Views/ReviewView.swift \
  ios/LifeSnapAction/Views/NeedsReviewView.swift
git commit -m "feat: add document-first calendar review"
```

### Task 6: Full Verification and Design QA

**Files:**
- Create: `design-qa.md`
- Modify only if a P0/P1/P2 visual issue is found: affected SwiftUI files

- [ ] **Step 1: Run the full iOS test suite**

```bash
xcodebuild -project ios/LifeSnapAction.xcodeproj -scheme LifeSnapAction \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/lifesnap-apple-ui-final-derived CODE_SIGNING_ALLOWED=NO \
  test -quiet
```

Expected: exit code 0 and zero failures.

- [ ] **Step 2: Run the backend regression checks because shared repository setup was touched**

```bash
npm test
npm run lint
npm run build
```

Expected: each command exits 0.

- [ ] **Step 3: Capture the complete simulator flow**

Use the already-approved sample document and local test state to capture:

- capture
- upload consent
- processing
- normal review
- review editing
- needs review
- no action
- success
- light and dark review/edit

Save captures beneath `docs/verification/lifesnap-apple-native-ui/`.

- [ ] **Step 4: Compare source and implementation in one visual**

Create a side-by-side comparison containing:

- Source: `docs/superpowers/specs/assets/lifesnap-apple-native-ui-option-2.png`
- Implementation: 390×844 normal review screenshot

Inspect hierarchy, padding, typography, thumbnail scale, grouped-row alignment, button placement, clipping, and semantic color use.

- [ ] **Step 5: Write the blocking Product Design QA record**

`design-qa.md` must list comparison evidence, viewport/state, prioritized findings, fixes, remaining P3 notes, and end with:

```text
final result: passed
```

If either image cannot be compared, write `final result: blocked` and stop the handoff.

- [ ] **Step 6: Run repository integrity checks**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: no whitespace errors, only intended verification artifacts pending, and branch `codex/lifesnap-apple-native-ui`.

- [ ] **Step 7: Commit verification evidence**

```bash
git add design-qa.md docs/verification/lifesnap-apple-native-ui
git commit -m "test: record Apple-native UI acceptance"
```
