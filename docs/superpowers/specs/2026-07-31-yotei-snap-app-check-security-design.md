# 「よていスナップ」App Check 与生产接口成本护栏设计

日期：2026-07-31

状态：交互设计已获用户批准；等待书面规格复核

工作分支：`codex/lifesnap-apple-native-ui`

## 1. 真实目标

在不改变当前 Cloud Run 公网地址、不引入用户登录、不修改图片识别结果契约的前提下，使昂贵的 Gemini 图片识别只接受来自正式「よていスナップ」应用的可信请求，并以跨实例、失败关闭的每日配额限制最坏情况下的调用量。

本设计同时解决两项发布阻断：

1. Cloud Run 当前使用拥有广泛项目权限的默认 Compute Engine 服务账户；
2. 公网 `POST /api/extract` 没有应用证明、原子限流或全局调用上限。

这不是“让接口看起来更安全”。验收必须证明：伪造、重放、超额和配额状态不可确认的请求，都不会进入 Gemini 调用。

## 2. 第一性原则

- 风险控制优先于可用率：无法确认 App Check 或配额状态时拒绝请求，不降级放行。
- 真实成本边界优先于平均流量：以服务端原子计数作为硬调用量边界，不依赖客户端自律或单实例内存。
- 最小权限优先于方便部署：运行身份只拥有读取指定 Secret、验证 App Check token 和访问指定配额数据库所需权限。
- 兼容性优先于一次性切断：Build 4 进入受保护的新接口；Build 3 在严格全局上限下短期过渡。
- 隐私优先于精细画像：不建立用户账户，不保存图片或识别文本，只保存不可逆安装摘要和短期计数桶。
- 证据优先于状态声明：模拟器成功不等于 App Attest 成功；只有真实设备和真实生产配置证据才能通过发布门禁。

## 3. 已确认约束与决策

### 3.1 保持不变

- Cloud Run 服务：`lifesnap-action`
- GCP / Firebase 项目：`zhang23-23`
- 区域：`asia-northeast1`
- 公网地址：`https://lifesnap-action-sxielk4wua-an.a.run.app`
- iOS Bundle ID：`com.zll.lifesnapaction`
- Xcode project / target / scheme：`LifeSnapAction`
- 用户可见名称：`よていスナップ`
- 图片识别成功响应的现有 JSON 契约
- `Scan → Consent → Review → Calendar` 主流程

### 3.2 新增安全边界

- Build 4 调用 `POST /api/v2/extract`。
- `/api/v2/extract` 必须验证 Firebase App Check 的 Apple App Attest 凭证。
- 敏感识别接口使用 limited-use token，并在 Node.js 服务端消费 token 以检测重放。
- Firestore 原子事务执行安装级与服务级配额。
- Build 3 继续调用 `/api/extract`，但旧接口最多调用 Gemini 50 次/日。
- Cloud Run 使用新的用户管理运行服务账户，不再以默认 Compute Engine 服务账户运行。

### 3.3 已批准配额

以 `Asia/Tokyo` 日期作为每日边界：

| 范围 | 限额 | 强度 |
| --- | ---: | --- |
| Build 4 单安装 | 5 次/分钟 | 软限制 |
| Build 4 单安装 | 20 次/日 | 软限制 |
| Build 4 全局 | 500 次/日 | 硬限制 |
| Build 3 旧接口全局 | 50 次/日 | 硬限制 |

“单安装”依赖客户端 Keychain 中的随机标识。拥有真实、可运行应用的攻击者可能主动轮换该标识，因此它不是设备身份的密码学证明。App Check 降低伪造客户端风险，全局 500 次/日才是 Build 4 不可绕过的服务端调用量护栏。

两条接口合计最多允许 550 次 Gemini 调用/日。它是调用次数上限，不是固定日元金额；单次 Gemini 成本仍取决于实际输入和供应商计费。

## 4. 方案比较

### 4.1 选定方案：Firebase App Check + App Attest + Firestore

优点：

