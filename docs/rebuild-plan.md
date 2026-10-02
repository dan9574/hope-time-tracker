# Hope 重构方案（v2）

> 本文是重构的唯一权威来源。实现时遇到文档未覆盖的问题，按"更像苹果原生 app"的方向决定；遇到与本文冲突的旧代码，以本文为准。

## 1. 目标

| 诉求 | 方案 |
|---|---|
| macOS + Windows 桌面 | Tauri 2（Rust 内核 + WebView），包体 10–15MB |
| 后续 iPhone + Apple Watch | 原生 Swift 工程（iOS + watchOS 两个 target），见第 9 节 |
| 多设备共用一份数据 | Supabase 作为云端唯一真相，各端本地优先 + 同步，见第 9 节 |
| 苹果审美 | 自建设计系统（第 4 节），系统材质 + 克制色彩，无渐变光斑 |
| 壁纸层透明记录 | 独立 Overlay 窗口：透明、无边框、always-on-bottom、点击穿透（第 5 节） |
| 多语言 | i18next，`zh-CN` / `en` 起步，所有 UI 文案走 key |
| 历史数据不丢 | 一次性从旧 SQLite 导入（第 3.3 节） |

## 2. 技术栈（固定，不要换）

```
前端   React 18 + TypeScript (strict) + Vite
样式   原生 CSS + CSS 变量（设计 token），不用 Tailwind，不用 CSS-in-JS
状态   Zustand（只存 UI 状态；数据以 Rust 侧为准，前端通过 query 拉取）
路由   不用路由库；单窗口 + 一个 `view` 状态切换
图标   lucide-react（唯一图标来源）
图表   自写 SVG（环、柱），不引入 d3
动画   CSS transition 为主；framer-motion 不引入
i18n   i18next + react-i18next，文案在 src/locales/{zh-CN,en}.json
后端   Rust：rusqlite（bundled）+ serde + uuid（v4）；通过 tauri command 暴露，前端用 tauri-specta 生成类型化绑定
       ID 只在 Rust 侧生成，前端永远不造 ID
标识   App identifier `io.github.dan9574.hope`；iOS 用 `.ios` 后缀，Watch 由 Xcode 自动派生
macOS  开启 macOSPrivateApi（透明材质与 Overlay 需要），放弃 Mac App Store，dmg 分发
存储   SQLite，单文件，位于 app data 目录
日期   date-fns（tz 用系统时区，去掉 PST/Beijing 枚举）
```

依赖准则：每加一个 npm 包都要说明为什么不能用 50 行代码替代。

## 3. 数据模型

### 3.1 表

```sql
activity  (id, name, color, symbol, sort, archived_at, *sync)
session   (id, activity_id, start_ms, end_ms, note, continues_id, *sync)  -- end_ms NULL = 进行中
plan      (id, activity_id, date, start_hm, end_hm, rule, *sync)          -- rule: NULL=单次, 'weekly:1,3,5'=每周
journal   (id, date, text, *sync)
setting   (key, value)                                                     -- 仅本机，不同步

-- *sync = 每张可同步表都带这 3 列，从第一天就有：
--   updated_ms INTEGER NOT NULL   后写的赢
--   deleted_ms INTEGER            软删除，NULL = 存活
--   device_id  TEXT NOT NULL
```

说明：
- **所有 `id` 用 UUID v4 字符串**，不用自增整数，多设备离线写入不会冲突。
- `activity.color` 存色名（`'blue'` 等 8 个之一，CHECK 约束），不存 hex；hex 在 `tokens.css` 的 `--activity-*`。Supabase 表用同样的 CHECK。
- **表之间不加外键**：同步可能乱序到达。UI 和统计必须容忍孤儿记录——找不到 activity 的 session 显示为灰色"未知活动"，照常计入总时长。
- `session.continues_id`：暂停后恢复，新 session 指向被暂停的那条；UI 把链上的几段显示成一条。
- "进行中"全局唯一：任何设备开始新 session 时，先结束所有 `end_ms IS NULL` 的记录（本地和服务端都执行这条规则）。
- 旧库的 `weekly_schedule_events` / `manual_study_plans` / `daily_instantiated_plans` 三张表合并为 `plan`。
- 旧库的 `activity_colors` 合并进 `activity`；`text_color` / `background_color` 删除，文字颜色由 token 决定。
- `sub_activities` 删除。子活动在实践中只是备注，用 `session.note` 承载。
- `symbol` 存 SF Symbol 风格的图标名（前端用 Lucide 图标集映射）。

### 3.2 Rust command 清单（最小集）

```
activity.list / upsert / archive
session.start(activity_id) / pause() / resume() / stop() / current() / list(range) / upsert / delete
sync.push / sync.pull / sync.status
plan.list(range) / upsert / delete
journal.list(range) / upsert / delete
stats.day(date) / stats.week(date) / stats.month(date)
setting.get / set
data.export / import / import_legacy(path)
overlay.show / hide / set_position
```

