# 「よていスナップ」图标、品牌名与 App Store 更新设计

日期：2026-07-30  
状态：用户已批准设计方向，待规格文件复核  
工作分支：`codex/lifesnap-apple-native-ui`

## 1. 真实目标

把当前带有渐变、光环、字母和闪光装饰的 AppIcon，替换成与已批准 Apple 原生 UI 一致的克制图标；同时把用户可见产品名改成容易理解、朗朗上口的日语名称「よていスナップ」，并以一个可审核的新版本更新日本区 App Store。

真实目标不是“换一张图片”，而是让用户在主屏和 App Store 上一眼理解：

> 拍下纸质通知，确认后加入日历。

## 2. 第一性原则

- 理解优先于装饰：图标先表达“书类变成日历”，再谈品牌个性。
- 风险控制优先于全面重命名：只更新用户可见品牌，不改 Bundle ID、工程目标、后端服务名或数据契约。
- 证据优先于发布乐观：本地构建、模拟器、归档、上传、App Store Connect 状态分别验收。
- 最小变更优先：本次不新增业务功能，不改变 `Scan → Consent → Review → Calendar` 主流程。

## 3. 已确认品牌

### 3.1 产品名

- 用户可见名称：`よていスナップ`
- App Store 日语名称：`よていスナップ`
- App Store 日语副标题：`紙の案内を予定に変える`
- 日历事件备注署名：`— よていスナップで作成`

### 3.2 保留的内部标识

以下内容不重命名：

- Xcode project / target / scheme：`LifeSnapAction`
- Swift 入口类型：`LifeSnapActionApp`
- Bundle ID：`com.zll.lifesnapaction`
- Cloud Run 后端地址及接口契约
- App Store Connect 现有 app record、Apple ID、SKU

这样可避免签名、历史版本、测试目标、后端与 App Store 记录断裂。

## 4. AppIcon 设计

### 4.1 选定方向

用户选择“方案 2：翻页转换”。

视觉参考：

`docs/superpowers/specs/assets/yotei-snap-icon-direction-2-reference.png`

### 4.2 正式图标规格

- 画布：1024 × 1024，完整不透明正方形；不预先烘焙圆角。
- 核心图形：一张暖白色通知书向右下翻页，翻页下露出蓝色日历网格与一个勾选。
- 构图：单一居中符号，占画布约 64%；四周保留足够光学留白。
- 色彩：Apple system blue 方向、暖白、深灰；不使用额外强调色。
- 层次：仅保留一层轻微、物理合理的纸张阴影。
- 小尺寸简化：文档正文最多三条线；日历网格减少；勾选保持最大辨识度。

### 4.3 明确去除

- 字母 `L`
- 星光、闪光、光环、同心圆
- 相机镜头、扫描框、机器人、脑图、魔法棒
- 霓虹、高光泛滥、过强悬浮感
- 装饰性渐变和多色阴影
- 小数字、文字、水印或品牌标识

### 4.4 iOS 资产

以正式 1024 主图为唯一母版，确定性缩放生成 `Contents.json` 当前声明的全部 17 个 PNG：

- iPhone：notification、settings、spotlight、app，2x/3x
- iPad：notification、settings、spotlight、app、Pro
- App Store marketing：1024 × 1024

所有文件必须：

- RGB/RGBA 图像内容最终为不透明；
- 无 alpha 透明角；
- 像素尺寸与 `Contents.json` 完全一致；
- 20px 下仍能辨认“纸张 + 日历勾选”。

## 5. 应用内品牌更新

### 5.1 必改

- `ios/LifeSnapAction/Info.plist`
  - `CFBundleDisplayName = よていスナップ`
  - `CFBundleDevelopmentRegion = ja`
- `ios/LifeSnapAction/Resources/LaunchScreen.storyboard`
  - 启动页文字改为 `よていスナップ`
- `ios/LifeSnapAction/Services/CalendarService.swift`
  - 日历事件备注署名改为新品牌
- `ios/LifeSnapAction/Views/UploadConsentView.swift`
  - 用户可见的服务主体名称改为 `よていスナップ`
  - Gemini、Google LLC、Cloud Run、传输与保存披露不得弱化

### 5.2 不做

- 不重命名文件夹、Swift 类型、Xcode target 或测试 target。
- 不把旧品牌字符串机械替换进历史发布证据。
- 不修改隐私行为、数据流、权限范围或 Gemini 使用方式。

## 6. 商店资料与版本

### 6.1 新版本

- `MARKETING_VERSION`：`1.1`
- `CURRENT_PROJECT_VERSION`：`4`
- 同时更新 `ios/project.yml` 与受版本控制的 `ios/LifeSnapAction.xcodeproj/project.pbxproj`

### 6.2 App Store Connect