- 使用 Apple App Attest 证明请求来自真实应用实例；
- Firebase Admin SDK 提供标准 token 验证与消费接口；
- Firestore 事务可在多个 Cloud Run 实例间提供一致的配额判断；
- 保持现有 URL，无需负载均衡器、新域名或 Cloud Armor。

代价：

- 需要 Firebase 应用注册、Apple App Attest capability、iOS SDK 和真实设备验证；
- replay protection 当前为 beta，会为敏感接口增加一次网络往返；
- Firestore 与 App Check 成为失败关闭链路中的依赖。

### 4.2 未选：直接实现 Apple App Attest 协议

它能提供更细控制，但需要自行维护挑战、证明、断言、密钥状态和异常恢复。安全关键代码与长期维护面显著增加，不符合本次最小可验证目标。

### 4.3 未选：安装令牌或静态 API Key

这类凭证可以从应用包或运行时提取，不能证明请求来自可信应用实例。即使附加限流，也无法关闭当前发布审查指出的应用身份缺口。

## 5. 总体架构

### 5.1 iOS 客户端

Build 4 新增以下独立组件：

- `AppCheckProviderFactory`
  - Debug 构建：Firebase Debug Provider；
  - 非 Debug 构建：仅 `AppAttestProvider`；
  - 必须在 `FirebaseApp.configure()` 之前注册。
- `AppCheckTokenProvider`
  - 每次识别取得 `limitedUseToken()`；
  - 不把 token 放入 URL、日志或持久化存储。
- `InstallationIdentifierStore`
  - 首次运行生成随机 UUID；
  - 保存于 Keychain；
  - 重装后允许形成新的安装身份，不尝试跨重装追踪用户。
- `APIClient`
  - Build 4 发送到 `/api/v2/extract`；
  - 使用 `X-Firebase-AppCheck` 传递 token；
  - 使用 `X-LifeSnap-Install-ID` 传递安装标识；
  - 不自动重试可能已进入 Gemini 的请求。

Release target 增加 App Attest capability，并将 entitlement 环境设为 `production`。项目部署目标是 iOS 17，因此不使用 DeviceCheck fallback。Simulator 只能通过明确的 Debug 构建与注册过的 Debug token 测试；正式构建无法取得 App Attest 时必须失败关闭。

Firebase Apple SDK 通过 Swift Package Manager 接入。实现计划必须固定一个经过构建验证的版本并提交解析结果，不使用浮动分支。Firebase 配置属于项目标识而非服务端秘密，但仍需检查只对应 `zhang23-23` 与 `com.zll.lifesnapaction`，并限制其中 API key 的适用应用。

### 5.2 Cloud Run 后端

后端拆分为清晰边界：

- App Check 验证器：读取 header、验证项目与 app ID、消费 limited-use token；
- 安装标识摘要器：验证 UUID 格式，使用独立 Secret 中的 HMAC key 计算不可逆摘要；
- 配额存储：用 Firestore 事务检查并递增分钟、每日和全局计数；
- 图片验证器：保持 10 MB 上限和 JPEG/PNG/WebP allowlist；
- 提取服务：复用当前 Gemini 调用和结果 schema；
- 路由适配器：分别组合 Build 4 安全链路和 Build 3 旧版限额链路。

`/api/v2/extract` 的中间件顺序必须是：

1. 建立请求 ID 并设置 `Cache-Control: no-store`；
2. 验证并消费 App Check token；
3. 验证安装标识格式；
4. 解析受大小限制的 multipart 图片；
5. 验证 MIME 与必要字段；
6. 原子占用配额；
7. 调用 Gemini；
8. 校验并返回现有成功响应 schema。

凭证失败发生在图片解析和 Gemini 之前。图片格式失败发生在配额占用之前。配额一旦占用不退款：如果 Gemini 或网络随后失败，保守多计一次比潜在超出成本上限更安全。

### 5.3 公网边界

Cloud Run 的 `allUsers → roles/run.invoker` 暂时保留，因为当前 URL 必须继续直接服务 iOS、`/health` 和 `/privacy`。公开可达不再等同于可以执行 Gemini：