### 3.3 旧数据导入

`import_legacy` 读取旧 Electron 的 `timeglass.db`（路径见旧 `electron/db.js`），映射：
- `activities` + `activity_colors` → `activity`
- `sessions`（含 sub_activity 名称拼进 note）→ `session`
- `weekly_schedule_events` → `plan` with rule
- `manual_study_plans` → `plan` 单次
- `journal` → `journal`
- `daily_schedule_settings` 最新一条 → `setting.wake_hm / sleep_hm`

首次启动检测到旧库则提示导入。

## 4. 设计系统

### 4.1 原则

1. **界面无色，内容有色。** 窗口、卡片、分隔线只用灰阶材质；颜色只属于"活动"。
2. **材质代替渐变。** 背景 = 半透明 + backdrop blur，透出壁纸。禁止 blur(200px) 光斑。
3. **层级靠字重和灰度，不靠框。** 卡片尽量不加边框，用 1px 10% 白线分隔即可。
4. **8pt 网格，连续圆角。** 间距只用 4 / 8 / 12 / 16 / 24 / 32 / 48。
5. **数字用等宽数字字形。** `font-variant-numeric: tabular-nums`，计时器不会抖。

### 4.2 Token（`src/styles/tokens.css`）

```css
:root {
  /* 字体 */
  --font-ui: -apple-system, "SF Pro Text", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  --font-display: -apple-system, "SF Pro Display", "Segoe UI Variable Display", "PingFang SC", sans-serif;
  --text-xs: 11px; --text-sm: 13px; --text-md: 15px; --text-lg: 17px;
  --text-xl: 22px; --text-2xl: 28px; --text-3xl: 40px;

  /* 圆角 */
  --r-sm: 8px; --r-md: 12px; --r-lg: 20px; --r-xl: 28px;

  /* 间距 */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-6: 24px; --s-8: 32px; --s-12: 48px;

  /* 材质（浅色） */
  --mat-window: rgba(246, 246, 248, 0.72);
  --mat-card:   rgba(255, 255, 255, 0.55);
  --mat-hover:  rgba(0, 0, 0, 0.04);
  --line:       rgba(0, 0, 0, 0.08);
  --blur:       saturate(180%) blur(28px);

  /* 文字 */
  --fg:   rgba(0, 0, 0, 0.88);
  --fg-2: rgba(0, 0, 0, 0.55);
  --fg-3: rgba(0, 0, 0, 0.32);

  --accent: #0A84FF;
}

@media (prefers-color-scheme: dark) {
  :root {
    --mat-window: rgba(28, 28, 30, 0.72);
    --mat-card:   rgba(255, 255, 255, 0.06);
    --mat-hover:  rgba(255, 255, 255, 0.06);
    --line:       rgba(255, 255, 255, 0.10);
    --fg:   rgba(255, 255, 255, 0.92);
    --fg-2: rgba(255, 255, 255, 0.58);
    --fg-3: rgba(255, 255, 255, 0.34);
  }
}
```

### 4.3 活动色板（低饱和、高明度，叠在壁纸上不脏）

```
blue    #6AA9FF   green   #5FD39A   orange  #FFAB6B   pink    #FF8FB8
purple  #B08CFF   teal    #5CD0D0   yellow  #F5D56A   gray    #A5A5AC
```

用户只能从这 8 个里选，不开放任意取色。

### 4.4 主窗口布局

- macOS：`titleBarStyle: Overlay`，交通灯内嵌；Windows：系统标题栏（不自绘）。
- 左侧 200px 导航列（材质更透），项：今天 / 本周 / 本月 / 活动 / 设置。无大卡片，一行一项，当前项淡色底。
- 右侧内容区最大宽 720px 居中。
- 页面标题 `--text-2xl` 600 字重，下方一行 `--fg-2` 副标题。

### 4.5 关键页面

**今天**：顶部大数字（今日总时长，`--text-3xl` tabular）；中间一个圆环（清醒时段 wake→sleep 展开为 360°，按活动着色，未记录留灰）；下方时间线列表，每行 `时间段 · 活动 · 时长`，不加 LOGGED/SCHEDULED 徽章，计划用虚线左边条表示。

**本周**：7 根堆叠柱，柱宽 24px，间距 16px，顶部数字；下方按活动汇总。

**开始计时**：不在页面里。菜单栏 / 托盘图标点一下弹出活动列表，点即开始；再点即停。主窗口右上角也放一个同样的按钮。

## 5. Overlay 窗口（壁纸层记录）

