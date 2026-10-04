# Hope

正在从 Electron 重构为 Tauri 2。**开工前先读 `docs/rebuild-plan.md`**，它是架构、数据模型、设计系统和阶段顺序的唯一权威来源。

## 硬性规则

- 技术栈按 rebuild-plan 第 2 节固定；不引入 Tailwind、d3、framer-motion、路由库。
- 所有颜色、间距、圆角、字号只能用 `src/styles/tokens.css` 里的变量；禁止硬编码色值。
- 活动颜色只能从 rebuild-plan 4.3 的 8 色板中取。
- 禁止渐变光斑背景、禁止 `!important`。
- 所有用户可见文案通过 i18next key，`zh-CN` 和 `en` 两个文件同步更新。
- Rust command 是数据唯一入口；前端不直接碰 SQLite。
- 新增 npm / crate 依赖要在 PR 说明里写清为什么不能自己写。
- `legacy/` 是旧 Electron 代码，只读，不修改、不构建、不导入。

## 工作方式

- 严格按 rebuild-plan 第 7 节的阶段顺序推进；一次只做一个阶段，每阶段结束 app 必须能跑并给用户演示。
- 做 UI 前先想"苹果原生 app 会怎么做"，不确定时选更克制的方案。
- 中文沟通，代码与注释用英文。

## 已经定死、不要重新讨论的决定

- 桌面 = Tauri 2；手机 + 手表 = 原生 Swift；云端 = Supabase。
- 数据模型（rebuild-plan 3.1）含 UUID 主键和同步三列，从第 1 阶段建表时就要有。
- 暂停 = 结束 session，恢复 = 新 session + `continues_id`，不另加暂停表。
- 子活动用 `activity.parent_id` 实现，只有一层，颜色随父（rebuild-plan 第 10 节 C）。时区枚举、activity_colors 表已删除。
- 睡眠不是 activity；每天实际起床 / 睡觉存 `day` 表。
- 周期计划到点生成真实 session，id 用确定性 UUID v5。
- 任何会丢数据的操作都必须有确认对话框。

## 遇到以下情况停下来问用户，不要自行决定

- 想增加或替换任何依赖。
- 想改数据模型、设计 token、色板。
- rebuild-plan 没写到、且会影响后续阶段的设计选择。

## 当前状态

- 阶段 1–6、6.5、6.6 已完成：桌面端功能齐全（Today / 本周 / 本月 / 日程 / 活动与子活动 / 记录编辑 / 起床睡觉 / 日记 / 设置与主题 / Overlay / JSON 导入导出），macOS dmg 与 Windows nsis 由 `.github/workflows/release.yml` 出包。
- 不做旧库直接导入；数据进出口只有 rebuild-plan 3.3 的 JSON 格式。
- 欠账：
  - Windows 版只在 CI 上编译通过，没在真机上运行过；Overlay 在 Windows 上没有逐卡模糊（CSS 半透明底）。
  - 安装包未签名、未公证（需要 Apple Developer ID）。
  - 版本号是 0.1.0，但仓库里有旧 Electron 时代的 `v1.0.0` tag；正式发版前要定版本号（建议 2.0.0）。
  - 本机 `tauri build` 生成 dmg 那一步报错（`bundle_dmg.sh`），`.app` 正常；原因未查。CI 上的 dmg 之前是成功的。
- 阶段 7（同步层，rebuild-plan 第 12 节）：桌面端代码已完成并提交，但**尚未对真实 Supabase 项目验证**——只通过了内存假服务端的单元测试，`supabase/schema.sql` 从未在 Postgres 上执行过，登录 / 钥匙串 / PostgREST 请求也没有真实跑过。开启步骤见 `supabase/README.md`。
- 阶段 8、9（`apple/`，说明见 `apple/README.md`）：一个 Xcode 工程 `Hope.xcodeproj`（iOS 18+ / watchOS 11+）+ 本地 Swift 包 `HopeCore`（SwiftData 存储、计时规则、同步协议的 Swift 移植，`swift test` 37 个测试）。
  - iPhone 是最小版：今天总时长 + 今日记录 + 开始/暂停/继续/结束 + 两级活动选择 + 账号；承载 Watch app，并通过 WatchConnectivity 把**另一个独立的登录会话**交给手表（refresh token 会轮换，不能共用）。
  - Watch：活动列表（今日总时长、两级）、计时页（大号跳秒、暂停/结束，暂停后继续/结束），直连 Supabase，无账号也能纯本地用。
  - 已验证：`swift test`；iOS / watchOS 通用设备编译（未签名）；iOS 与 watchOS 模拟器上开始 / 暂停 / 继续 / 结束 / 切换活动、中文界面。
  - **未验证**：真机安装（本机 Xcode 没登录 Apple ID，`-allowProvisioningUpdates` 报 "No Accounts"）；对真实 Supabase 的登录、同步、手机→手表交接（模拟器上没有建账号）；手表上文本输入（模拟器无法驱动）。
  - 偏离文档：没有 Live Activity、表盘复杂功能、底部 Tab；"今天"按自然日而不是起床/睡觉日；Apple 端不生成计划自动计入的记录；暂停状态只在本机（与桌面一致）。
- 下一步：用户建好 Supabase 项目后，按 `supabase/README.md` 配置并实测阶段 7；在 Xcode 登录 Apple ID 后把阶段 8/9 装到真机，实测手机→手表交接与三端收敛。Realtime（7b）先不做。