- `/health`、`/healthz`、`/privacy` 继续公开；
- `/api/v2/extract` 由 App Check 与配额保护；
- `/api/extract` 仅在迁移期公开，并由 50 次/日的服务端全局配额保护。

本方案不把 Cloud Run IAM 身份认证误用为消费者 iOS 身份认证，也不新增客户端可提取的长期服务凭证。

## 6. App Check 规则

### 6.1 客户端

- Firebase 应用注册必须精确对应 `com.zll.lifesnapaction`。
- Release/TestFlight/App Store 使用 Apple App Attest provider。
- Debug Provider 只能通过编译条件进入 Debug target。
- Debug token 只在本地开发控制台登记，不提交仓库、不写入配置文件或日志。
- 每次识别使用 limited-use token；普通可复用 token 不得用于 `/api/v2/extract`。

### 6.2 服务端

服务端使用 Firebase Admin SDK：

```text
verifyToken(appCheckToken, { consume: true })
```

只有同时满足以下条件才继续：

- token 签名、issuer、audience 和期限有效；
- token 的 app ID 与批准的 Firebase iOS app ID 完全一致；
- `alreadyConsumed` 不为 `true`。

缺少或无效 token 返回 `401`；app ID 不匹配返回 `403`；已消费 token 返回 `401`。这些请求不得读取配额、解析图片或调用 Gemini。

App Check replay protection 当前为 beta，且增加网络延迟。本设计只在昂贵的 `/api/v2/extract` 使用，不扩展到 `/health` 或 `/privacy`。

## 7. 安装摘要与 Firestore 数据模型

### 7.1 安装摘要

客户端 header 只接受规范 UUID。服务端通过独立 Secret `lifesnap-installation-hmac-key` 执行：

```text
HMAC-SHA256(secret, canonical_installation_uuid)
```

Firestore 和日志均不得保存原始 UUID。HMAC key 不得由 Gemini API key 派生或复用。轮换 HMAC key 会重置安装级配额身份，因此只能在明确的安全处置或迁移计划下执行。

### 7.2 数据库

创建 Firestore Native mode 命名数据库：

- database ID：`lifesnap-quota`
- location：`asia-northeast1`

位置选择是不可随意回退的基础设施决定；实施前必须再次读取当前数据库清单，确认不会与现有资源冲突。运行服务账户的 `roles/datastore.user` 使用 IAM Condition 约束到：

```text
projects/zhang23-23/databases/lifesnap-quota
```

### 7.3 计数文档

建议逻辑键如下：

```text
install_minute/{install_hmac}:{epoch_minute}
install_day/{install_hmac}:{yyyy-mm-dd-asia-tokyo}
service_day/v2:{yyyy-mm-dd-asia-tokyo}
service_day/legacy:{yyyy-mm-dd-asia-tokyo}
```

每个文档只含：

- `count`
- `bucket_start`
- `expires_at`
- `updated_at`

不保存 app token、图片、识别文本、事件字段或原始安装标识。

一次 v2 请求在同一 Firestore 事务中读取并检查安装分钟、安装日、v2 全局日三个文档，全部未达到上限才一起递增。旧接口只事务更新 legacy 全局日文档。全局文档是低流量热点；在已批准的 500 次/日规模下，不引入分片计数器，因为分片会削弱精确硬上限。

分钟桶在桶开始 24 小时后逻辑过期；每日桶在桶开始 30 天后逻辑过期，并通过 TTL 清理。TTL 物理删除可能延迟，因此验收关注 `expires_at` 的逻辑失效，不把后台删除即时性作为配额正确性条件。

### 7.4 故障一致性

- Firestore 事务冲突：按 SDK 的有界事务重试处理；
- 事务最终失败：返回 `503`，不调用 Gemini；
- 配额已占用后进程崩溃：保留计数，不补偿；
- 禁止以进程内 Map、Cloud Run 实例数或日志聚合作为生产配额来源；
- 测试替身只能由显式测试依赖注入，生产环境不得存在 permissive fallback。

