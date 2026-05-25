# /list 会话视图交互模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/list` 改造为直接进入 Claude CLI agent-view 风格的会话交互模式——选中会话后全屏展示输出，底部固定输入框，用户直接与 Claude 对话，Esc 退出回选择列表。新增 `/enter` 命令专门进入全屏视图；`/select` 保留原始切换行为（不进入视图）。

**Architecture:** 新增 `src/repl/session-view.ts`，实现 `SessionView` 类：占用整个终端、顶部状态栏、中间滚动输出区、底部固定输入行；输入通过 `SessionManager.sendAndWait()` 发给 Claude 并捕获输出实时刷新；`repl.ts` 的 `/list` 和 `/enter` 命令接入 `SessionView.enter()`，`/select` 恢复仅切换行为。

**Tech Stack:** TypeScript 5.7，Node.js 25（ESM），Node.js 内置 raw mode stdin + ANSI 转义码（绝对定位 + 滚动区）+ chalk，`SessionManager`（已有）+ `StateDetector`（已有）

**命令运行：** `export PATH="$(cygpath -u "$PROGRAMFILES")/nodejs:$PATH"` 后直接用 `npm`

---

## 文件结构总览

```
src/repl/
├── session-view.ts     # NEW ✅ — SessionView：全屏会话交互视图
├── session-picker.ts   # MODIFIED ✅ — 增强版：详情视图 + 数字快速跳转
├── completer.ts        # MODIFIED ✅ — 新增 enter 命令定义（15 条，含 enter）
├── commands.ts         # MODIFIED ✅ — CommandName 新增 "enter"
└── repl.ts             # MODIFIED ✅ — /list /enter /select 全部更新

src/__tests__/repl/
└── session-view.test.ts  # NEW ✅ — SessionView 核心逻辑单测（4 tests）
```

---

## 交互布局（Claude CLI agent-view 风格）✅ 已实现

```
┌──────────────────────────────────────────────────────┐
│ [claude-0]  idle  /home/user/project    Esc 退出列表 │  ← 固定顶部状态栏（1行）
├──────────────────────────────────────────────────────┤
│                                                      │
│  Claude 的输出内容...                                 │  ← 滚动输出区（ANSI 滚动区）
│  ...                                                  │
│                                                      │
├──────────────────────────────────────────────────────┤
│ > 用户输入...                         [idle]         │  ← 固定底部输入行（1行）
└──────────────────────────────────────────────────────┘
```

---

## Task 1: SessionView 核心类 ✅ 已完成

- [x] `src/repl/session-view.ts` — SessionView 实现（`enter`、`handleSend`、ANSI 布局、raw mode）
- [x] `src/__tests__/repl/session-view.test.ts` — 4 个单测全 PASS
- [x] 修复：重入保护（`if (this.active) return;`）
- [x] 修复：formatInputLine ANSI 对齐（用 `status.length + 2` 代替 chalk 字符串长度）
- [x] commit: `29c899f`, `a9a01e5`

**实际与计划的差异：**
- 测试中 `sendMessage` → 实际实现为 `handleSend`（私有方法名不同，通过 `(view as any).handleSend` 访问）
- 添加了 `maxOutputLines = 500` 和截断逻辑

---

## Task 2: 命令更新 ✅ 已完成

### 实际实现（与原计划有调整）

- [x] `/list` — 直接进入选择器 → 全屏视图（与原计划一致）
- [x] `/enter [id]` — **新增命令**（原计划没有）— 进入全屏视图（无参数弹选择器，有参数直接进入）
- [x] `/select [id]` — **恢复原始行为**（原计划是进入视图，用户要求保留原始切换语义）
  - 无参数：弹出选择器，仅切换 currentSessionId，不进入视图
  - 有参数：直接切换 currentSessionId，不进入视图
- [x] `<id>` 命令实时候选 — `/send /kill /wait /read /attach /status /select /enter` 在空格后显示会话候选列表
- [x] Tab 键接受候选（命令名 or `/<cmd> <id>`）
- [x] `startStatusPoll` 防重复保护
- [x] `updateOverlayPrompt` 扩展：Case1（命令名）+ Case2（会话 ID 候选）
- [x] commit: `cb29d22`, `7d6eaf5`

---

## Task 3: 推送与冒烟验证 ✅ 已完成

- [x] 推送到 GitHub main 分支
- [x] 全量测试：**78 passed / 2 skipped**，0 failures
- [x] 构建：0 TypeScript 错误

### 验证流程（冒烟测试）

```bash
node dist/index.js
```

| 操作 | 预期行为 |
|------|----------|
| `/new` | 新建 claude-0 |
| `/list` | 全屏选择器 → Enter 选中 → 全屏交互视图 |
| 输入 `hello` → Enter | 发给 Claude，响应显示在输出区 |
| Esc | 退出视图，回到主 REPL |
| `/enter` | 弹选择器 → 选中 → 全屏视图 |
| `/enter claude-0` | 直接进入 claude-0 全屏视图 |
| `/select` | 弹选择器，仅切换（不进入视图），提示 `✓ 已切换到 claude-0` |
| `/select claude-0` | 直接切换（不进入视图），提示 `✓ 已切换到 claude-0` |
| `/kill ` (加空格) | 显示会话 ID 候选列表 |
| `/kill cl` | 过滤候选 |
| Tab | 接受当前高亮候选 |

---

## 遗留问题（已知限制）

1. **实时输出轮询延迟 1.5s** — SessionView 每 1.5s 轮询一次输出，Claude 响应完成后最多延迟 1.5s 才刷新界面。可通过 `sendAndWait` 的回调直接更新（已有响应回调路径）降低延迟。

2. **outputLines 轮询去重依赖字符串对比** — `out !== this.outputLines.join("\n")` 简单但不够精准，建议后续改为 hash 对比（与 StateDetector 一致）。

3. **session-view 无单测 waitForSettled 路径** — `enter()` 的完整 Promise 流程只能集成测试覆盖；单测只覆盖了辅助方法。

---

## 后续功能（Phase 3）

参见 `docs/superpowers/plans/2026-05-26-codex-opencode-adapters.md`（待创建）

- Codex CLI 适配器
- OpenCode CLI 适配器
- 会话历史持久化（`better-sqlite3`）
