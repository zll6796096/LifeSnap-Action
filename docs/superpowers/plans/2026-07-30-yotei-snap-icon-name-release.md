# Yotei Snap Icon, Name, and App Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current AI-styled AppIcon with the approved Apple-native page-turn icon, rename the user-visible product to `よていスナップ`, and submit version 1.1 Build 4 through the existing App Store Connect app record.

**Architecture:** Keep all internal identifiers (`LifeSnapAction`, bundle ID, target, scheme, backend contract) stable while changing only user-visible brand surfaces, AppIcon raster assets, version metadata, and App Store listing metadata. A deterministic shell contract validates the icon set, brand strings, and version agreement before any signed archive or external App Store mutation. Release stages remain separate: local verification, signed archive, upload, metadata save, and App Review submission.

**Tech Stack:** Swift 5.9, SwiftUI, Xcode/iOS asset catalogs, Bash 3.2-compatible shell, `sips`, `ffmpeg`, XCTest, Node/Vitest, App Store Connect, Product Design ImageGen and design QA.

---

## File map

### New files

- `scripts/validate-yotei-snap-release.sh` — deterministic local contract for brand, version, AppIcon inventory, dimensions, and alpha.
- `docs/superpowers/specs/assets/yotei-snap-app-icon-master-source.png` — selected final generated master before deterministic resizing.
- `docs/verification/yotei-snap-release/icon-reference-vs-final.png` — normalized design comparison.
- `docs/verification/yotei-snap-release/home-screen-light.png` — installed icon and display-name evidence.
- `docs/verification/yotei-snap-release/launch-screen-light.png` — representative neutral launch-transition evidence.
- `docs/release/yotei-snap-v1.1-app-store-release-gate.md` — source-of-truth release evidence and external-state boundary.

### Modified product files

- `package.json` — expose the deterministic iOS release contract as `npm run validate:ios-release`.
- `ios/LifeSnapActionTests/AppFlowCoordinatorTests.swift` — assert the new visible brand while retaining required consent disclosures.
- `ios/LifeSnapAction/Info.plist` — Japanese development region and `CFBundleDisplayName`.
- `ios/LifeSnapAction/Resources/LaunchScreen.storyboard` — neutral Apple HIG-aligned launch surface that matches the first screen.
- `ios/LifeSnapAction/Services/CalendarService.swift` — testable Japanese calendar-note signature.
- `ios/LifeSnapAction/Views/UploadConsentView.swift` — new brand name without weakening Google/Gemini/privacy copy.
- `ios/project.yml` — version 1.1 Build 4 source setting.
- `ios/LifeSnapAction.xcodeproj/project.pbxproj` — checked-in generated project version agreement.
- `ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset/*.png` — 17 deterministic icon sizes.

### Modified App Store and QA files

- `docs/app-store/app-description-ja.md`
- `docs/app-store/app-description-en.md`
- `docs/app-store/app-review-notes.md`
- `docs/app-store/screenshot-plan.md`
- `design-qa.md`

### Explicitly unchanged

- Bundle ID `com.zll.lifesnapaction`
- Xcode project, target, scheme, executable, and Swift type names
- Backend URL, Gemini behavior, privacy behavior, calendar permission scope
- Historical v1.0 / Build 3 evidence files

---

### Task 1: Add a deterministic release contract

**Files:**
- Create: `scripts/validate-yotei-snap-release.sh`
- Modify: `package.json`

- [ ] **Step 1: Create the failing validation script**

Create `scripts/validate-yotei-snap-release.sh` with this complete content:

```bash
#!/usr/bin/env bash
set -u

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
project_root="$(cd "$script_dir/.." && pwd -P)"
plist_path="$project_root/ios/LifeSnapAction/Info.plist"
storyboard_path="$project_root/ios/LifeSnapAction/Resources/LaunchScreen.storyboard"
calendar_path="$project_root/ios/LifeSnapAction/Services/CalendarService.swift"
consent_path="$project_root/ios/LifeSnapAction/Views/UploadConsentView.swift"
project_yml="$project_root/ios/project.yml"
pbxproj_path="$project_root/ios/LifeSnapAction.xcodeproj/project.pbxproj"
icon_dir="$project_root/ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset"
failure_count=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failure_count=$((failure_count + 1))
}

pass() {
  printf 'PASS: %s\n' "$1"
}

assert_equal() {
  actual_value="$1"
  expected_value="$2"
  label="$3"
  if [ "$actual_value" = "$expected_value" ]; then
    pass "$label"
  else
    fail "$label expected '$expected_value' but found '$actual_value'"
  fi
}

assert_contains() {
  file_path="$1"
  literal_text="$2"
  label="$3"
  if grep -Fq "$literal_text" "$file_path"; then
    pass "$label"
  else
    fail "$label missing '$literal_text'"
  fi
}

assert_not_contains() {
  file_path="$1"
  literal_text="$2"
  label="$3"
  if grep -Fq "$literal_text" "$file_path"; then
    fail "$label still contains '$literal_text'"
  else
    pass "$label"
  fi
}

assert_xpath_count() {
  file_path="$1"
  xpath_expression="$2"
  expected_count="$3"
  label="$4"
  actual_count="$(xmllint --xpath "count($xpath_expression)" "$file_path" 2>/dev/null || true)"
  assert_equal "$actual_count" "$expected_count" "$label"
}

if ! plutil -lint "$plist_path" >/dev/null; then
  fail "Info.plist syntax"
else
  pass "Info.plist syntax"
fi

if ! xmllint --noout "$storyboard_path"; then
  fail "LaunchScreen storyboard syntax"
else
  pass "LaunchScreen storyboard syntax"
fi

display_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$plist_path")"
development_region="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDevelopmentRegion' "$plist_path")"
assert_equal "$display_name" "よていスナップ" "installed display name"
assert_equal "$development_region" "ja" "development region"
assert_xpath_count "$storyboard_path" '//view' "1" "launch screen has exactly one basic view"
assert_xpath_count "$storyboard_path" '//viewController/view[@key="view" and @opaque="YES"]' "1" "launch root is explicitly opaque"
assert_xpath_count "$storyboard_path" '//viewController/view[@key="view"]/*[not(self::rect or self::autoresizingMask or self::viewLayoutGuide or self::color)]' "0" "launch root has no visual child objects"
assert_xpath_count "$storyboard_path" '//label | //image | //imageView | //*[@image]' "0" "launch screen has no labels or images"
assert_xpath_count "$storyboard_path" '//*[@customClass or @customModule or @customModuleProvider] | //userDefinedRuntimeAttributes | //userDefinedRuntimeAttribute' "0" "launch screen has no custom classes or runtime attributes"
assert_xpath_count "$storyboard_path" '//viewController/view[@key="view"]/color[@key="backgroundColor" and @red="0.94901960784313721" and @green="0.94901960784313721" and @blue="0.96862745098039216" and @alpha="1" and @colorSpace="custom" and @customColorSpace="sRGB"]' "1" "launch background is opaque sRGB #F2F2F7"
assert_not_contains "$storyboard_path" 'appearance="dark"' "launch screen dark appearance"
assert_not_contains "$storyboard_path" 'よていスナップ' "launch screen product name"
assert_not_contains "$storyboard_path" 'LifeSnap' "launch screen old brand"
assert_contains "$calendar_path" '— よていスナップで作成' "calendar-note signature"
assert_contains "$consent_path" 'よていスナップ' "consent visible brand"
assert_not_contains "$consent_path" 'LifeSnap' "consent old visible brand"

assert_contains "$project_yml" 'MARKETING_VERSION: "1.1"' "project.yml marketing version"
assert_contains "$project_yml" 'CURRENT_PROJECT_VERSION: "4"' "project.yml build number"

pbx_marketing_count="$(grep -c 'MARKETING_VERSION = 1.1;' "$pbxproj_path" || true)"
pbx_build_count="$(grep -c 'CURRENT_PROJECT_VERSION = 4;' "$pbxproj_path" || true)"
assert_equal "$pbx_marketing_count" "2" "pbxproj marketing version occurrences"
assert_equal "$pbx_build_count" "2" "pbxproj build number occurrences"

while IFS='|' read -r icon_filename expected_width expected_height; do
  icon_path="$icon_dir/$icon_filename"
  if [ ! -f "$icon_path" ]; then
    fail "missing icon $icon_filename"
    continue
  fi

  actual_width="$(sips -g pixelWidth "$icon_path" 2>/dev/null | awk '/pixelWidth/ {print $2}')"
  actual_height="$(sips -g pixelHeight "$icon_path" 2>/dev/null | awk '/pixelHeight/ {print $2}')"
  has_alpha="$(sips -g hasAlpha "$icon_path" 2>/dev/null | awk '/hasAlpha/ {print $2}')"

  assert_equal "$actual_width" "$expected_width" "$icon_filename width"
  assert_equal "$actual_height" "$expected_height" "$icon_filename height"
  assert_equal "$has_alpha" "no" "$icon_filename alpha"
done <<'ICON_SPECS'
AppIcon-iphone-notification-2x.png|40|40
AppIcon-iphone-notification-3x.png|60|60
AppIcon-iphone-settings-2x.png|58|58
AppIcon-iphone-settings-3x.png|87|87
AppIcon-iphone-spotlight-2x.png|80|80
AppIcon-iphone-spotlight-3x.png|120|120
AppIcon-iphone-app-2x.png|120|120
AppIcon-iphone-app-3x.png|180|180
AppIcon-ipad-notification-1x.png|20|20
AppIcon-ipad-notification-2x.png|40|40
AppIcon-ipad-settings-1x.png|29|29
AppIcon-ipad-settings-2x.png|58|58
AppIcon-ipad-spotlight-1x.png|40|40
AppIcon-ipad-spotlight-2x.png|80|80
AppIcon-ipad-app-2x.png|152|152
AppIcon-ipad-pro-2x.png|167|167
AppIcon-marketing.png|1024|1024
ICON_SPECS

contents_path="$icon_dir/Contents.json"
node --input-type=module - "$contents_path" <<'NODE'
import fs from "node:fs";

const contentsPath = process.argv[2];
const parsed = JSON.parse(fs.readFileSync(contentsPath, "utf8"));
const filenames = parsed.images.map((image) => image.filename).filter(Boolean);
if (filenames.length !== 17 || new Set(filenames).size !== 17) {
  console.error(`FAIL: Contents.json expected 17 unique filenames, found ${filenames.length}`);
  process.exit(1);
}
console.log("PASS: Contents.json has 17 unique filenames");
NODE
if [ "$?" -ne 0 ]; then
  failure_count=$((failure_count + 1))
fi

if [ "$failure_count" -ne 0 ]; then
  printf '\n%d release-contract check(s) failed.\n' "$failure_count" >&2
  exit 1
fi

printf '\nAll よていスナップ release-contract checks passed.\n'
```