## 8. HTTP 契约与日语错误

成功响应保持当前 `ExtractionResponse` schema。v2 新增明确的错误状态：

| HTTP | 稳定错误码 | 条件 | iOS 行为 |
| ---: | --- | --- | --- |
| 400 | `INSTALLATION_ID_INVALID` | 安装标识缺失或格式错误 | 显示重新启动后再试 |
| 401 | `APP_CHECK_REQUIRED` | token 缺失 | 显示安全确认失败 |
| 401 | `APP_CHECK_INVALID` | token 无效或已过期 | 仅允许刷新 token 后重试一次 |
| 401 | `APP_CHECK_REPLAYED` | token 已消费 | 不自动重试识别 |
| 403 | `APP_ID_FORBIDDEN` | app ID 不匹配 | 显示应用版本不可用 |
| 413 | `IMAGE_TOO_LARGE` | 超过 10 MB | 引导选择更小图片 |
| 415 | `UNSUPPORTED_IMAGE_TYPE` | 非 JPEG/PNG/WebP | 引导选择支持格式 |
| 429 | `INSTALL_RATE_LIMITED` | 5 次/分钟 | 根据 `Retry-After` 稍后再试 |
| 429 | `INSTALL_DAILY_LIMITED` | 20 次/日 | 显示今日次数已用完 |
| 429 | `SERVICE_DAILY_LIMITED` | v2 500 次/日或旧版 50 次/日 | 显示服务今日繁忙 |
| 503 | `SECURITY_SERVICE_UNAVAILABLE` | App Check/Firestore 状态不可确认 | 显示稍后再试 |

所有提取路由的成功与错误响应都设置：

```text
Cache-Control: no-store
```

`429` 返回与实际桶边界一致的 `Retry-After`。客户端不得自动重试 `429`、`503` 或可能已调用 Gemini 的网络失败。只有明确发生在 Gemini 之前的 `APP_CHECK_INVALID` 可以强制刷新 token 后重试一次，并必须取得新的 limited-use token。

旧接口保留现有 Build 3 可见错误契约；新增的 legacy 全局配额耗尽时使用 `429`。v2 的 `413/415` 改进不回写成破坏 Build 3 的状态码变更。

## 9. 日志、监控与隐私

允许的结构化日志字段：

- request ID
- route category：`v2` 或 `legacy`
- HTTP status 与稳定错误码
- latency
- image MIME 与字节数
- quota bucket category
- App Check 验证结果类别
- `gemini_invoked` 布尔值
- 模型名称和结果 route

禁止记录：

- 图片或 base64
- Gemini 原始响应
- 提取出的标题、日期、地点或备注
- App Check token、Debug token
- 原始安装 UUID 或完整 HMAC 摘要
- Gemini API key 或 HMAC key

配额达到 70%、90% 和 100% 时写入单次结构化监控事件。100% 事件必须对应后续请求被硬拒绝。外部通知渠道不在本次范围内；若当前项目已有通知渠道，实施计划可在不新增收件人的前提下接入。

## 10. 最小权限运行身份

创建专用用户管理服务账户，例如：

```text
lifesnap-runtime@zhang23-23.iam.gserviceaccount.com
```

运行时只授予：

- `roles/secretmanager.secretAccessor`
  - 分别在 `lifesnap-gemini-api-key` 和 `lifesnap-installation-hmac-key` Secret 资源上授予；
- `roles/firebaseappcheck.tokenVerifier`
  - 项目级，用于消费 App Check token；
- `roles/datastore.user`
  - 项目策略中使用 IAM Condition，只允许 `lifesnap-quota` 数据库。

不授予运行身份：

- `roles/editor`
- `roles/run.admin`
- `roles/iam.serviceAccountUser`
- `roles/artifactregistry.writer`
- `roles/cloudbuild.builds.builder`
- `roles/storage.objectAdmin`
- Secret 管理或版本写入权限

