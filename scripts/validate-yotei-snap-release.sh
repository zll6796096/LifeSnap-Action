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
entitlements="$project_root/ios/LifeSnapAction/LifeSnapAction.entitlements"
api_client="$project_root/ios/LifeSnapAction/Services/APIClient.swift"
google_service_plist="$project_root/ios/LifeSnapAction/GoogleService-Info.plist"

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

ibtool_path=$(xcrun --find ibtool 2>/dev/null || true)
if [ -n "$ibtool_path" ] && "$ibtool_path" --warnings --errors --notices --output-format human-readable-text "$launch_screen" >/dev/null 2>&1; then
  pass 'LaunchScreen.storyboard Interface Builder validation'
else
  fail 'LaunchScreen.storyboard Interface Builder validation'
fi

display_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$info_plist" 2>/dev/null || true)
development_region=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDevelopmentRegion' "$info_plist" 2>/dev/null || true)
short_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist" 2>/dev/null || true)
bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist" 2>/dev/null || true)
assert_equal "$display_name" 'よていスナップ' 'CFBundleDisplayName'
assert_equal "$development_region" 'ja' 'CFBundleDevelopmentRegion'
assert_equal "$short_version" '$(MARKETING_VERSION)' 'CFBundleShortVersionString'
assert_equal "$bundle_version" '$(CURRENT_PROJECT_VERSION)' 'CFBundleVersion'

assert_xpath_count "$launch_screen" '/document[@launchScreen="YES"]' '1' 'LaunchScreen document is marked as a launch screen'
assert_xpath_count "$launch_screen" '//viewController' '1' 'LaunchScreen has exactly one view controller'
assert_xpath_count "$launch_screen" '//viewController/view[@key="view"]' '1' 'LaunchScreen has exactly one root view'
assert_xpath_count "$launch_screen" '//view' '1' 'LaunchScreen has exactly one basic view'
assert_xpath_count "$launch_screen" '/document[@initialViewController and string-length(@initialViewController) > 0]' '1' 'LaunchScreen initial view controller id is nonempty'
assert_xpath_count "$launch_screen" '/document[@initialViewController = //viewController/@id]' '1' 'LaunchScreen initial view controller id matches its controller'
assert_xpath_count "$launch_screen" '//viewController/view[@key="view" and @opaque="YES"]' '1' 'LaunchScreen root view is explicitly opaque'
assert_xpath_count "$launch_screen" '//viewController/view[@key="view"]/*[not(self::rect or self::autoresizingMask or self::viewLayoutGuide or self::color)]' '0' 'LaunchScreen root has no visual child objects'
assert_xpath_count "$launch_screen" '//label' '0' 'LaunchScreen has no labels'
assert_xpath_count "$launch_screen" '//image | //imageView | //*[@image]' '0' 'LaunchScreen has no images or logos'
assert_xpath_count "$launch_screen" '//*[@customClass or @customModule or @customModuleProvider]' '0' 'LaunchScreen has no custom classes'
assert_xpath_count "$launch_screen" '//userDefinedRuntimeAttributes | //userDefinedRuntimeAttribute' '0' 'LaunchScreen has no runtime attributes'
assert_xpath_count "$launch_screen" '//viewController/view[@key="view"]/color[@key="backgroundColor" and @systemColor="systemGroupedBackgroundColor"]' '1' 'LaunchScreen uses semantic system grouped background'
assert_xpath_count "$launch_screen" '/document/resources/systemColor[@name="systemGroupedBackgroundColor"]' '1' 'LaunchScreen declares the semantic system grouped background resource'
assert_xpath_count "$launch_screen" '/document/device/@appearance' '0' 'LaunchScreen does not force an appearance'
assert_not_contains "$launch_screen" 'よていスナップ' 'LaunchScreen has no product name'
assert_not_contains "$launch_screen" 'LifeSnap' 'LaunchScreen has no old brand'
assert_contains "$calendar_service" '— よていスナップで作成' 'Calendar attribution'
assert_contains "$upload_consent" 'よていスナップ' 'Upload consent brand'
assert_not_contains "$upload_consent" 'LifeSnap' 'Upload consent old brand removed'
assert_contains "$project_yml" 'MARKETING_VERSION: "1.1"' 'project.yml marketing version'
yml_build_count=$(grep -Ec '^[[:space:]]+CURRENT_PROJECT_VERSION:[[:space:]]+"6"[[:space:]]*$' "$project_yml" 2>/dev/null || true)
yml_build_key_count=$(grep -Ec '^[[:space:]]+CURRENT_PROJECT_VERSION:' "$project_yml" 2>/dev/null || true)
yml_team_count=$(grep -Ec '^[[:space:]]+DEVELOPMENT_TEAM:[[:space:]]+YMUG864233[[:space:]]*$' "$project_yml" 2>/dev/null || true)
yml_team_key_count=$(grep -Ec '^[[:space:]]+DEVELOPMENT_TEAM:' "$project_yml" 2>/dev/null || true)
yml_signing_count=$(grep -Ec '^[[:space:]]+CODE_SIGN_STYLE:[[:space:]]+Automatic[[:space:]]*$' "$project_yml" 2>/dev/null || true)
yml_signing_key_count=$(grep -Ec '^[[:space:]]+CODE_SIGN_STYLE:' "$project_yml" 2>/dev/null || true)
assert_equal "${yml_build_count}/${yml_build_key_count}" '1/1' 'project.yml build version'
assert_equal "${yml_team_count}/${yml_team_key_count}" '2/2' 'project.yml Team assignments'
assert_equal "${yml_signing_count}/${yml_signing_key_count}" '2/2' 'project.yml automatic signing assignments'
if node --input-type=module - "$project_yml" <<'NODE'
import fs from 'node:fs';