- [ ] **Step 2: Make the script executable and expose it through npm**

Run:

```bash
chmod +x scripts/validate-yotei-snap-release.sh
```

Add this entry after `test` in `package.json`:

```json
"validate:ios-release": "bash scripts/validate-yotei-snap-release.sh"
```

Keep the preceding `test` entry comma-terminated so the JSON remains valid.

- [ ] **Step 3: Run the contract and verify it fails for the old brand/version**

Run:

```bash
npm run validate:ios-release
```

Expected: exit 1 with failures for `LifeSnap`, `LifeSnap Action`, marketing version `1.0`, and build `3`. Existing icon dimension/alpha checks should pass.

- [ ] **Step 4: Verify package and shell syntax**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))'
bash -n scripts/validate-yotei-snap-release.sh
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the red contract**

```bash
git add package.json scripts/validate-yotei-snap-release.sh
git commit -m "test: add yotei snap release contract"
```

---

### Task 2: Generate and install the approved AppIcon

**Files:**
- Create: `docs/superpowers/specs/assets/yotei-snap-app-icon-master-source.png`
- Create: `docs/verification/yotei-snap-release/icon-reference-vs-final.png`
- Modify: `ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset/*.png`

- [ ] **Step 1: Open the approved visual reference**

Open:

```text
docs/superpowers/specs/assets/yotei-snap-icon-direction-2-reference.png
```

Confirm the invariant before generating: warm-white paper turns up at the lower right to reveal a blue calendar grid and one checkmark.

- [ ] **Step 2: Generate the final master with ImageGen**

Use the built-in ImageGen edit path with the approved visual reference as the edit target and this exact prompt:

```text
Use case: style-transfer
Asset type: production iOS AppIcon master, opaque square artwork
Primary request: Refine this selected “page turns into calendar” concept into a restrained Apple-native utility icon for よていスナップ.
Input image: approved Direction 2 reference; preserve the paper-turn metaphor and overall centered composition.
Change only: reduce the document to three dark-gray text lines; reduce the calendar to a simple 3-by-3 grid; enlarge the single blue checkmark; use a perfectly uniform #F2F2F7 full-bleed background; remove the visible background glow, decorative gradient, and excessive floating shadow.
Style/medium: precise vector-friendly geometry with one subtle physically plausible paper shadow.
Color palette: warm white paper, Apple system blue, dark gray.
Composition/framing: one centered unified symbol occupying about 64 percent of the square; generous optical padding; readable at 20px; no baked rounded-corner frame.
Constraints: opaque full square; no transparency; no text, letters, numerals, watermark, camera lens, scan brackets, sparkles, stars, robot, brain, magic wand, neon, decorative rings, extra badges, tiny calendar numbers, or extra objects.
```

Copy the exact file returned by ImageGen to:

```text
docs/superpowers/specs/assets/yotei-snap-app-icon-master-source.png
```

- [ ] **Step 3: Inspect the generated master before replacement**

Open the copied master at original resolution. Reject and regenerate once with a single targeted correction if any of these are visible:

- background glow or gradient;
- more than three document lines;
- illegible checkmark at 20px;
- sparkle/magic/camera/AI motifs;
- baked outer rounded square;
- clipped paper or calendar.

Expected: one coherent paper-turn symbol with no forbidden motifs.

- [ ] **Step 4: Normalize the master to an opaque 1024 RGB marketing icon**

Run:

```bash
mkdir -p docs/verification/yotei-snap-release

ffmpeg -loglevel error -y \
  -i docs/superpowers/specs/assets/yotei-snap-app-icon-master-source.png \
  -vf 'scale=1024:1024:flags=lanczos,format=rgb24' \
  -frames:v 1 -update 1 \
  ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-marketing.png
```

Expected: `AppIcon-marketing.png` is 1024 × 1024 and `sips -g hasAlpha` reports `no`.

- [ ] **Step 5: Generate every declared size from the 1024 master**

Run these exact commands:

```bash
icon_dir="ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset"
master_icon="$icon_dir/AppIcon-marketing.png"

sips -z 40 40 "$master_icon" --out "$icon_dir/AppIcon-iphone-notification-2x.png"
sips -z 60 60 "$master_icon" --out "$icon_dir/AppIcon-iphone-notification-3x.png"
sips -z 58 58 "$master_icon" --out "$icon_dir/AppIcon-iphone-settings-2x.png"
sips -z 87 87 "$master_icon" --out "$icon_dir/AppIcon-iphone-settings-3x.png"
sips -z 80 80 "$master_icon" --out "$icon_dir/AppIcon-iphone-spotlight-2x.png"
sips -z 120 120 "$master_icon" --out "$icon_dir/AppIcon-iphone-spotlight-3x.png"
sips -z 120 120 "$master_icon" --out "$icon_dir/AppIcon-iphone-app-2x.png"
sips -z 180 180 "$master_icon" --out "$icon_dir/AppIcon-iphone-app-3x.png"
sips -z 20 20 "$master_icon" --out "$icon_dir/AppIcon-ipad-notification-1x.png"
sips -z 40 40 "$master_icon" --out "$icon_dir/AppIcon-ipad-notification-2x.png"
sips -z 29 29 "$master_icon" --out "$icon_dir/AppIcon-ipad-settings-1x.png"
sips -z 58 58 "$master_icon" --out "$icon_dir/AppIcon-ipad-settings-2x.png"
sips -z 40 40 "$master_icon" --out "$icon_dir/AppIcon-ipad-spotlight-1x.png"
sips -z 80 80 "$master_icon" --out "$icon_dir/AppIcon-ipad-spotlight-2x.png"
sips -z 152 152 "$master_icon" --out "$icon_dir/AppIcon-ipad-app-2x.png"
sips -z 167 167 "$master_icon" --out "$icon_dir/AppIcon-ipad-pro-2x.png"
```

Expected: all commands exit 0.

- [ ] **Step 6: Create the required same-input visual comparison**

Run:

```bash
ffmpeg -loglevel error -y \
  -i docs/superpowers/specs/assets/yotei-snap-icon-direction-2-reference.png \
  -i ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-marketing.png \
  -filter_complex '[0:v]scale=512:512:flags=lanczos[ref];[1:v]scale=512:512:flags=lanczos[final];[ref][final]hstack=inputs=2[out]' \
  -map '[out]' -frames:v 1 -update 1 \
  docs/verification/yotei-snap-release/icon-reference-vs-final.png
```

Open the combined image as one comparison input. Check silhouette, page-turn fidelity, blue/white token mapping, line count, optical padding, shadow restraint, and 20px readability.

- [ ] **Step 7: Run the asset portion of the contract**

Run:

```bash
npm run validate:ios-release
```

Expected: all 17 icon dimension/alpha lines pass; brand and version checks still fail.

- [ ] **Step 8: Commit the approved master and icon set**

```bash
git add \
  docs/superpowers/specs/assets/yotei-snap-app-icon-master-source.png \
  docs/verification/yotei-snap-release/icon-reference-vs-final.png \
  ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset
git commit -m "feat: replace app icon with Apple-native mark"
```

---

### Task 3: Rename user-visible app surfaces with tests

**Files:**
- Modify: `ios/LifeSnapActionTests/AppFlowCoordinatorTests.swift`
- Modify: `ios/LifeSnapAction/Info.plist`
- Modify: `ios/LifeSnapAction/Resources/LaunchScreen.storyboard`
- Modify: `ios/LifeSnapAction/Services/CalendarService.swift`
- Modify: `ios/LifeSnapAction/Views/UploadConsentView.swift`

- [ ] **Step 1: Add failing brand assertions**

In `testConsentCopyContainsRequiredDisclosureAndActions()`, add:

```swift
XCTAssertTrue(body.contains("よていスナップ"))
XCTAssertFalse(body.contains("LifeSnap"))
```

Add this test in `AppFlowCoordinatorTests`:

```swift
func testCalendarSignatureUsesJapaneseBrand() {
    XCTAssertEqual(
        CalendarService.brandSignature,
        "— よていスナップで作成"
    )
}
```

- [ ] **Step 2: Run the targeted tests and verify red**

Run:

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-brand-red-derived \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:LifeSnapActionTests/AppFlowCoordinatorTests/testConsentCopyContainsRequiredDisclosureAndActions \
  -only-testing:LifeSnapActionTests/AppFlowCoordinatorTests/testCalendarSignatureUsesJapaneseBrand \
  test -quiet
```

Expected: compile failure because `CalendarService.brandSignature` is missing, plus the old consent brand would fail once compilation succeeds.

- [ ] **Step 3: Implement the minimal brand constants and user-visible strings**

In `CalendarService`, add directly under `static let shared`:

```swift
static let brandSignature = "— よていスナップで作成"
```

Replace:

```swift
parts.append("— Created by LifeSnap Action")
```

with:

```swift
parts.append(Self.brandSignature)
```

In `UploadConsentView.swift`, use these exact visible strings:

```swift
この書類画像は、予定・タスク情報を抽出する目的で よていスナップ の Google Cloud Run バックエンドと第三者AIサービス Google Gemini（Google LLC）へ送信されます。
```

```swift
よていスナップ はリクエスト処理中にメモリ上で画像を扱い、画像、base64、OCR内容、抽出結果をデータベース・オブジェクトストレージ・ファイルへ永続保存しません。
```

Update the summary values to:

```swift
value: "よていスナップ と Google Gemini"
```

```swift
value: "よていスナップ は画像や抽出内容を永続保存しません"
```

In `Info.plist`, set:

```xml
<key>CFBundleDevelopmentRegion</key>
<string>ja</string>
<key>CFBundleDisplayName</key>
<string>よていスナップ</string>
```

In `LaunchScreen.storyboard`, apply the user-approved 2026-07-30 launch amendment:

```xml
<device id="retina6_12" orientation="portrait" appearance="light"/>
<view key="view" contentMode="scaleToFill" opaque="YES" id="launch-root-view">
    <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
    <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
    <viewLayoutGuide key="safeArea" id="launch-safe-area"/>
    <color key="backgroundColor" red="0.94901960784313721" green="0.94901960784313721" blue="0.96862745098039216" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