部署身份与运行身份必须分离。部署者可以只在该运行账户上获得部署所需的 `iam.serviceAccounts.actAs`，但运行账户本身没有部署权限。Cloud Run 使用 Application Default Credentials，不创建服务账户 JSON key，也不设置 `GOOGLE_APPLICATION_CREDENTIALS`。

当前默认 Compute Engine 服务账户可能服务于同项目其他工作负载。本次只解除它与 `lifesnap-action` Cloud Run runtime 的绑定，不在缺少调用方清单时删除其项目级权限。

## 11. Build 3 → Build 4 迁移

### 11.1 部署顺序

1. 只读盘点 Firebase、Firestore、IAM、Apple capability 和当前 Cloud Run 状态。
2. 在 `zhang23-23` 注册现有 iOS app，创建 App Check 配置和 `lifesnap-quota` 数据库。
3. 创建 HMAC Secret、专用运行账户和最小 IAM binding。
4. 构建同时支持 `/api/extract` 与 `/api/v2/extract` 的后端镜像。
5. 以零流量候选修订部署，使用候选 URL 验证公开端点、无 token 拒绝、无效 token 拒绝和 Firestore 失败关闭。
6. 使用真实设备、Release 配置和候选 URL 完成一次有效 App Attest + Gemini 冒烟。
7. 仅在候选全部通过后把 100% 流量切到兼容后端。
8. 生产 URL 再验证 `/health`、`/privacy`、legacy 有界调用与 v2 有效调用。
9. 之后才允许 Build 4 进入 TestFlight/App Review 流程。

后端必须先于 Build 4 发布。Build 4 发布后，回退目标只能是仍支持 `/api/v2/extract` 的已验证修订；不得回退到当前不含 v2 的旧生产修订。

### 11.2 旧接口关闭门禁

`/api/extract` 只有同时满足以下条件才可关闭：

- Build 4 已公开上线至少 30 天；
- 旧接口请求量连续 7 天低于全部识别请求的 5%；
- 没有未解决的 App Attest 兼容事故；
- 关闭动作获得独立实施授权并记录前后证据。

第 60 天仍未达标时必须人工复核；不得默认无限期保留，也不得自动关闭。关闭后返回稳定升级提示，不把旧请求转发到 v2。

## 12. 回退与故障处理

- App Check 或 Firestore 短暂故障：保持失败关闭，显示日语稍后重试提示；
- 配额配置错误：回退到上一个“支持 v2 且配额正确”的 Cloud Run 修订；
- iOS App Attest 配置错误：停止 Build 4 分发或提交，不通过放宽后端验证来补救；
- Debug Provider 泄漏到非 Debug 构建：立即阻断发布，撤销 Debug token，重新构建；
- HMAC Secret 丢失或误轮换：安装级配额身份重置，但全局硬上限继续有效；
- Firestore 区域或数据库创建冲突：停止基础设施变更并报告，不创建第二个替代数据库；
- 生产冒烟失败：不切流；若已切流，则回到最近兼容修订并保留证据。

任何回退都不得：

- 跳过 App Check；
- 把配额改成内存计数；
- 恢复默认高权限 runtime；
- 暴露 Secret；
- 把测试 Debug token作为生产兼容方案。

## 13. 测试策略

### 13.1 后端单元测试

通过依赖注入的假 App Check 验证器、假配额存储和假 Gemini client 覆盖：

- token 缺失、无效、app ID 不匹配、已消费；
- 所有凭证失败都证明 Gemini 调用次数为 0；
- 安装标识格式与 HMAC 确定性；
- 5 次/分钟、20 次/日、500 次/日和 legacy 50 次/日边界；
- 日期按 `Asia/Tokyo` 正确换日；
- 事务冲突重试与最终失败关闭；
- MIME、大小、缺图错误不占用 v2 识别配额；
- Gemini 已进入后的失败仍保留计数；
- v1/v2 成功结果 schema 一致；
- v1/v2 所有分支都有 `Cache-Control: no-store`；
- 日志脱敏。

