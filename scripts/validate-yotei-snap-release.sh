#!/usr/bin/env bash

set -u

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
failure_count=0

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
  failure_count=$((failure_count + 1))
}

assert_equal() {
  actual=$1
  expected=$2
  label=$3

  if [ "$actual" = "$expected" ]; then
    pass "$label"
  else
    fail "$label (expected: $expected; actual: $actual)"
  fi
}

assert_contains() {
  file=$1
  expected=$2
  label=$3

  if grep -F -- "$expected" "$file" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label (missing: $expected)"
  fi
}

assert_not_contains() {
  file=$1
  unexpected=$2
  label=$3

  if grep -F -- "$unexpected" "$file" >/dev/null 2>&1; then
    fail "$label (found: $unexpected)"
  else
    pass "$label"
  fi
}

assert_xpath_count() {
  file=$1
  xpath=$2
  expected=$3
  label=$4

  actual=$(xmllint --xpath "count($xpath)" "$file" 2>/dev/null || true)
  assert_equal "$actual" "$expected" "$label"
}

info_plist="$project_root/ios/LifeSnapAction/Info.plist"
launch_screen="$project_root/ios/LifeSnapAction/Resources/LaunchScreen.storyboard"
calendar_service="$project_root/ios/LifeSnapAction/Services/CalendarService.swift"
upload_consent="$project_root/ios/LifeSnapAction/Views/UploadConsentView.swift"
project_yml="$project_root/ios/project.yml"
pbxproj="$project_root/ios/LifeSnapAction.xcodeproj/project.pbxproj"
icon_dir="$project_root/ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset"

if plutil -lint "$info_plist" >/dev/null 2>&1; then
  pass 'Info.plist syntax'
else
  fail 'Info.plist syntax'
fi

if xmllint --noout "$launch_screen" >/dev/null 2>&1; then
  pass 'LaunchScreen.storyboard syntax'
else
  fail 'LaunchScreen.storyboard syntax'
fi

display_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$info_plist" 2>/dev/null || true)
development_region=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDevelopmentRegion' "$info_plist" 2>/dev/null || true)
short_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist" 2>/dev/null || true)
bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist" 2>/dev/null || true)
assert_equal "$display_name" 'よていスナップ' 'CFBundleDisplayName'
assert_equal "$development_region" 'ja' 'CFBundleDevelopmentRegion'
assert_equal "$short_version" '$(MARKETING_VERSION)' 'CFBundleShortVersionString'
assert_equal "$bundle_version" '$(CURRENT_PROJECT_VERSION)' 'CFBundleVersion'

assert_xpath_count "$launch_screen" '//view' '1' 'LaunchScreen has exactly one basic view'
assert_xpath_count "$launch_screen" '//viewController/view[@key="view" and @opaque="YES"]' '1' 'LaunchScreen root view is explicitly opaque'
assert_xpath_count "$launch_screen" '//viewController/view[@key="view"]/*[not(self::rect or self::autoresizingMask or self::viewLayoutGuide or self::color)]' '0' 'LaunchScreen root has no visual child objects'
assert_xpath_count "$launch_screen" '//label' '0' 'LaunchScreen has no labels'
assert_xpath_count "$launch_screen" '//image | //imageView | //*[@image]' '0' 'LaunchScreen has no images or logos'
assert_xpath_count "$launch_screen" '//*[@customClass or @customModule or @customModuleProvider]' '0' 'LaunchScreen has no custom classes'
assert_xpath_count "$launch_screen" '//userDefinedRuntimeAttributes | //userDefinedRuntimeAttribute' '0' 'LaunchScreen has no runtime attributes'
assert_xpath_count "$launch_screen" '//viewController/view[@key="view"]/color[@key="backgroundColor" and @red="0.94901960784313721" and @green="0.94901960784313721" and @blue="0.96862745098039216" and @alpha="1" and @colorSpace="custom" and @customColorSpace="sRGB"]' '1' 'LaunchScreen background is opaque sRGB #F2F2F7'
assert_not_contains "$launch_screen" 'appearance="dark"' 'LaunchScreen is not dark'
assert_not_contains "$launch_screen" 'よていスナップ' 'LaunchScreen has no product name'
assert_not_contains "$launch_screen" 'LifeSnap' 'LaunchScreen has no old brand'
assert_contains "$calendar_service" '— よていスナップで作成' 'Calendar attribution'
assert_contains "$upload_consent" 'よていスナップ' 'Upload consent brand'
assert_not_contains "$upload_consent" 'LifeSnap' 'Upload consent old brand removed'
assert_contains "$project_yml" 'MARKETING_VERSION: "1.1"' 'project.yml marketing version'
assert_contains "$project_yml" 'CURRENT_PROJECT_VERSION: "4"' 'project.yml build version'