- 独立 Tauri 窗口 `overlay`：`transparent: true, decorations: false, always_on_bottom: true, skip_taskbar: true, focusable: false`，`set_ignore_cursor_events(true)`。
- macOS 额外把 NSWindow level 设为 `kCGDesktopIconWindowLevel - 1`，让它位于桌面图标之下、壁纸之上；Windows 用 always-on-bottom 即可。
- 默认停靠屏幕右侧，宽 320px，距右边 48px，垂直居中；位置在设置里可拖动调整后保存。
- 内容三块，竖排，每块是独立材质卡（`rgba(255,255,255,0.14)` + blur，1px 白线 15%，圆角 `--r-lg`）：
  1. **Now**：进行中活动名 + 已持续时间（无进行中则显示"今天 · 总时长"）。
  2. **Today**：细环 + 前 3 个活动与时长。
  3. **This Week**：7 根细柱 + 本周总时长 + 与上周对比。
- 文字固定白色（85% / 55%），不随系统深浅色切换，因为它永远叠在壁纸上。
- 设置里可单独开关每一块、调整整体透明度（0.6–1.0）。

## 6. 目录结构

```
hope/
  src-tauri/          Rust：db/、commands/、overlay.rs、tray.rs
  src/
    app/              App.tsx、窗口壳、导航
    overlay/          Overlay 窗口入口与三张卡
    views/            Today、Week、Month、Activities、Settings
    components/       Ring、Bars、Timeline、ActivityDot、Button…
    lib/              bindings.ts（specta 生成）、time.ts、stats.ts
    stores/           ui.ts
    styles/           tokens.css、base.css
    locales/          zh-CN.json、en.json
  legacy/             旧 Electron 代码整体移入，仅供导入参考，不再构建
```

## 7. 实施阶段

每阶段结束时 app 可运行、可演示，再进入下一阶段。

1. **骨架**：Tauri 2 项目初始化、tokens.css、主窗口壳 + 导航、Rust 建表、specta 绑定、i18n 接入。旧代码移入 `legacy/`。
2. **核心闭环**：activity / session 的 command；托盘开始/停止；Today 视图（数字 + 环 + 时间线）。
3. **旧数据导入**：`import_legacy` + 首次启动提示。
4. **Overlay 窗口**：三张卡 + 位置/透明度设置。先在 macOS 上做到桌面图标之下，再做 Windows。
5. **本周 / 本月**。
6. **活动管理、计划、日记、设置**。
7. **打包**：macOS dmg（arm64 + x64）、Windows nsis；GitHub Actions 出包。
8. **同步层**：Supabase 建表 + 桌面端 push/pull + 实时订阅（手表开始计时后 Overlay 卡片实时变化）。
9. **iPhone**：原生 Swift 工程，SwiftData 本地库 + 同步，Live Activity 显示进行中计时。
10. **Apple Watch**：watchOS target，表盘复杂功能 + 开始/暂停/结束。

## 8. 环境要求

- Rust stable（`rustup`）
- Node 20+
- macOS：Xcode 完整版（阶段 9、10 需要）
- Apple Developer Program（阶段 9、10 要长期装到真机、上 TestFlight 需要付费账号）
- Supabase 账号（阶段 8）
- Windows 打包：在 Windows 机器或 CI 上做

## 9. 多端与同步

### 9.1 为什么是两个代码库

watchOS app 只能用 Swift/SwiftUI 写，没有 WebView 路线；Windows 又不能用 iCloud/CloudKit。因此：

```
          ┌──────────────┐
          │  Supabase    │  Postgres + Realtime + Auth；云端唯一真相
          └──────┬───────┘
      ┌──────────┼───────────┐
      ▼          ▼           ▼
 Tauri 桌面   iPhone app   Apple Watch
 mac / Win   (Swift)      (Swift, 同一 Xcode 工程)
 SQLite      SwiftData    直接走网络，不依赖手机在旁
```

### 9.2 同步规则（所有端一致）

- 本地优先：每端有完整本地库，离线可用；联网后 push 本地变更、pull 远端变更。
- 以 `updated_ms` 判定，后写的赢。删除是软删除（`deleted_ms`），同步后再物理清理。
- 云端表结构与第 3.1 节完全相同，Supabase 的 `user_id` 列做行级权限。
- Realtime：各端订阅 `session` 表，收到变更即刷新"进行中"状态和当日统计。
- "进行中"全局唯一，规则见 3.1。

### 9.3 Apple Watch 交互

- 表盘复杂功能：当前活动名 + 已持续时间；无进行中则显示今日总时长。
- 打开 app：活动列表，点一下开始。
- 进行中界面：大数字计时 + 两个按钮 **暂停** / **结束**。
- 暂停 = 结束当前 session；恢复 = 同一活动开新 session 并设 `continues_id`。统计自然正确，暂停时长不计入。
- Watch 直接连 Supabase（Wi-Fi / 蜂窝 / 借手机网络），不走 WatchConnectivity 转发，逻辑更简单。

### 9.4 iPhone

- 与桌面同样的五个视图，但导航改为底部 Tab。
- Live Activity：进行中计时显示在灵动岛与锁屏，数据来源与 Watch 相同。
- Overlay 壁纸卡片在手机上对应为 WidgetKit 桌面小组件（Today / This Week 两种尺寸）。