</view>
```

Remove the launch label, constraints, images, logos, custom classes, and runtime attributes. Keep `UILaunchStoryboardName = LaunchScreen` unchanged. The launch screen intentionally contains no product name; Home screen identity remains `よていスナップ`.

- [ ] **Step 4: Run tests and static brand checks**

Run:

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-brand-green-derived \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:LifeSnapActionTests/AppFlowCoordinatorTests/testConsentCopyContainsRequiredDisclosureAndActions \
  -only-testing:LifeSnapActionTests/AppFlowCoordinatorTests/testCalendarSignatureUsesJapaneseBrand \
  test -quiet

plutil -lint ios/LifeSnapAction/Info.plist
xmllint --noout ios/LifeSnapAction/Resources/LaunchScreen.storyboard
```

Expected: all commands exit 0.

- [ ] **Step 5: Run the release contract**

Run:

```bash
npm run validate:ios-release
```

Expected: brand and icon checks pass; only version 1.1 / Build 4 checks remain red.

- [ ] **Step 6: Commit the visible rename**

```bash
git add \
  ios/LifeSnapActionTests/AppFlowCoordinatorTests.swift \
  ios/LifeSnapAction/Info.plist \
  ios/LifeSnapAction/Resources/LaunchScreen.storyboard \
  ios/LifeSnapAction/Services/CalendarService.swift \
  ios/LifeSnapAction/Views/UploadConsentView.swift
git commit -m "feat: rename app to yotei snap"
```

---

### Task 4: Set version 1.1 Build 4 and refresh release metadata

**Files:**
- Modify: `ios/project.yml`
- Modify: `ios/LifeSnapAction.xcodeproj/project.pbxproj`
- Modify: `docs/app-store/app-description-ja.md`
- Modify: `docs/app-store/app-description-en.md`
- Modify: `docs/app-store/app-review-notes.md`
- Modify: `docs/app-store/screenshot-plan.md`
- Create: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Update both version sources**

In `ios/project.yml`, set:

```yaml
MARKETING_VERSION: "1.1"
CURRENT_PROJECT_VERSION: "4"
```

In both Debug and Release app configurations in `project.pbxproj`, set:

```text
CURRENT_PROJECT_VERSION = 4;
MARKETING_VERSION = 1.1;
```

Do not change the test-target version, target name, product name, or bundle ID.

- [ ] **Step 2: Update the Japanese App Store description**

Use this exact title and opening:

```markdown
# よていスナップ App Store説明文ドラフト

よていスナップは、紙の案内や通知をカレンダー予定に変えるためのアプリです。

学校からのお知らせ、予約案内、請求書、期限のある書類などを撮影、または写真から選択すると、予定に関係する日付、時間、タイトル、場所、メモを読み取ります。内容を確認してから、iPhoneのシステムカレンダーに追加できます。
```

In the privacy paragraph, replace user-visible `LifeSnap` references with `よていスナップ` while preserving `Google Gemini Paid Service`, consent, limited logs, and non-persistence statements.

- [ ] **Step 3: Update the English App Store description**

Use this exact title and opening:

```markdown
# Yotei Snap App Store Description Draft

Yotei Snap (よていスナップ) turns paper notices into calendar events.

Take or select a photo of a school notice, appointment letter, invoice, or other time-sensitive document. Yotei Snap extracts the likely date, time, title, location, and memo, lets you confirm the result, then adds the event to your iPhone calendar.
```

Replace remaining visible `LifeSnap` brand references with `Yotei Snap`; preserve all Google Gemini and privacy statements.

- [ ] **Step 4: Correct and rebrand reviewer instructions**

In `docs/app-store/app-review-notes.md`:

- title the product `よていスナップ (Yotei Snap)`;
- replace visible `LifeSnap` brand references with `よていスナップ`;
- retain the production API URL and technical identifier names;
- replace the obsolete first-upload action with `同意して続ける`;
- replace the obsolete retry action with `同意してもう一度試す`.

The reviewer flow must read:

```markdown
1. Launch よていスナップ.
2. Tap `カメラで撮影` or `ライブラリから選択`.
3. Confirm that the upload-consent screen appears before processing.
4. Tap `キャンセル`; verify that no image is uploaded.
5. Select the sample again and tap `同意して続ける`.
6. Review the proposed event fields.
7. Grant Calendar access when prompted.
8. Add the confirmed event to Calendar.
9. If retry appears, verify that `同意してもう一度試す` is required before another upload.
```

- [ ] **Step 5: Make the screenshot plan truthful for the current target**

Replace the complete `Required Devices` section with:

```markdown
## Required Devices

- The current app target is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`); do not prepare or upload iPad screenshots.
- Prepare one Japanese 6.9-inch iPhone portrait set using one Apple-accepted size consistently: 1260 × 2736, 1290 × 2796, or 1320 × 2868 pixels.
- Provide between one and ten screenshots. Use the highest-resolution set so App Store Connect can scale it for smaller iPhone displays.
```

Add these rules:

```markdown
- Screenshots must use the approved Apple-native UI and the よていスナップ brand.
- Do not show the old LifeSnap icon, a branded launch screen, a black launch flash, mock badges, or personal document data.
```

- [ ] **Step 6: Create the release gate document**

Create `docs/release/yotei-snap-v1.1-app-store-release-gate.md` with:

```markdown
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
| Release contract | PENDING | Not run |
| iOS tests | PENDING | Not run |
| Simulator visual acceptance | PENDING | Not run |
| Backend regression | PENDING | Not run |
| Signing identity | PENDING | Not checked |
| Archive | PENDING | Not run |
| Export validation | PENDING | Not run |
| Build 4 upload | PENDING | Not run |
| App Store metadata | PENDING | Not changed |
| App Review submission | PENDING | Not submitted |

## External-State Rule

Archive, upload, metadata save, App Review submission, review approval, and storefront availability are separate states. Record only observed state and never promote one state into another.

## Evidence Log

Append timestamped, sanitized evidence here during execution. Do not include credentials, provisioning secrets, personal contact details, document contents, or raw App Store session data.
```

- [ ] **Step 7: Run the now-green release contract**

Run:

```bash
npm run validate:ios-release
```

Expected: `All よていスナップ release-contract checks passed.`

- [ ] **Step 8: Commit version and metadata**

```bash
git add \
  ios/project.yml \
  ios/LifeSnapAction.xcodeproj/project.pbxproj \
  docs/app-store/app-description-ja.md \
  docs/app-store/app-description-en.md \
  docs/app-store/app-review-notes.md \
  docs/app-store/screenshot-plan.md \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md
git commit -m "docs: prepare yotei snap 1.1 release"
```

---

### Task 5: Run full local and visual acceptance

**Files:**
- Modify: `design-qa.md`
- Create: `docs/verification/yotei-snap-release/home-screen-light.png`
- Create: `docs/verification/yotei-snap-release/launch-screen-light.png`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Run all automated checks**

Run in parallel where safe:

```bash
npm run validate:ios-release
npm test
npm run lint
npm run build

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-final-test-derived \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-final-release-derived \
  build -quiet
```

Expected: every command exits 0; Vitest reports 29 passing tests or the current higher reviewed count.

The Release build installed for visual acceptance must use Xcode's normal simulator signing. A `CODE_SIGNING_ALLOWED=NO` app has an unbound `Info.plist` and no sealed resources and is not valid installed-product evidence.

- [ ] **Step 2: Install the exact Release simulator build**

Run:

```bash
xcrun simctl bootstatus 56C4DC85-0732-49CF-8389-10D16B2BBDC3 -b
xcrun simctl install \
  56C4DC85-0732-49CF-8389-10D16B2BBDC3 \
  /tmp/yotei-snap-final-release-derived/Build/Products/Release-iphonesimulator/LifeSnapAction.app
```

Expected: install exits 0.

- [ ] **Step 3: Capture the installed Home-screen icon and name**

Activate Simulator, return to Home, and capture:

```bash
open -a Simulator
osascript \
  -e 'tell application "Simulator" to activate' \
  -e 'tell application "System Events" to keystroke "h" using {command down, shift down}'
sleep 1
xcrun simctl io \
  56C4DC85-0732-49CF-8389-10D16B2BBDC3 \
  screenshot \
  docs/verification/yotei-snap-release/home-screen-light.png
```

Inspect the screenshot. Acceptance:

- selected page-turn icon is visible;
- label reads `よていスナップ`;
- label is not clipped;
- no old icon is shown.

If the app is on another Home page, navigate to its page in Simulator before recapturing; do not substitute an asset-file preview for installed-product evidence.

- [ ] **Step 4: Capture and inspect the neutral launch transition**

Create a new iPhone 15 simulator on the same reviewed runtime, clean-install the exact normally signed Release app, begin recording while Home is visible, and launch once:

```bash
launch_qa_name="YoteiSnap-Launch-QA-$(date +%Y%m%d%H%M%S)"
launch_qa_udid="$(xcrun simctl create \
  "$launch_qa_name" \
  com.apple.CoreSimulator.SimDeviceType.iPhone-15 \
  com.apple.CoreSimulator.SimRuntime.iOS-26-5)"
xcrun simctl boot "$launch_qa_udid"
xcrun simctl bootstatus "$launch_qa_udid" -b
xcrun simctl install \
  "$launch_qa_udid" \
  /tmp/yotei-snap-final-release-derived/Build/Products/Release-iphonesimulator/LifeSnapAction.app
xcrun simctl io "$launch_qa_udid" recordVideo \
  --codec=h264 \
  --force \
  /tmp/yotei-snap-launch-transition.mp4 &
launch_record_pid=$!
sleep 1
xcrun simctl launch "$launch_qa_udid" com.zll.lifesnapaction
sleep 3
kill -INT "$launch_record_pid"
wait "$launch_record_pid"
```

Extract a contact sheet and inspect the individual transition frames. Copy a representative real `#F2F2F7` launch frame—not a constructed image—to `docs/verification/yotei-snap-release/launch-screen-light.png`.

Acceptance:

- the sequence starts on Home and includes the installed icon zoom;
- there is no sustained pure-black frame between icon zoom and runtime;
- the launch surface is visually `#F2F2F7`, has no product name, logo, image, or other decoration, and blends into the first screen;
- the runtime first screen remains intact;
- SplashBoard logs contain no denylist rejection for `com.zll.lifesnapaction`.

If a clean device still records the denylist rejection or a sustained black transition, stop as blocked and retain the diagnostics outside the repository.

- [ ] **Step 5: Complete Product Design QA**

Open these together in one comparison input:

- `docs/superpowers/specs/assets/yotei-snap-icon-direction-2-reference.png`
- `ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-marketing.png`
- `docs/verification/yotei-snap-release/home-screen-light.png`

Check icon fidelity, 20px/60px/180px quality, installed mask behavior, display-name readability, the neutral launch-to-first-screen transition, and consistency with the approved UI.

Append an icon/rebrand section to `design-qa.md`. The report must end exactly:

```text
final result: passed
```

Do not pass if the installed screenshot is missing, the label clips, or the reference/final images were not inspected together.

- [ ] **Step 6: Update the local gates**

In `docs/release/yotei-snap-v1.1-app-store-release-gate.md`, mark only these observed gates:

- Release contract
- iOS tests
- Simulator visual acceptance
- Backend regression

Record exact commands, exit results, simulator name/UDID, and screenshot paths. Keep signing/archive/upload/metadata/submission as `PENDING`.

- [ ] **Step 7: Commit verified local evidence**

```bash
git add \
  design-qa.md \
  docs/verification/yotei-snap-release/home-screen-light.png \
  docs/verification/yotei-snap-release/launch-screen-light.png \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md
git commit -m "test: verify yotei snap rebrand"
```

---

### Task 6: Perform signed archive and export validation

**Files:**
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Verify the live signing/provider preconditions**

Run:

```bash
security find-identity -v -p codesigning
xcrun altool --list-providers
```

Required evidence:

- a valid Apple Distribution identity for team `YMUG864233`;
- provider access for the existing LifeSnapAction App Store record.

If either is missing, mark signing/archive `BLOCKED` with the exact sanitized error and stop before archive/upload.

- [ ] **Step 2: Create an explicit release workspace**

Run:

```bash
release_root="$(mktemp -d /tmp/yotei-snap-1.1-build4.XXXXXX)"
printf '%s\n' "$release_root"
```

Record the returned explicit path in the release gate before using it. Do not reuse an old v1.0 archive.

- [ ] **Step 3: Archive version 1.1 Build 4**

Run with the explicit path returned in Step 2:

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$release_root/LifeSnapAction.xcarchive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=YMUG864233 \
  CODE_SIGN_STYLE=Automatic \
  archive
```

Expected: `** ARCHIVE SUCCEEDED **`.

- [ ] **Step 4: Verify archive identity before export**

Run:

```bash
archive_info="$release_root/LifeSnapAction.xcarchive/Info.plist"
app_info="$release_root/LifeSnapAction.xcarchive/Products/Applications/LifeSnapAction.app/Info.plist"

/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleIdentifier' "$archive_info"
/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$archive_info"
/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$archive_info"
/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$app_info"
codesign -d --entitlements :- \
  "$release_root/LifeSnapAction.xcarchive/Products/Applications/LifeSnapAction.app"
```

Required values:

- `com.zll.lifesnapaction`
- `1.1`
- `4`
- `よていスナップ`
- distribution entitlements with `get-task-allow` absent or false

Any mismatch is a hard stop.

- [ ] **Step 5: Export and validate the IPA**

Run:

```bash
xcodebuild \
  -exportArchive \
  -archivePath "$release_root/LifeSnapAction.xcarchive" \
  -exportPath "$release_root/export" \
  -exportOptionsPlist ios/exportOptions.plist \
  -allowProvisioningUpdates
```

Expected: export succeeds and creates a signed IPA under `$release_root/export`.

- [ ] **Step 6: Record and commit sanitized archive evidence**

Update the release gate with:

- explicit archive/export path;
- identity/team;
- bundle/version/build/display name;
- archive and export results;
- entitlements summary;
- no credentials, profiles, emails, or raw provisioning contents.

Commit:

```bash
git add docs/release/yotei-snap-v1.1-app-store-release-gate.md
git commit -m "docs: record yotei snap archive validation"
```

---

### Task 7: Upload Build 4 without conflating upload and review

**Files:**
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Create upload-only export options**

Run with the same `$release_root`:

```bash
cp ios/exportOptions.plist "$release_root/uploadOptions.plist"
plutil -replace destination -string upload "$release_root/uploadOptions.plist"
plutil -lint "$release_root/uploadOptions.plist"
plutil -p "$release_root/uploadOptions.plist"
```

Required visible values:

- `method = app-store-connect`
- `destination = upload`
- `signingStyle = automatic`
- `teamID = YMUG864233`

- [ ] **Step 2: Upload the validated archive**

Run:

```bash
xcodebuild \
  -exportArchive \
  -archivePath "$release_root/LifeSnapAction.xcarchive" \
  -exportPath "$release_root/upload-export" \
  -exportOptionsPlist "$release_root/uploadOptions.plist" \
  -allowProvisioningUpdates