### 13.2 Firestore 集成测试

持续集成与本地集成测试固定使用 Firestore Emulator；零流量候选阶段再验证真实 `lifesnap-quota` 数据库与 IAM。覆盖：

- 并发请求不会突破三个计数边界；
- 事务原子更新三个 v2 文档；
- legacy 与 v2 全局桶相互独立；
- 数据库不可达或权限被拒时为 `503`，Gemini 调用次数为 0；
- 生产配置不能选择内存替身。

测试证据不能把 Emulator 通过写成生产 Firestore 已验证。

### 13.3 iOS 测试

- provider factory 在 Debug 与非 Debug 配置下选择正确；
- Release 配置不引用 Debug Provider；
- Keychain 安装标识创建、复用与损坏恢复；
- `/api/v2/extract` 请求包含两个安全 header；
- token 获取失败时不发网络请求；
- `401/403/413/415/429/503` 映射为简洁日语；
- 只有 `APP_CHECK_INVALID` 可使用新 token 自动重试一次；
- 其他失败不自动重复 Gemini 请求；
- 当前识别成功模型、确认页和日历流程回归。

### 13.4 真实环境测试

- 全新真实设备上的 Release/TestFlight 构建取得 App Attest token；
- 有效 limited-use token 成功调用候选和生产 v2；
- 同一 token 再次提交被拒，且第二次不调用 Gemini；
- 缺 token、伪造 token 和错误 app ID 的请求不调用 Gemini；
- Cloud Run 实际 runtime identity 是专用账户；
- 专用账户没有禁止的广泛角色；
- Secret binding 只覆盖两个指定 Secret；
- Firestore IAM Condition 只覆盖 `lifesnap-quota`；
- 生产流量 100% 指向已验证兼容修订；
- 当前公网 URL 不变。

真实设备 App Attest 冒烟是发布硬门禁，模拟器、Debug Provider、单元测试或健康检查都不能替代。

## 14. 验收标准

只有以下项目全部满足，才能解除安全发布阻断：

- Build 4 非 Debug 产物只使用 App Attest，entitlement 为 production；
- Debug token 不存在于仓库、构建产物、Cloud Run 配置或日志；
- v2 缺失、无效、不匹配和重放 token 均无法触发 Gemini；
- Firestore 并发测试证明配额不超发；
- v2 全局最多 500 次/日，legacy 最多 50 次/日；
- App Check/Firestore 不可确认时 fail closed；
- Cloud Run 使用专用最小权限服务账户；
- 成功响应契约、当前 URL、`/health`、`/privacy`、日语名称和苹果风格图标保持不变；
- 所有提取响应使用 `Cache-Control: no-store`；
- 日志和 Firestore 不包含禁止的数据；
- 后端测试、lint、build、iOS 测试与 Release build 全部通过；
- 零流量候选、真实设备 App Attest 和生产冒烟均有脱敏证据；
- Git diff、Git status、镜像来源、Cloud Run revision、traffic 和 IAM 状态已复核。

完成本地代码与测试不等于完成生产配置；完成生产配置也不等于已经获得 App Store 发布授权。

## 15. 预计修改范围

### 15.1 后端代码与测试

- `server.ts`
- `src/security/` 下新增 App Check 与安装摘要组件
- `src/quota/` 下新增 Firestore 配额组件
- `src/shared/__tests__/` 下新增或扩展服务端测试
- `package.json`
- `package-lock.json`
- `.env.example`
- `cloudbuild.yaml` 或部署脚本中与明确 runtime 配置有关的最小修改

### 15.2 iOS 代码与配置

- `ios/LifeSnapAction/App/LifeSnapActionApp.swift`
- `ios/LifeSnapAction/Services/APIClient.swift`
- `ios/LifeSnapAction/Services/` 下新增 App Check 与 Keychain 组件
- `ios/LifeSnapAction/LifeSnapAction.entitlements`
- `ios/LifeSnapAction/GoogleService-Info.plist`
- `ios/project.yml`
- `ios/LifeSnapAction.xcodeproj/project.pbxproj`
- `ios/LifeSnapActionTests/AppFlowCoordinatorTests.swift` 或聚焦的新测试文件
- Swift Package 解析文件

