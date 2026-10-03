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
文件   tauri-plugin-dialog（导入/导出的原生打开、存储面板）
图表   自写 SVG（环、柱），不引入 d3
动画   CSS transition 为主；framer-motion 不引入
i18n   i18next + react-i18next，文案在 src/locales/{zh-CN,en}.json
后端   Rust：rusqlite（bundled）+ serde + uuid（v4）；通过 tauri command 暴露，前端用 tauri-specta 生成类型化绑定
       ID 只在 Rust 侧生成，前端永远不造 ID
标识   App identifier `io.github.dan9574.hope`；iOS 用 `.ios` 后缀，Watch 由 Xcode 自动派生
macOS  开启 macOSPrivateApi（透明材质与 Overlay 需要），放弃 Mac App Store，dmg 分发
存储   SQLite，单文件，位于 app data 目录
日期   date-fns（tz 用系统时区，去掉 PST/Beijing 枚举）；一周固定从周一开始
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
- `plan.rule` 的星期用 ISO 编号：1=周一 … 7=周日，`'weekly:1,3,5'` = 一三五；`date` 为首个生效日。重复计划没有单次例外，修改/删除作用于整个系列。
- `journal` 每天一篇：同一 `date` 只保留一条存活记录（Rust 按 date upsert，不加唯一索引，以免同步时冲突）。
- `session.continues_id`：暂停后恢复，新 session 指向被暂停的那条；UI 把链上的几段显示成一条。
- "进行中"全局唯一：任何设备开始新 session 时，先结束所有 `end_ms IS NULL` 的记录（本地和服务端都执行这条规则）。
- 旧库的 `weekly_schedule_events` / `manual_study_plans` / `daily_instantiated_plans` 三张表合并为 `plan`。
- 旧库的 `activity_colors` 合并进 `activity`；`text_color` / `background_color` 删除，文字颜色由 token 决定。
- 子活动保留，但不单独建表：`activity.parent_id` 自引用，只允许一层。详见第 10 节（6.5 阶段）。
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
data.export / import   （格式见 3.3）
overlay.show / hide / set_position
```

### 3.3 导入 / 导出（唯一的数据进出口）

不做旧 Electron 库的直接导入。所有外部数据都先转成下面的 JSON，再走 `data.import`。

```json
{
  "format": "hope/1",
  "exported_at": 1760000000000,
  "activity": [{ "id": "…", "name": "Study", "color": "blue", "symbol": "book", "sort": 0, "archived_at": null, "parent_id": null, "updated_ms": 0 }],
  "session":  [{ "id": "…", "activity_id": "…", "start_ms": 0, "end_ms": 0, "note": "", "continues_id": null, "plan_id": null, "updated_ms": 0 }],
  "plan":     [{ "id": "…", "activity_id": "…", "date": "2026-10-02", "start_hm": "09:00", "end_hm": "11:00", "rule": null, "auto_log": true, "until": null, "updated_ms": 0 }],
  "journal":  [{ "id": "…", "date": "2026-10-02", "text": "", "updated_ms": 0 }]
}
```

规则：
- 第 6.5 阶段新增的 `parent_id`、`plan_id`、`auto_log`（缺省为 true）、`until` 都是可选字段，旧文件照常导入；格式名仍是 `hope/1`。
- `format` 版本号必须校验；`id` 缺失时导入端生成 UUID；`updated_ms` 缺失时取导入时刻。
- 导入是 upsert（按 `id`，后写的赢），重复导入同一份文件不会产生重复记录。
- `data.export` 输出完全相同的结构，保证导出 → 导入是无损往返。
- 以后要迁旧 Electron 数据，写一个独立脚本把 `timeglass.db` 转成这份 JSON 即可，不进主程序。

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

### 4.3.1 主题（Settings 里的三个选项，仅此三个）

1. 材质色温：Clear（默认，无色）/ Warm（叠 12% 的 #F5E6C8）/ Cool（叠 12% 的 #C8D8E6），同时作用于侧栏和内容区（见第 10 节 B）。
2. 强调色：从 4.3 的 8 色里选一个作为 `--accent`（默认 blue），影响按钮、选中态、当前时刻圆点。文字用派生的 `--accent-text`（浅色模式混 40% 黑，深色模式等于 `--accent`），保证低饱和色做文字时可读。
3. 环线宽：10px / 16px。

主题不改变布局、字体、圆角；禁止任何形式的渐变背景。

### 4.4 主窗口布局

- macOS：`titleBarStyle: Overlay`，交通灯内嵌；Windows：系统标题栏（不自绘）。
- 窗口必须真正透出壁纸：macOS 用 `transparent: true` + vibrancy（`sidebar` 材质给导航列，`under-window` 给内容区）；Windows 用 Mica / Acrylic。看起来是平灰色就是没配对，要修。
- 左侧 200px 导航列（材质更透），项：今天 / 本周 / 本月 / 活动 / 设置。无大卡片，一行一项，当前项淡色底。
- 右侧内容区最大宽 720px 居中。
- 页面标题 `--text-2xl` 600 字重，下方一行 `--fg-2` 副标题。

### 4.5 关键页面

**今天**：页面标题 + 日期；中间一个**开口向下的马蹄环**（规格见下）；下方时间线列表，每行 `时间段 · 活动 · 时长`，不加 LOGGED/SCHEDULED 徽章，计划用虚线左边条表示。

马蹄环规格：
- 弧度 300°，底部 60° 缺口代表睡眠。清醒时段 wake→sleep 映射到弧上，左下端 = wake，右下端 = sleep，端点外侧小字标时间（`--text-xs` `--fg-3`）。
- 直径 240–260px，线宽 10px，线端圆头。
- 底色：已过去部分 `--fg-3` 的 40%，未来部分 `--line`。记录按活动色实心着色；计划画成同色 40% 透明的段，叠在底色之上、记录之下。
- 当前时刻在弧上一个 8px 实心圆点（`--fg`）。
- 环中心：今日总时长大数字（`--text-3xl` tabular 600）+ 下方一行 `--fg-2` 小字"已记录"。页面顶部不再单独放这个数字。
- 空状态：弧上仍画计划；无计划时在列表位置显示一行 `--fg-3` 提示，不超过 12 个字。

**本周**：7 根堆叠柱，柱宽 24px，间距 16px，顶部数字；下方按活动汇总。

**本月**：7 列月历（周一起），每格：日期 + 当天总时长 + 一条按活动着色的细条（长度按当月最忙一天归一，未来日期不画）；下方按活动汇总。

本周 / 本月都可用标题右侧 ‹ › 翻看过去（不能翻到未来）；不在当前周期时出现「回到本周/本月」，标题改为相对时间（上周、3 个月前）。

**计划与日记**（不单独占导航）：都在今天页。时间线上方「+ 计划」，可选每周重复；点任一条计划可改/删。页底「今天的日记」文本框，自动保存。

**开始计时**：不在页面里。菜单栏 / 托盘图标点一下弹出活动列表，点即开始；再点即停。主窗口右上角也放一个同样的按钮。

## 5. Overlay 窗口（壁纸层记录）

- 独立 Tauri 窗口 `overlay`：`transparent: true, decorations: false, always_on_bottom: true, skip_taskbar: true, focusable: false`，`set_ignore_cursor_events(true)`。
- macOS 额外把 NSWindow level 设为 `kCGDesktopIconWindowLevel - 1`，让它位于桌面图标之下、壁纸之上。
- **模糊是原生的**：透明窗口里 CSS `backdrop-filter` 看不到壁纸。每张卡下面放一块原生 `NSVisualEffectView`（objc2），位置由页面量好后交给 Rust；卡片位置、尺寸、显隐任何变化都要重新量并同步底板。
- Windows：always-on-bottom + `window-vibrancy` crate 的 Acrylic / Mica 做底板模糊。在第 6 阶段打包时于 Windows 机器或 CI 上验证，之前不盲写。
- 默认停靠屏幕右侧，宽 320px，距右边 48px，垂直居中；设置里可拖动，「完成」时保存，另有「恢复默认」。
- 内容三块，竖排，每块是独立材质卡（原生模糊底板 + `rgba(255,255,255,0.14)` 填充，1px 白线 15%，圆角 `--r-lg`）：
  1. **Now**：进行中活动名 + 已持续时间（无进行中则显示"今天 · 总时长"）。
  2. **Today**：细环 + 前 3 个活动与时长。
  3. **This Week**：7 根细柱 + 本周总时长 + 与上周**同期**对比（本周一至此刻 vs 上周一至上周同一时刻）。
- 文字固定白色（85% / 55%），不随系统深浅色切换，因为它永远叠在壁纸上。
- 设置里可单独开关每一块、调整透明度（0.6–1.0）。**透明度只作用于卡片填充和文字，不作用于模糊底板**——底板一起淡化会透回清晰壁纸，就不像玻璃了。

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
3. **Overlay 窗口**：三张卡 + 位置/透明度设置。先在 macOS 上做到桌面图标之下，再做 Windows。
4. **本周 / 本月**。
5. **活动管理、计划、日记、设置**（含 4.3.1 主题、3.3 的导入/导出）。
6. **打包**：macOS dmg（arm64 + x64）、Windows nsis；GitHub Actions 出包。
   - 推 `v*` tag → `.github/workflows/release.yml` 先跑类型检查与 Rust 测试，再并行出三个包，放进草稿 Release；手动触发只上传 artifact。
   - 暂不签名（ad-hoc），macOS 首次打开需右键 → 打开；CI 里已预留 Developer ID 签名 + 公证的环境变量，补 Secrets 后取消注释即可。
   - macOS 最低 13.0。Windows 安装为当前用户（无需管理员）。
   - 欠账：Windows 上 Overlay 的逐卡模糊（需拆成每卡一窗），等有 Windows 真机再做；目前是 CSS 半透明底。
6.5 **修复与补全**（第 10 节）：滚动 bug、子活动、起床/睡觉、记录编辑与删除、周期安排自动计入、主题加强。**必须在同步层之前做完**，因为它改表结构。
7. **同步层**：Supabase 建表 + 桌面端 push/pull + 实时订阅（手表开始计时后 Overlay 卡片实时变化）。
8. **iPhone**：原生 Swift 工程，SwiftData 本地库 + 同步，Live Activity 显示进行中计时。
9. **Apple Watch**：watchOS target，表盘复杂功能 + 开始/暂停/结束。

## 8. 环境要求

- Rust stable（`rustup`）
- Node 20+
- macOS：Xcode 完整版（阶段 8、9 需要）
- Apple Developer Program（阶段 8、9 要长期装到真机、上 TestFlight 需要付费账号）
- Supabase 账号（阶段 7）
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

## 10. 阶段 6.5：修复与补全

来自第一轮真实使用的反馈。按 A → F 顺序做，每一项做完 app 能跑再做下一项。表结构改动全部放进一个迁移 `0002_*.sql`，并同步更新 3.3 的 JSON 格式（仍叫 `hope/1`，新字段都是可选的，旧文件照常能导入）。

### 10.0 表结构改动汇总（迁移 0002）

```sql
ALTER TABLE activity ADD COLUMN parent_id TEXT;            -- NULL = 顶层；非 NULL = 子活动，只允许一层
ALTER TABLE session  ADD COLUMN plan_id   TEXT;            -- 非 NULL = 由计划自动计入
ALTER TABLE plan     ADD COLUMN auto_log  INTEGER NOT NULL DEFAULT 1;   -- 到点自动计入
ALTER TABLE plan     ADD COLUMN until     TEXT;            -- 周期计划的最后一天（含），NULL = 一直重复