```

Expected: Xcode reports a successful upload. This proves only upload acceptance, not processing, build binding, review submission, approval, or storefront release.

- [ ] **Step 3: Verify Build 4 processing in App Store Connect**

Open the existing App Store Connect app record in the user's authenticated browser session. Read the current iOS builds without editing.

Required observed build:

- version `1.1`;
- build `4`;
- bundle ID `com.zll.lifesnapaction`;
- processing complete or an explicit processing/error state.

If Build 4 remains processing, monitor that external state without re-uploading. If processing fails, capture the sanitized failure and stop.

- [ ] **Step 4: Record upload and processing as separate facts**

Update the release gate:

- `Build 4 upload`: `PASS` only after Xcode upload success;
- `Build 4 processing`: exact observed App Store Connect status;
- metadata and App Review submission remain `PENDING`.

Commit:

```bash
git add docs/release/yotei-snap-v1.1-app-store-release-gate.md
git commit -m "docs: record yotei snap build upload"
```

---

### Task 8: Update App Store metadata and submit version 1.1

**Files:**
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Inspect current App Store Connect state before mutation**

In the user's authenticated browser, record:

- current app status;
- whether iOS version 1.1 already exists;
- available Japanese localization;
- current public name/subtitle;
- Build 4 processing status;
- role/permission sufficiency.

If the state is non-editable or the session lacks Account Holder, Admin, App Manager, or Marketing capability needed for the chosen field, mark `BLOCKED_BY_APP_STORE_CONNECT_STATE` and stop.

- [ ] **Step 2: Create or reuse version 1.1**

- If no iOS 1.1 version exists and the current released version is Ready for Distribution, create version `1.1`.
- If version 1.1 exists, reuse it and do not create a duplicate.
- If another editable draft version conflicts, stop and report the exact version/status instead of overwriting it.

- [ ] **Step 3: Save the approved localized identity**

In Japanese localization, set exactly:

```text
Name: よていスナップ
Subtitle: 紙の案内を予定に変える
```

If App Store Connect rejects the name as unavailable, do not invent another name; mark `BLOCKED_BY_APP_NAME_AVAILABILITY` and return to the user.

- [ ] **Step 4: Update version metadata**

Use:

```text
What’s New:
書類を確認しやすいAppleらしいデザインに刷新し、アプリアイコンと名称を「よていスナップ」に変更しました。
```

Paste the current reviewed Japanese description from `docs/app-store/app-description-ja.md`, keep the existing support/privacy URLs, and use the exact reviewer flow from `docs/app-store/app-review-notes.md`.

Do not change privacy labels, price, countries, bundle ID, SKU, age rating, or backend URLs unless App Store Connect explicitly requires a correction.

- [ ] **Step 5: Ensure screenshots match the shipped UI**

Compare current product-page screenshots with the verified Apple-native simulator captures.

- If current screenshots show the old UI or old brand, upload a Japanese large-iPhone set following `docs/app-store/screenshot-plan.md`.
- If current screenshots already match the shipped build, retain them and record that evidence.
- Never upload screenshots containing personal documents, private calendar data, simulator debug badges, or stale branding.

- [ ] **Step 6: Bind Build 4 and resolve required compliance prompts**

Select version `1.1` Build `4`. Answer export compliance only from the actual app binary and existing reviewed cryptography behavior; do not guess or change legal/compliance answers to bypass a blocker.

- [ ] **Step 7: Submit to App Review**

Review the complete metadata, build, screenshots, privacy links, and reviewer notes. Submit version 1.1.

Record the exact resulting state, such as:

- `Waiting for Review`
- `In Review`
- `Metadata Rejected`
- another explicit App Store Connect status

Do not report `approved`, `released`, or `available` unless that distinct state is later observed.

- [ ] **Step 8: Record and commit the final submitted state**

Update the release gate with timestamp, exact status, app name, version, build, and the fact that no backend deployment occurred.

Run:

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -12
```

Commit only sanitized release evidence:

```bash
git add docs/release/yotei-snap-v1.1-app-store-release-gate.md
git commit -m "docs: record yotei snap review submission"
```

---

### Task 9: Final verification and branch handoff

**Files:**
- No new product files unless verification finds an approved-scope defect.

- [ ] **Step 1: Re-run the complete local verification on committed HEAD**

Run:

```bash
npm run validate:ios-release
npm test
npm run lint
npm run build

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-closeout-derived \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet

git diff --check
git status --short --branch
```

Expected: all checks pass and tracked worktree changes are clean.

- [ ] **Step 2: Review branch scope**

Run:

```bash
git diff --stat fdaa8cd..HEAD
git diff --name-status fdaa8cd..HEAD
git log --oneline --decorate fdaa8cd..HEAD
```

Confirm there are no backend behavior, Bundle ID, unrelated product, or historical v1.0 evidence changes.

- [ ] **Step 3: Report truthful boundaries**

Final report must distinguish:

- local implementation and tests;
- signed archive/export;
- Build 4 upload and processing;
- metadata save;
- App Review submission status;
- approval/storefront availability if and only if separately observed;
- Git branch not merged/pushed unless explicitly authorized.

- [ ] **Step 4: Use the finishing-development-branch workflow**

Present the four integration choices for `codex/lifesnap-apple-native-ui` without merging, pushing, or deleting by assumption.