marketing_count=$(grep -cF 'MARKETING_VERSION = 1.1;' "$pbxproj" 2>/dev/null || true)
build_count=$(grep -cF 'CURRENT_PROJECT_VERSION = 4;' "$pbxproj" 2>/dev/null || true)
assert_equal "$marketing_count" '2' 'project.pbxproj marketing version occurrences'
assert_equal "$build_count" '2' 'project.pbxproj build version occurrences'

validate_icon() {
  filename=$1
  expected_size=$2
  icon_path="$icon_dir/$filename"

  if [ ! -f "$icon_path" ]; then
    fail "icon exists: $filename"
    return
  fi
  pass "icon exists: $filename"

  dimensions=$(sips -g pixelWidth -g pixelHeight "$icon_path" 2>/dev/null | awk '/pixelWidth:/ { width=$2 } /pixelHeight:/ { height=$2 } END { print width "x" height }')
  assert_equal "$dimensions" "${expected_size}x${expected_size}" "icon dimensions: $filename"

  has_alpha=$(sips -g hasAlpha "$icon_path" 2>/dev/null | awk '/hasAlpha:/ { print $2 }')
  assert_equal "$has_alpha" 'no' "icon alpha: $filename"
}

validate_icon 'AppIcon-iphone-notification-2x.png' 40
validate_icon 'AppIcon-iphone-notification-3x.png' 60
validate_icon 'AppIcon-iphone-settings-2x.png' 58
validate_icon 'AppIcon-iphone-settings-3x.png' 87
validate_icon 'AppIcon-iphone-spotlight-2x.png' 80
validate_icon 'AppIcon-iphone-spotlight-3x.png' 120
validate_icon 'AppIcon-iphone-app-2x.png' 120
validate_icon 'AppIcon-iphone-app-3x.png' 180
validate_icon 'AppIcon-ipad-notification-1x.png' 20
validate_icon 'AppIcon-ipad-notification-2x.png' 40
validate_icon 'AppIcon-ipad-settings-1x.png' 29
validate_icon 'AppIcon-ipad-settings-2x.png' 58
validate_icon 'AppIcon-ipad-spotlight-1x.png' 40
validate_icon 'AppIcon-ipad-spotlight-2x.png' 80
validate_icon 'AppIcon-ipad-app-2x.png' 152
validate_icon 'AppIcon-ipad-pro-2x.png' 167
validate_icon 'AppIcon-marketing.png' 1024

if node --input-type=module - "$icon_dir/Contents.json" <<'NODE'
import fs from 'node:fs';

const contentsPath = process.argv[2];
const contents = JSON.parse(fs.readFileSync(contentsPath, 'utf8'));
const expectedDescriptors = new Set([
  'AppIcon-iphone-notification-2x.png|iphone|20x20|2x',
  'AppIcon-iphone-notification-3x.png|iphone|20x20|3x',
  'AppIcon-iphone-settings-2x.png|iphone|29x29|2x',
  'AppIcon-iphone-settings-3x.png|iphone|29x29|3x',
  'AppIcon-iphone-spotlight-2x.png|iphone|40x40|2x',
  'AppIcon-iphone-spotlight-3x.png|iphone|40x40|3x',
  'AppIcon-iphone-app-2x.png|iphone|60x60|2x',
  'AppIcon-iphone-app-3x.png|iphone|60x60|3x',
  'AppIcon-ipad-notification-1x.png|ipad|20x20|1x',
  'AppIcon-ipad-notification-2x.png|ipad|20x20|2x',
  'AppIcon-ipad-settings-1x.png|ipad|29x29|1x',
  'AppIcon-ipad-settings-2x.png|ipad|29x29|2x',
  'AppIcon-ipad-spotlight-1x.png|ipad|40x40|1x',
  'AppIcon-ipad-spotlight-2x.png|ipad|40x40|2x',
  'AppIcon-ipad-app-2x.png|ipad|76x76|2x',
  'AppIcon-ipad-pro-2x.png|ipad|83.5x83.5|2x',
  'AppIcon-marketing.png|ios-marketing|1024x1024|1x',
]);
const actualDescriptors = contents.images.map(({ filename, idiom, size, scale }) => `${filename}|${idiom}|${size}|${scale}`);
const uniqueDescriptors = new Set(actualDescriptors);

if (
  actualDescriptors.length !== expectedDescriptors.size ||
  uniqueDescriptors.size !== expectedDescriptors.size ||
  [...uniqueDescriptors].some((descriptor) => !expectedDescriptors.has(descriptor))
) {
  throw new Error('Contents.json must contain the exact 17 expected icon descriptors');
}
NODE
then
  pass 'Contents.json has the exact 17 expected icon descriptors'
else
  fail 'Contents.json has the exact 17 expected icon descriptors'
fi

if [ "$failure_count" -eq 0 ]; then
  printf 'All よていスナップ release-contract checks passed.\n'
  exit 0
fi

exit 1