在现有 app record 上创建 iOS 1.1：

- 日本语名称：`よていスナップ`
- 日本语副标题：`紙の案内を予定に変える`
- 更新日语说明文、关键词、版本更新内容和审核说明中的用户可见品牌
- 保留现有 Bundle ID、SKU、Apple ID、隐私标签和价格/可用地区，除非实时检查发现必须修正
- 产品页截图必须与本次 Apple 原生 UI 一致；现有截图若与当前 UI 不一致则替换

Apple 当前规则：

- App 名称为 2–30 个字符，副标题不超过 30 个字符。
- 已发布应用可在创建新版本或状态允许编辑时更改名称。
- App 名称和副标题支持本地化。

参考：

- [Apple App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Apple Create a new version](https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version/)
- [Apple Localize app information](https://developer.apple.com/help/app-store-connect/manage-app-information/localize-app-information/)

## 7. 发布流程

1. 生成正式图标母版，检查后生成 17 个尺寸。
2. 更新用户可见品牌、版本号和商店资料草案。
3. 运行完整 iOS 与后端回归。
4. 安装到模拟器，验收桌面图标、桌面名称、启动页和主流程。
5. 使用真实签名执行 Release archive 与验证。
6. 创建/更新 App Store Connect 1.1 元数据，上传 Build 4。
7. 绑定构建、填写审核信息并提交 App Review。
8. 记录提交后的真实状态；不把上传成功写成已通过审核或已上线。

## 8. 最小可验证交付

- 正式 1024 图标和 17 个正确尺寸的 AppIcon 文件
- 主屏图标与 `よていスナップ` 标签的模拟器截图
- 启动页和关键 UI 仍符合批准方案的截图
- `xcodebuild` 测试与 Release build 成功
- 后端 `npm test`、`npm run lint`、`npm run build` 成功
- Archive/validate/upload 的可审计结果
- App Store Connect 新名称、副标题、构建与提交状态的可审计结果

## 9. 预计修改文件

### 产品代码与资产

- `ios/LifeSnapAction/Resources/Assets.xcassets/AppIcon.appiconset/*.png`
- `ios/LifeSnapAction/Info.plist`
- `ios/LifeSnapAction/Resources/LaunchScreen.storyboard`
- `ios/LifeSnapAction/Services/CalendarService.swift`
- `ios/LifeSnapAction/Views/UploadConsentView.swift`
- `ios/project.yml`
- `ios/LifeSnapAction.xcodeproj/project.pbxproj`

### 商店与发布资料

- `docs/app-store/app-description-ja.md`
- `docs/app-store/app-description-en.md`
- `docs/app-store/app-review-notes.md`
- `docs/app-store/screenshot-plan.md`
- 新增 1.1 发布验收记录

历史 1.0 / Build 3 的事实证据不回写成 1.1。

## 10. 验收标准

- 图标在 1024、180、120、80、60、40、29、20 像素下均无糊边、裁切和不可辨识细节。
- `Contents.json` 引用的所有文件存在、尺寸正确且无透明像素。
- 主屏显示 `よていスナップ`，无截断。
- 启动页显示新名称，布局无裁切。
- 用户可见界面不再出现旧品牌；法律/技术披露仍准确。
- Bundle ID、工程 target、后端契约保持不变。
- 版本为 1.1 Build 4，并在两处工程配置一致。
- 所有本地测试与构建通过。
- App Store Connect 名称与副标题已保存，Build 4 已上传并绑定。
- 只有看到 App Review 的真实状态后才报告 `Submitted`、`Waiting for Review` 或其他状态。

## 11. 风险与护栏

- 名称占用：若 App Store Connect 拒绝 `よていスナップ`，停止并报告，不自行改名。
- 图标审核：不使用 Apple 商标、系统 App 图标或易造成官方关联的构图。
- 图标缩放：只从最终母版生成，禁止多次缩放。
- 签名与权限：未确认有效 distribution identity、provider 与 App Store Connect 权限前，不承诺上传成功。
- 隐私一致性：品牌重命名不得删除第三方 AI、图像传输、有限日志处理和不持久保存的披露。
- 外部状态：上传、提交、审核、上架是不同状态，分别记录。

## 12. 验证命令

```bash
plutil -lint ios/LifeSnapAction/Info.plist

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-test-derived \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=56C4DC85-0732-49CF-8389-10D16B2BBDC3' \
  -derivedDataPath /tmp/yotei-snap-release-derived \
  CODE_SIGNING_ALLOWED=NO \
  build -quiet

npm test
npm run lint
npm run build
git diff --check
git status --short --branch
```

Archive、validate、upload 与 App Store Connect 变更必须在实施计划中使用实时环境、显式目标和独立证据步骤，不在设计文档中假设凭据可用。