CREATE TABLE day (                                         -- 每天实际的起床 / 睡觉
  date        TEXT PRIMARY KEY NOT NULL,                   -- 起床那天的本地日期 'YYYY-MM-DD'
  wake_ms     INTEGER,                                     -- NULL = 用设置里的默认值
  sleep_ms    INTEGER,                                     -- NULL = 还没睡 / 用默认值
  utc_offset_min INTEGER NOT NULL,                         -- 当天所在时区，用于回看历史时显示当地时间
  updated_ms  INTEGER NOT NULL,
  deleted_ms  INTEGER,
  device_id   TEXT NOT NULL
);
```

### A. 窗口缩小后无法滚动（bug）

原因：`.shell` 是 grid，没写行高，隐式行按内容撑开；`.content` 是 flex 列但没有 `min-height: 0`，所以 `.content-scroll` 永远不会溢出，而 `body` 是 `overflow: hidden`，下面的内容被直接裁掉。

修复（`src/app/App.css`）：
- `.shell` 加 `grid-template-rows: minmax(0, 1fr)`。
- `.content` 和 `.sidebar` 加 `min-height: 0`；`.sidebar-list` 加 `overflow-y: auto`。
- 验收：窗口缩到最小尺寸（720×480），每个页面都能滚到底，弹出的编辑器也能完整操作。

### B. 主题加强

主题三项已经实现，但色温只有 4%，肉眼看不出来；这是规格定得太保守。
- 色温强度从 4% 提到 12%，并让它同时作用在侧栏和内容区。
- 新增「外观」选项：跟随系统 / 浅色 / 深色（`data-theme`，覆盖 `prefers-color-scheme`）。
- 强调色除按钮和选中态外，再作用于：Today 环上的当前时刻圆点、侧栏选中项的图标、PeriodNav 的"今天"标记。
- 仍然禁止渐变背景。

### C. 子活动

模型：`activity.parent_id`。只有一层；子活动没有自己的颜色，永远显示父活动的颜色（`color` 列写入时复制父值，读取时以父为准）。父活动归档时子活动一并隐藏。

行为：
- session 和 plan 的 `activity_id` 可以指向父（"学习"）也可以指向子（"学习 / 线性代数"）。
- 统计默认按父活动汇总；本周 / 本月的活动汇总行可以展开看子活动明细。
- 环和柱只用父颜色，不为子活动分色。
- 时间线、托盘、Overlay 的 Now 卡显示为 `父 · 子`。

界面：
- 活动页：父活动行下缩进显示子活动，行尾"＋"添加子活动；子活动可改名、归档、拖动排序，可移到另一个父活动下。
- 所有选择活动的地方（开始计时按钮、托盘菜单、计划编辑器、记录编辑器）改为两级：点父活动直接选父；有子活动的父活动行右侧有展开箭头，展开后选子。托盘用原生子菜单。

### D. 记录的编辑、补录、删除（都要确认）

现在时间线上的记录点不动，Rust 侧的 `session.upsert / delete` 没有界面入口。

- 时间线上的记录行可点击，打开记录编辑器：改活动（两级选择）、开始时间、结束时间、备注。保存前校验结束 ≥ 开始、不与其他记录重叠（重叠时提示并拒绝，不自动裁剪）。
- Today / 任意一天的工具栏加「补录」：手动添加一条过去的记录，用同一个编辑器。
- 「移到另一天」不单独做按钮：编辑器里的日期可以改。
- 删除：编辑器底部的删除按钮 → 原生确认对话框（`tauri-plugin-dialog` 的 `ask`），文案写明活动名和时间段。确认后软删除。
- 活动、计划、日记的删除同样走确认对话框。删除活动时提示它下面有多少条记录；有记录的活动只能归档，不能删除。
- 设置 → 数据 新增「清空全部数据」：必须输入 `DELETE` 才能点确认；清空前自动导出一份 JSON 到下载目录。
- 约定：**任何会丢数据的操作都必须有确认**；新增、修改不需要确认。

### E. 起床与睡觉

设置里的起床 / 睡觉时间只是默认值；每天的实际值存进 `day` 表。

- Today 页环的下方有一个按钮，只在对应的时间窗口内出现，避免白天误触：
  - **「起床」**：当天还没有 `wake_ms`，且现在早于"起床按钮截止时间"（默认 **08:30**）。点击写入 `wake_ms = now`。
  - **「睡觉」**：已起床未睡，且现在晚于"睡觉按钮开始时间"（默认 **21:00**）。点击写入 `sleep_ms = now`，并结束正在进行的计时。
  - **「撤销睡觉」**：已睡之后显示，点击清空 `sleep_ms`。
  - 窗口之外不显示按钮；这时要记录（起晚了、午后才想起来）就点环两端的时间标签手动改。
  - 两个时间点在 设置 → 作息 里可调，存为本机设置 `wake_button_until_hm`、`sleep_button_from_hm`，与默认起床 / 睡觉时间是四个独立的值。
- 托盘菜单同样有「起床 / 睡觉」一项，遵守相同的时间窗口。
- 点击环两端的时间标签可以直接改当天的起床 / 睡觉时间（起晚了事后补、忘按睡觉第二天补）。
- 跨午夜：`sleep_ms` 允许落在第二天；一"天"的范围是 `wake_ms → sleep_ms`，凌晨的记录归属于还没睡的那一天。若到了第二天默认起床时间仍没有 `sleep_ms`，按默认睡觉时间收尾。
- 环的范围 = `min(默认起床, 实际起床) → max(默认睡觉, 实际睡觉)`。范围内属于睡眠的部分（晚起的那段、早睡的那段）用 `--activity-purple` 40% 透明度画；按下「睡觉」后，环底部的缺口也变成同样的紫色，中心数字下方的小字改为"已休息"。Overlay 的 Today 卡同步这个状态。
- 睡眠不是一个 activity，不进入活动统计；但 Today 副标题显示昨晚睡了多久（今天 `wake_ms` − 昨天 `sleep_ms`）。
- 时区：所有时间存绝对毫秒，天然不受时区影响。`day.utc_offset_min` 记录当天所在时区，回看历史某天时用那天的时区显示钟点，而不是现在的；跨时区旅行当天以起床时所在时区为准。不做手动选时区。

### F. 周期安排与自动计入

周期计划（`rule = 'weekly:…'`）已能创建，但入口只在 Today 的"添加计划"，而且计划不会计入统计。

- 新增导航项「日程」（放在"本月"和"活动"之间）：一周七列的课表视图，每个周期计划是一个色块；点空白处新建，点色块编辑。一次可以勾选多天，所以"每周 10 节课"是几次操作的事。
- 周期计划编辑器增加「结束日期」（`plan.until`，可空）和「到点自动计入」开关（`plan.auto_log`，默认开）。
- 自动计入：计划的结束时间过去后，如果 `auto_log = 1` 且该时间段内没有任何手动记录，就生成一条真实的 `session`（`plan_id` 指向计划）。
  - **id 用确定性的 UUID v5**（由 `plan.id` + 日期算出），多台设备各自生成也只会得到同一条，不会重复。
  - 时间段内有部分手动记录时，只计入没被覆盖的部分。
  - 生成时机：app 启动时、每分钟一次、以及补算过去 30 天（应对 app 没开的日子）。
  - 用户删除一条自动计入的记录 = 那次课没上。因为是软删除、id 确定，它不会被重新生成。
  - 修改计划的时间只影响未来；已经生成的记录不改。
- 时间线上自动计入的记录带一个小的循环图标，其余与普通记录相同，同样可以编辑和删除。
- 还没到点的计划仍按现状显示为虚线段。