const projectPath = process.argv[2];
const lines = fs.readFileSync(projectPath, 'utf8').split(/\r?\n/);

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function isContent(line) {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

function blockEnd(start, parentIndent) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isContent(lines[index]) && indentation(lines[index]) <= parentIndent) {
      return index;
    }
  }
  return lines.length;
}

function stripInlineComment(value) {
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (doubleQuoted && character === '\\') {
      escaped = true;
      continue;
    }
    if (!doubleQuoted && character === "'") {
      singleQuoted = !singleQuoted;
      continue;
    }
    if (!singleQuoted && character === '"') {
      doubleQuoted = !doubleQuoted;
      continue;
    }
    if (!singleQuoted && !doubleQuoted && character === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function scalar(value) {
  const normalized = stripInlineComment(value).trim();
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function uniqueLine(pattern) {
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      matches.push(index);
    }
  }
  return matches.length === 1 ? matches[0] : -1;
}

function targetSettings(targetName) {
  const targetsStart = uniqueLine(/^targets:\s*(?:#.*)?$/);
  if (targetsStart < 0) {
    return null;
  }
  const targetsEnd = blockEnd(targetsStart, 0);
  const targetPattern = new RegExp(`^ {2}${targetName}:\\s*(?:#.*)?$`);
  const targetMatches = [];
  for (let index = targetsStart + 1; index < targetsEnd; index += 1) {
    if (targetPattern.test(lines[index])) {
      targetMatches.push(index);
    }
  }
  if (targetMatches.length !== 1) {
    return null;
  }

  const targetStart = targetMatches[0];
  const targetEnd = blockEnd(targetStart, 2);
  const settingsMatches = [];
  for (let index = targetStart + 1; index < targetEnd; index += 1) {
    if (/^ {4}settings:\s*(?:#.*)?$/.test(lines[index])) {
      settingsMatches.push(index);
    }
  }
  if (settingsMatches.length !== 1) {
    return null;
  }

  const settingsStart = settingsMatches[0];
  const settingsEnd = blockEnd(settingsStart, 4);
  const settings = new Map();
  for (let index = settingsStart + 1; index < settingsEnd; index += 1) {
    const match = lines[index].match(/^ {6}([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const values = settings.get(match[1]) ?? [];
    values.push(scalar(match[2]));
    settings.set(match[1], values);
  }
  return settings;
}

function hasExactSettings(targetName, expected) {
  const settings = targetSettings(targetName);
  return settings !== null && Object.entries(expected).every(([key, value]) => {
    const actual = settings.get(key) ?? [];
    return actual.length === 1 && actual[0] === value;
  });
}

const appValid = hasExactSettings('LifeSnapAction', {
  MARKETING_VERSION: '1.1',
  CURRENT_PROJECT_VERSION: '6',
  DEVELOPMENT_TEAM: 'YMUG864233',
  CODE_SIGN_STYLE: 'Automatic',
  PRODUCT_BUNDLE_IDENTIFIER: 'com.zll.lifesnapaction',
  API_BASE_URL: 'https://lifesnap-action-sxielk4wua-an.a.run.app',
  CODE_SIGN_ENTITLEMENTS: 'LifeSnapAction/LifeSnapAction.entitlements',
});
const testsValid = hasExactSettings('LifeSnapActionTests', {
  DEVELOPMENT_TEAM: 'YMUG864233',
  CODE_SIGN_STYLE: 'Automatic',
  PRODUCT_BUNDLE_IDENTIFIER: 'com.zll.lifesnapaction.tests',
});

process.exit(appValid && testsValid ? 0 : 1);
NODE
then
  pass 'project.yml target-scoped release settings'
else
  fail 'project.yml target-scoped release settings'
fi
assert_contains "$project_yml" 'exactVersion: 12.17.0' 'Firebase iOS SDK exact version'
assert_contains "$api_client" '/api/v2/extract' 'APIClient uses the attested v2 extract route'

if node --input-type=module - "$api_client" <<'NODE'
import fs from 'node:fs';

const apiClientPath = process.argv[2];
const source = fs.readFileSync(apiClientPath, 'utf8');
const normalized = source.replace(/\s+/g, ' ').trim();
const headerName = '"X-Firebase-AppCheck"';
const headerOccurrences = normalized.split(headerName).length - 1;
const assignments = [...source.matchAll(
  /request\.setValue\(\s*([^,]+?)\s*,\s*forHTTPHeaderField:\s*"X-Firebase-AppCheck"\s*\)/gs,
)];

const tokenSource =
  'let token: String do { token = try await tokenProvider.token() } catch {';
const trimmedTokenSource =
  'let trimmedToken = token.trimmingCharacters( in: .whitespacesAndNewlines )';
const validatedToken =
  'guard !trimmedToken.isEmpty, trimmedToken == token else {';

if (
  headerOccurrences !== 1 ||
  assignments.length !== 1 ||
  assignments[0][1].replace(/\s+/g, ' ').trim() !== 'trimmedToken' ||
  !normalized.includes(tokenSource) ||
  !normalized.includes(trimmedTokenSource) ||
  !normalized.includes(validatedToken)
) {
  process.exit(1);
}
NODE
then
  pass 'APIClient derives and validates a fresh token for its sole App Check header assignment'
else
  fail 'APIClient derives and validates a fresh token for its sole App Check header assignment'
fi

app_attest_environment=$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.devicecheck.appattest-environment' "$entitlements" 2>/dev/null || true)
assert_equal "$app_attest_environment" 'production' 'App Attest production entitlement'

google_bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$google_service_plist" 2>/dev/null || true)
google_project_id=$(/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' "$google_service_plist" 2>/dev/null || true)
google_app_id=$(/usr/libexec/PlistBuddy -c 'Print :GOOGLE_APP_ID' "$google_service_plist" 2>/dev/null || true)
google_sender_id=$(/usr/libexec/PlistBuddy -c 'Print :GCM_SENDER_ID' "$google_service_plist" 2>/dev/null || true)

assert_equal "$google_bundle_id" 'com.zll.lifesnapaction' 'Firebase plist bundle ID'
assert_equal "$google_project_id" 'zhang23-23' 'Firebase plist project ID'
assert_equal "$google_app_id" '1:788259830737:ios:a2f98135f554376697bef0' 'Firebase plist app ID'
case "$google_app_id" in
  "1:${google_sender_id}:ios:"*) pass 'Firebase app ID matches sender ID' ;;
  *) fail 'Firebase app ID matches sender ID' ;;
esac
if /usr/libexec/PlistBuddy -c 'Print :API_KEY' "$google_service_plist" 2>/dev/null \
  | grep -q '[^[:space:]]'; then
  pass 'Firebase plist API key is present (value redacted)'
else
  fail 'Firebase plist API key is present (value redacted)'
fi

marketing_count=$(grep -cF 'MARKETING_VERSION = 1.1;' "$pbxproj" 2>/dev/null || true)
build_count=$(grep -Ec '^[[:space:]]+CURRENT_PROJECT_VERSION = 6;$' "$pbxproj" 2>/dev/null || true)
build_key_count=$(grep -Ec '^[[:space:]]+CURRENT_PROJECT_VERSION = ' "$pbxproj" 2>/dev/null || true)
team_count=$(grep -Ec '^[[:space:]]+DEVELOPMENT_TEAM = YMUG864233;$' "$pbxproj" 2>/dev/null || true)
team_key_count=$(grep -Ec '^[[:space:]]+DEVELOPMENT_TEAM = ' "$pbxproj" 2>/dev/null || true)
signing_count=$(grep -Ec '^[[:space:]]+CODE_SIGN_STYLE = Automatic;$' "$pbxproj" 2>/dev/null || true)
signing_key_count=$(grep -Ec '^[[:space:]]+CODE_SIGN_STYLE = ' "$pbxproj" 2>/dev/null || true)
assert_equal "$marketing_count" '2' 'project.pbxproj marketing version occurrences'
assert_equal "${build_count}/${build_key_count}" '2/2' 'project.pbxproj build version occurrences'
assert_equal "${team_count}/${team_key_count}" '4/4' 'project.pbxproj Team assignment occurrences'
assert_equal "${signing_count}/${signing_key_count}" '4/4' 'project.pbxproj automatic signing occurrences'

if node --input-type=module - "$pbxproj" <<'NODE'
import { spawnSync } from 'node:child_process';

const pbxprojPath = process.argv[2];
const conversion = spawnSync('/usr/bin/plutil', [
  '-convert', 'json',
  '-o', '-',
  pbxprojPath,
], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (conversion.error || conversion.status !== 0) {
  process.exit(1);
}

let project;
try {
  project = JSON.parse(conversion.stdout);
} catch {
  process.exit(1);
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
if (!isRecord(project) || !isRecord(project.objects) || typeof project.rootObject !== 'string') {
  process.exit(1);
}

const rootObject = project.objects[project.rootObject];
if (
  !isRecord(rootObject) ||
  rootObject.isa !== 'PBXProject' ||
  !Array.isArray(rootObject.targets) ||
  rootObject.targets.length !== 2 ||
  new Set(rootObject.targets).size !== 2 ||
  rootObject.targets.some((targetId) => typeof targetId !== 'string')
) {
  process.exit(1);
}

const targetIdsByName = new Map();
for (const targetId of rootObject.targets) {
  const target = project.objects[targetId];
  if (!isRecord(target) || target.isa !== 'PBXNativeTarget' || typeof target.name !== 'string') {
    process.exit(1);
  }
  const ids = targetIdsByName.get(target.name) ?? [];
  ids.push(targetId);
  targetIdsByName.set(target.name, ids);
}

const requiredTargets = ['LifeSnapAction', 'LifeSnapActionTests'];
if (
  targetIdsByName.size !== requiredTargets.length ||
  requiredTargets.some((targetName) => (targetIdsByName.get(targetName) ?? []).length !== 1)
) {
  process.exit(1);
}

const targetAttributes = rootObject.attributes?.TargetAttributes;
const requiredTargetIds = requiredTargets.map((targetName) => targetIdsByName.get(targetName)[0]).sort();
if (
  !isRecord(rootObject.attributes) ||
  !isRecord(targetAttributes) ||
  JSON.stringify(Object.keys(targetAttributes).sort()) !== JSON.stringify(requiredTargetIds)
) {
  process.exit(1);
}

const requiredAttributeKeys = ['DevelopmentTeam', 'ProvisioningStyle'];
for (const targetId of requiredTargetIds) {
  const attributes = targetAttributes[targetId];
  if (
    !isRecord(attributes) ||
    JSON.stringify(Object.keys(attributes).sort()) !== JSON.stringify(requiredAttributeKeys) ||
    attributes.DevelopmentTeam !== 'YMUG864233' ||
    attributes.ProvisioningStyle !== 'Automatic'
  ) {
    process.exit(1);
  }
}
NODE
then
  pass 'project.pbxproj target-scoped TargetAttributes'
else
  fail 'project.pbxproj target-scoped TargetAttributes'
fi

if node --input-type=module - "$project_root/ios/LifeSnapAction.xcodeproj" <<'NODE'
import { spawnSync } from 'node:child_process';

const projectPath = process.argv[2];
const expectations = {
  LifeSnapAction: {
    MARKETING_VERSION: '1.1',
    CURRENT_PROJECT_VERSION: '6',
    DEVELOPMENT_TEAM: 'YMUG864233',
    CODE_SIGN_STYLE: 'Automatic',
    PRODUCT_BUNDLE_IDENTIFIER: 'com.zll.lifesnapaction',
    API_BASE_URL: 'https://lifesnap-action-sxielk4wua-an.a.run.app',
    CODE_SIGN_ENTITLEMENTS: 'LifeSnapAction/LifeSnapAction.entitlements',
  },
  LifeSnapActionTests: {
    DEVELOPMENT_TEAM: 'YMUG864233',
    CODE_SIGN_STYLE: 'Automatic',
    PRODUCT_BUNDLE_IDENTIFIER: 'com.zll.lifesnapaction.tests',
  },
};

let valid = true;
for (const [target, expected] of Object.entries(expectations)) {
  for (const configuration of ['Debug', 'Release']) {
    const result = spawnSync('/usr/bin/xcrun', [
      'xcodebuild',
      '-project', projectPath,
      '-target', target,
      '-configuration', configuration,
      '-showBuildSettings',
      '-json',
    ], {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120000,
    });

    if (result.error || result.status !== 0) {
      valid = false;
      continue;
    }

    let rows;
    try {
      rows = JSON.parse(result.stdout);
    } catch {
      valid = false;
      continue;
    }
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.target !== target) {
      valid = false;
      continue;
    }

    const settings = rows[0]?.buildSettings;
    if (
      settings === null ||
      typeof settings !== 'object' ||
      Object.entries(expected).some(([key, value]) => settings[key] !== value)
    ) {
      valid = false;
    }
  }
}

process.exit(valid ? 0 : 1);
NODE
then
  pass 'project.pbxproj effective target/config release settings'
else
  fail 'project.pbxproj effective target/config release settings'
fi

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
