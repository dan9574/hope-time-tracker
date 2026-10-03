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
- 子活动、时区枚举、activity_colors 表已删除，导入时按 3.3 映射。

## 遇到以下情况停下来问用户，不要自行决定

- 想增加或替换任何依赖。
- 想改数据模型、设计 token、色板。
- rebuild-plan 没写到、且会影响后续阶段的设计选择。

## 当前状态

- 阶段 1–3 已完成（Tauri 骨架、activity/session command、托盘、Today 视图、Overlay 窗口 macOS 版）。
- 不做旧库直接导入；数据进出口只有 rebuild-plan 3.3 的 JSON 格式。
- 欠账：Overlay 的 Windows 模糊底板，第 6 阶段打包时在 Windows 上补。
- 下一步：阶段 4（本周 / 本月）。