### 15.3 文档与验证

- `docs/release/yotei-snap-v1.1-app-store-release-gate.md`
- `docs/app-store/app-review-notes.md`
- 新增脱敏安全验证记录
- 必要的 release validator

### 15.4 基础设施状态

- Firebase iOS app / App Check 注册
- Firestore `lifesnap-quota`
- HMAC Secret
- 专用 Cloud Run runtime service account
- 精确 Secret、App Check、Firestore IAM binding
- 新 Cloud Run revision 与流量切换

任何实施计划发现的新调用方、测试或基础设施超出上述路径与资源时，先列清单并请求范围扩展，不直接修改。

## 16. 明确不在范围内

- 新域名、负载均衡器、Cloud Armor 或禁用当前 `run.app` 地址；
- 用户账户、Firebase Authentication、订阅或支付；
- 修改 Gemini prompt、模型选择或识别业务规则；
- UI、图标、产品名或主流程继续改版；
- 项目内其他工作负载的默认服务账户权限清理；
- 自动关闭旧接口；
- 自动提交 App Store 或自动发布；
- 以本次配额代替 GCP Billing budget 或供应商费用监控。

## 17. 风险与护栏

- App Attest 配额或兼容性：采用 Build 3/Build 4 分阶段迁移，并以真实设备验收；
- replay protection beta：仅用于昂贵端点，记录延迟，不扩展到公开静态端点；
- 安装 ID 可轮换：明确视为软限制，以全局事务计数承担硬边界；
- Firestore 热点：当前 500 次/日规模使用单全局文档以换取精确上限，扩容必须重新设计；
- Firestore 位置不可随意变更：创建前再次确认 `asia-northeast1`；
- IAM 条件配置错误：候选 revision 使用专用 runtime 实测读 Secret、验 token、写配额；不因权限错误扩大角色；
- 旧接口仍公开：50 次/日硬限制先于 Build 4 发布，60 日人工复核防止永久遗留；
- 自动重试导致重复成本：除明确的 token 预调用失败外，客户端不自动重试；
- 隐私漂移：日志、数据库和错误体均通过测试检查禁止字段。

## 18. 验证命令类别

实施计划必须给出显式、可审计命令，至少覆盖：

```bash
npm test
npm run lint
npm run build
npm run validate:ios-release

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -sdk iphonesimulator \
  build

git diff --check
git status --short --branch
```

还必须包含脱敏的只读验证：

- Firebase iOS app 与 App Check provider；
- Firestore database ID、location、type 与 TTL；
- Cloud Run revision 的 service account、Secret 引用、generation 与 traffic；
- runtime service account 的项目、Secret 与条件 IAM binding；
- 候选和生产 `/health`、`/privacy`、v2 拒绝路径；
- 真实设备有效 token 与 replay 拒绝；
- Gemini 调用前后日志证据，但不输出 token、Secret、图片或识别文本。

基础设施创建、IAM 修改、部署、切流和 App Store 操作必须分开记录。健康检查成功只证明传输可达，不能替代 App Check、配额、真实设备或产品发布验收。

## 19. 官方依据

- [Firebase：Apple 客户端为自定义后端发送 App Check token](https://firebase.google.com/docs/app-check/ios/custom-resource)
- [Firebase：在 Apple 平台使用 App Attest provider](https://firebase.google.com/docs/app-check/ios/app-attest-provider)
- [Firebase：自定义后端验证与消费 App Check token](https://firebase.google.com/docs/app-check/custom-resource-backend)
- [Cloud Run：使用用户管理的最小权限服务身份](https://docs.cloud.google.com/run/docs/securing/service-identity)
- [Firestore：创建命名数据库与按数据库条件授权](https://cloud.google.com/firestore/docs/manage-databases)
