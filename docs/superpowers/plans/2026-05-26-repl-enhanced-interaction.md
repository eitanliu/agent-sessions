# REPL Enhanced Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参照 Claude CLI 官方交互模式，为 agent-sessions REPL 增加输入 `/` 后的实时命令建议、Tab 补全、方向键导航选择、Ctrl+C 中止、Ctrl+L 清屏等完整交互体验。

**Architecture:** 新增 `completer.ts` 集中管理命令定义与补全逻辑；修改 `repl.ts` 挂载 readline `completer` 函数实现 Tab 补全，并通过 `readline.emitKeypressEvents` 监听实时按键实现 `/` 建议叠加层（suggestion overlay）；建议叠加层在输入行下方打印最多 6 条匹配命令，用 ANSI 转义码控制清除/重绘，与 readline 解耦。

**Tech Stack:** TypeScript 5.7，Node.js 25（ESM），vitest 3，chalk 5，Node.js 内置 `readline`（completer + keypress），无新依赖

**命令运行方式（Windows/MSYS2，先执行 `export PATH="$(cygpath -u "$PROGRAMFILES")/nodejs:$PATH"`）：**
- 测试：`npm test`
- 构建：`npm run build`
- git：`$(command -v git)`

---

## 文件结构总览

```
src/repl/
├── completer.ts        # NEW — CommandDef + COMMAND_DEFS + completeLine() + getMatches()
├── commands.ts         # MODIFY — 导入并重用 COMMAND_DEFS，保持 parseCommand/HELP_TEXT
├── renderer.ts         # MODIFY — 新增 renderSuggestions() 和 clearSuggestionLines()
└── repl.ts             # MODIFY — 挂载 completer，添加 keypress 监听，处理快捷键

src/__tests__/repl/
├── commands.test.ts    # 已存在（不改动）
└── completer.test.ts   # NEW — completeLine/getMatches 测试
```

---

## Task 1: 命令定义结构化（completer.ts）

**Files:**
- Create: `src/repl/completer.ts`
- Create: `src/__tests__/repl/completer.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/repl/completer.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { getMatches, completeLine, COMMAND_DEFS } from "../../repl/completer.js";

describe("COMMAND_DEFS", () => {
  it("has 14 entries, each with name/description/usage", () => {
    expect(COMMAND_DEFS.length).toBe(14);
    for (const def of COMMAND_DEFS) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.usage).toBeTruthy();
    }
  });
});

describe("getMatches", () => {
  it("returns all commands for empty input", () => {
    expect(getMatches("").length).toBe(14);
  });

  it("returns prefix matches (case insensitive)", () => {
    const m = getMatches("ne");
    expect(m.map(d => d.name)).toContain("new");
  });

  it("returns substring matches", () => {
    const m = getMatches("ro");
    const names = m.map(d => d.name);
    expect(names).toContain("route");
    expect(names).toContain("routes");
    expect(names).toContain("unroute");
  });

  it("prefix match ranks before substring match", () => {
    const m = getMatches("r");
    expect(m[0].name).toBe("read"); // first alphabetically among prefix matches
  });

  it("returns empty for no match", () => {
    expect(getMatches("zzz")).toEqual([]);
  });

  it("limits results to 6", () => {
    expect(getMatches("").length).toBeLessThanOrEqual(6);
  });
});

describe("completeLine", () => {
  it("returns no completions for non-command input", () => {
    const [completions, line] = completeLine("hello");
    expect(completions).toEqual([]);
    expect(line).toBe("hello");
  });

  it("returns completions for / prefix", () => {
    const [completions, line] = completeLine("/");
    expect(completions.length).toBeGreaterThan(0);
    expect(line).toBe("/");
  });

  it("returns filtered completions for partial command", () => {
    const [completions, line] = completeLine("/ne");
    expect(completions).toContain("/new");
    expect(line).toBe("/ne");
  });

  it("returns empty when command already complete and has trailing space", () => {
    const [completions] = completeLine("/new ");
    expect(completions).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test 2>&1 | tail -8
```

期望：FAIL，`Cannot find module '../../repl/completer.js'`

- [ ] **Step 3: 创建 `src/repl/completer.ts`**

```typescript
export interface CommandDef {
  name: string;
  description: string;
  usage: string;
}

export const COMMAND_DEFS: CommandDef[] = [
  { name: "new",     description: "新建 Claude 会话",           usage: "/new [workdir]" },
  { name: "list",    description: "列出所有会话",               usage: "/list" },
  { name: "select",  description: "切换当前操作的会话",         usage: "/select <id>" },
  { name: "send",    description: "向指定会话发送消息",         usage: "/send <id> <prompt>" },
  { name: "wait",    description: "等待会话完成（变为空闲）",   usage: "/wait <id>" },
  { name: "read",    description: "读取会话最新输出",           usage: "/read [id]" },
  { name: "status",  description: "查看会话状态",               usage: "/status [id]" },
  { name: "route",   description: "添加路由规则",               usage: "/route add <from> <to>" },
  { name: "routes",  description: "列出路由规则",               usage: "/routes" },
  { name: "unroute", description: "删除路由规则",               usage: "/unroute <rule-id>" },
  { name: "attach",  description: "显示 mintty attach 命令",    usage: "/attach <id>" },
  { name: "kill",    description: "销毁会话",                   usage: "/kill <id>" },
  { name: "help",    description: "显示帮助信息",               usage: "/help" },
  { name: "exit",    description: "退出程序",                   usage: "/exit" },
];

const MAX_SUGGESTIONS = 6;

/**
 * 按 partial 过滤命令：前缀匹配优先，其次子串匹配，最多返回 MAX_SUGGESTIONS 条。
 */
export function getMatches(partial: string): CommandDef[] {
  const lower = partial.toLowerCase();
  if (!lower) return COMMAND_DEFS.slice(0, MAX_SUGGESTIONS);

  const prefix: CommandDef[] = [];
  const substr: CommandDef[] = [];

  for (const def of COMMAND_DEFS) {
    if (def.name.startsWith(lower)) prefix.push(def);
    else if (def.name.includes(lower)) substr.push(def);
  }

  return [...prefix, ...substr].slice(0, MAX_SUGGESTIONS);
}

/**
 * readline-compatible completer 函数。
 * 输入以 "/" 开头时补全命令名，否则返回空。
 */
export function completeLine(line: string): [string[], string] {
  if (!line.startsWith("/")) return [[], line];

  // 命令名后有空格（进入参数部分）→ 不补全
  const parts = line.slice(1).split(" ");
  if (parts.length > 1) return [[], line];

  const partial = parts[0].toLowerCase();
  const matches = getMatches(partial);
  const completions = matches.map(d => `/${d.name}`);
  return [completions, line];
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test 2>&1 | tail -15
```

期望：completer 全部 PASS，其余测试无回归

- [ ] **Step 5: 提交**

```bash
GIT="$(command -v git)"
cd /d/code/ai/agent-sessions
"$GIT" add src/repl/completer.ts src/__tests__/repl/completer.test.ts
"$GIT" -c core.quotepath=false commit -m "feat: 命令定义结构化与补全逻辑（completer.ts）"
```

---

## Task 2: Tab 补全接入 readline

**Files:**
- Modify: `src/repl/repl.ts:22-28`（`readline.createInterface` 调用处）
- Modify: `src/repl/commands.ts`（更新 HELP_TEXT 使用 COMMAND_DEFS）

- [ ] **Step 1: 修改 `src/repl/commands.ts`**

将 `HELP_TEXT` 改为从 `COMMAND_DEFS` 动态生成（避免两处维护命令列表），并重新导出 `COMMAND_DEFS`：

```typescript
import { COMMAND_DEFS } from "./completer.js";
export { COMMAND_DEFS } from "./completer.js";

export type CommandName =
  | "help" | "list" | "new" | "kill" | "select"
  | "send" | "read" | "status" | "wait"
  | "route" | "routes" | "unroute" | "attach" | "exit";

export interface ParsedCommand {
  name: CommandName;
  args: string[];
  raw: string;
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).trim().split(/\s+/);
  return { name: parts[0] as CommandName, args: parts.slice(1), raw: trimmed };
}

export const HELP_TEXT = (() => {
  const lines = COMMAND_DEFS.map(d => `  ${d.usage.padEnd(32)}${d.description}`);
  return [
    "Commands:",
    ...lines,
    "",
    "直接输入（不以 / 开头）→ 发送到当前选中会话",
    "快捷键：Ctrl+C 中止操作  Ctrl+L 清屏  Esc Esc 清空输入",
  ].join("\n");
})();
```

- [ ] **Step 2: 修改 `src/repl/repl.ts`，给 readline 挂载 completer**

将 `readline.createInterface(...)` 调用替换为：

```typescript
import { completeLine } from "./completer.js";

// 在构造函数内：
this.rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: buildPrompt(undefined),
  terminal: true,
  completer: (line: string) => completeLine(line),
});
```

- [ ] **Step 3: 运行全量测试（无回归）**

```bash
npm test 2>&1 | tail -10
```

期望：全部 PASS

- [ ] **Step 4: 提交**

```bash
GIT="$(command -v git)"
"$GIT" add src/repl/repl.ts src/repl/commands.ts
"$GIT" -c core.quotepath=false commit -m "feat: 接入 readline completer，Tab 键补全命令"
```

---

## Task 3: 实时 `/` 建议叠加层（Suggestion Overlay）

参照 Claude Code 官方实现：输入 `/` 后实时显示过滤后的命令建议列表（最多 6 条），方向键导航，Tab/Enter 接受，Esc 关闭。

**Files:**
- Modify: `src/repl/renderer.ts`（新增 `renderSuggestions`、`clearSuggestionLines`）
- Modify: `src/repl/repl.ts`（添加 keypress 监听 + overlay 管理）

- [ ] **Step 1: 修改 `src/repl/renderer.ts`，添加建议渲染函数**

在文件末尾追加：

```typescript
export interface SuggestionItem {
  name: string;
  description: string;
  usage: string;
}

/**
 * 在当前行下方打印建议列表，返回打印的行数（用于后续清除）。
 * 高亮 selectedIdx 对应行。
 */
export function renderSuggestions(
  items: SuggestionItem[],
  selectedIdx: number,
  inputPartial: string,
): number {
  if (items.length === 0) return 0;
  process.stdout.write("\n");
  for (let i = 0; i < items.length; i++) {
    const selected = i === selectedIdx;
    const prefix = selected ? chalk.cyan("❯ ") : "  ";
    const name = selected ? chalk.bold.cyan(`/${items[i].name}`) : chalk.dim(`/${items[i].name}`);
    const desc = chalk.dim(items[i].description);
    const usage = selected ? chalk.dim(`  ${items[i].usage}`) : "";
    process.stdout.write(`${prefix}${name.padEnd(selected ? 12 : 12)}${desc}${usage}\n`);
  }
  // 返回打印的行数（1 个空行 + items.length 行）
  return 1 + items.length;
}

/**
 * 向上清除 n 行（用于擦除之前的建议叠加层）。
 */
export function clearSuggestionLines(n: number): void {
  for (let i = 0; i < n; i++) {
    process.stdout.write("\x1b[1A\x1b[2K"); // 上移一行 + 清除
  }
}
```

- [ ] **Step 2: 修改 `src/repl/repl.ts`，添加建议叠加层逻辑**

在 `InteractiveREPL` 类中新增以下私有成员和方法：

```typescript
// 新增私有成员（在 prevStatuses 下方）：
private suggestionLines = 0;   // 当前显示的建议行数
private suggestionIdx = 0;     // 当前高亮的建议项索引
private suggestionItems: import("./renderer.js").SuggestionItem[] = [];
private keypressHandler: ((str: string, key: any) => void) | null = null;
```

在 `start()` 方法的 `this.rl.on("line", ...)` 之前，调用新方法：

```typescript
this.setupKeypressOverlay();
```

新增 `setupKeypressOverlay()` 方法：

```typescript
private setupKeypressOverlay(): void {
  readline.emitKeypressEvents(process.stdin, this.rl);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  this.keypressHandler = (str: string, key: any) => {
    if (!key) return;
    const line = (this.rl as any).line as string ?? "";

    // Ctrl+L: 清屏
    if (key.ctrl && key.name === "l") {
      process.stdout.write("\x1b[2J\x1b[H");
      this.clearOverlay();
      this.rl.prompt(true);
      return;
    }

    // Esc: 关闭建议叠加层（第一次 Esc）或清空输入行（连按两次由 readline 处理）
    if (key.name === "escape" && !key.ctrl) {
      this.clearOverlay();
      return;
    }

    // 建议层打开时，方向键 ↑↓ 导航
    if (this.suggestionLines > 0) {
      if (key.name === "up") {
        this.clearOverlay();
        this.suggestionIdx = Math.max(0, this.suggestionIdx - 1);
        this.showOverlay(line);
        return;
      }
      if (key.name === "down") {
        this.clearOverlay();
        this.suggestionIdx = Math.min(this.suggestionItems.length - 1, this.suggestionIdx + 1);
        this.showOverlay(line);
        return;
      }
      // Tab 或 Return: 接受当前高亮项
      if (key.name === "tab" || key.name === "return") {
        if (this.suggestionItems[this.suggestionIdx]) {
          const chosen = `/${this.suggestionItems[this.suggestionIdx].name} `;
          this.clearOverlay();
          // 清空当前 readline 行并写入选中命令
          (this.rl as any).line = chosen;
          (this.rl as any).cursor = chosen.length;
          readline.clearLine(process.stdout, 0);
          process.stdout.write("\r" + (this.rl as any).getPrompt() + chosen);
        }
        return;
      }
    }

    // 实时更新：当前行以 / 开头且不含空格 → 显示/更新建议层
    if (line.startsWith("/") && !line.includes(" ")) {
      this.clearOverlay();
      this.suggestionIdx = 0;
      this.showOverlay(line);
    } else if (this.suggestionLines > 0) {
      // 行不再是命令输入 → 清除建议层
      this.clearOverlay();
    }
  };

  process.stdin.on("keypress", this.keypressHandler);
}

private showOverlay(line: string): void {
  const { getMatches } = require("./completer.js") as typeof import("./completer.js");
  const partial = line.startsWith("/") ? line.slice(1) : "";
  this.suggestionItems = getMatches(partial);
  if (this.suggestionItems.length === 0) return;
  const { renderSuggestions } = require("./renderer.js") as typeof import("./renderer.js");
  this.suggestionLines = renderSuggestions(this.suggestionItems, this.suggestionIdx, partial);
}

private clearOverlay(): void {
  if (this.suggestionLines > 0) {
    const { clearSuggestionLines } = require("./renderer.js") as typeof import("./renderer.js");
    clearSuggestionLines(this.suggestionLines);
    this.suggestionLines = 0;
  }
}
```

在 `stop()` 方法中清理 keypress 监听：

```typescript
stop(): void {
  if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  if (this.keypressHandler) {
    process.stdin.removeListener("keypress", this.keypressHandler);
    this.keypressHandler = null;
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  this.rl.close();
}
```

在 `handleLine` 开头清除建议层（每次 Enter 后）：

```typescript
private async handleLine(input: string): Promise<void> {
  this.clearOverlay();
  if (!input) return;
  // ... 其余不变
```

- [ ] **Step 3: 修复 ESM import（替换 require 为静态导入）**

由于项目是 ESM，`require()` 不可用。在 `repl.ts` 顶部已经导入了 `completeLine`，需要额外导入 `getMatches`、`renderSuggestions`、`clearSuggestionLines`：

将 `showOverlay` 和 `clearOverlay` 中的 `require(...)` 改为使用已导入的函数：

在文件顶部补充导入：
```typescript
import { getMatches } from "./completer.js";
import { renderSuggestions, clearSuggestionLines, type SuggestionItem } from "./renderer.js";
```

然后将 `showOverlay` 方法中的 require 替换：
```typescript
private showOverlay(line: string): void {
  const partial = line.startsWith("/") ? line.slice(1) : "";
  this.suggestionItems = getMatches(partial);
  if (this.suggestionItems.length === 0) return;
  this.suggestionLines = renderSuggestions(this.suggestionItems, this.suggestionIdx, partial);
}

private clearOverlay(): void {
  if (this.suggestionLines > 0) {
    clearSuggestionLines(this.suggestionLines);
    this.suggestionLines = 0;
  }
}
```

并移除 `keypressHandler` 属性的类型注解中 `SuggestionItem[]` 引用（改为直接导入类型）：
```typescript
private suggestionItems: SuggestionItem[] = [];
```

- [ ] **Step 4: 构建验证**

```bash
npm run build 2>&1 | tail -10
```

期望：0 TypeScript 错误，`dist/` 生成

- [ ] **Step 5: 运行全量测试**

```bash
npm test 2>&1 | tail -15
```

期望：全部 PASS（建议叠加层不需要额外单测，由构建验证覆盖）

- [ ] **Step 6: 提交**

```bash
GIT="$(command -v git)"
"$GIT" add src/repl/repl.ts src/repl/renderer.ts
"$GIT" -c core.quotepath=false commit -m "feat: 实时 / 建议叠加层，方向键导航，Tab 接受"
```

---

## Task 4: Ctrl+C 中止与启动信息优化

**Files:**
- Modify: `src/repl/repl.ts`（添加 SIGINT 处理 + 优化启动信息）

- [ ] **Step 1: 修改 `start()` 方法，添加 SIGINT 处理和优化启动信息**

将 `start()` 开头的打印替换为：

```typescript
start(): void {
  process.stdout.write("\x1b[2J\x1b[H"); // 清屏
  console.log(
    chalk.bold("agent-sessions") +
    chalk.dim(" v0.1.0 — 多窗口 Claude 会话管理器")
  );
  console.log(chalk.dim("━".repeat(50)));
  console.log(
    chalk.dim("  /") + chalk.white("new") + chalk.dim(" 新建会话  ") +
    chalk.dim("  /") + chalk.white("help") + chalk.dim(" 查看所有命令  ") +
    chalk.dim("  Tab") + chalk.dim(" 补全命令")
  );
  console.log(chalk.dim("━".repeat(50)) + "\n");

  this.setupKeypressOverlay();
  this.setupRouterListener();
  this.startStatusPoll();
  this.refreshPrompt();

  this.rl.on("line", async (line) => {
    await this.handleLine(line.trim());
    this.refreshPrompt();
  });

  // Ctrl+C: 若有当前会话则中止操作（不退出），无会话则退出
  this.rl.on("SIGINT", () => {
    this.clearOverlay();
    if (this.currentSessionId) {
      console.log(chalk.yellow("\n  (Ctrl+C) 已清空输入。使用 /exit 退出程序。"));
      // 清空当前输入行
      (this.rl as any).line = "";
      (this.rl as any).cursor = 0;
      this.refreshPrompt();
    } else {
      console.log(chalk.dim("\n  再见"));
      this.stop();
      process.exit(0);
    }
  });

  this.rl.on("close", () => { this.stop(); process.exit(0); });
}
```

- [ ] **Step 2: 运行全量测试**

```bash
npm test 2>&1 | tail -10
```

期望：全部 PASS

- [ ] **Step 3: 构建**

```bash
npm run build 2>&1 | tail -5
```

期望：0 错误

- [ ] **Step 4: 提交**

```bash
GIT="$(command -v git)"
"$GIT" add src/repl/repl.ts
"$GIT" -c core.quotepath=false commit -m "feat: Ctrl+C 中止处理与启动信息优化"
```

---

## Task 5: 推送并验证

- [ ] **Step 1: 运行全量测试**

```bash
npm test 2>&1
```

期望：`9 passed, 2 skipped`，0 failed

- [ ] **Step 2: 推送**

```bash
GIT="$(command -v git)"
TOKEN=$(gh auth token)
"$GIT" push "https://$(gh api user --jq .login):${TOKEN}@github.com/$(gh api user --jq .login)/agent-sessions.git" main
```

- [ ] **Step 3: 手动冒烟验证**

在 MSYS2 bash 终端启动：
```bash
node dist/index.js
```

验证：
1. 输入 `/` 后 → 出现 6 条命令建议列表
2. 继续输入 `/ne` → 过滤为仅显示 `/new`
3. 按 ↑↓ 方向键 → 高亮在建议列表中移动
4. 按 Tab → 输入行自动补全为 `/new `
5. 按 Esc → 建议列表消失
6. 按 Ctrl+L → 清屏
7. 按 Ctrl+C（无会话时） → 打印"再见"退出

---

## 自检完成

**Spec 覆盖：**
- ✅ `/` 后实时过滤建议（Task 3）
- ✅ 最多 6 条建议（`getMatches` 中 `MAX_SUGGESTIONS = 6`）
- ✅ Tab 补全（Task 2，readline completer）
- ✅ 方向键导航（Task 3，keypress overlay）
- ✅ Tab/Enter 接受建议（Task 3）
- ✅ Esc 关闭建议层（Task 3）
- ✅ Ctrl+C 中止（Task 4）
- ✅ Ctrl+L 清屏（Task 3 中 keypress handler）

**占位符扫描：** 无 TBD/TODO

**类型一致性：**
- `SuggestionItem` 在 `renderer.ts` 定义，`repl.ts` 通过 `import type` 引入
- `CommandDef` 在 `completer.ts` 定义，`commands.ts` 通过 `export { COMMAND_DEFS }` 重导出
- `completeLine` 在 `completer.ts`，`repl.ts` 导入并传给 `readline.createInterface`
- `getMatches` 在 `completer.ts`，`repl.ts` 中 `showOverlay` 调用
- `renderSuggestions` 返回 `number`（行数），赋给 `this.suggestionLines: number` ✓
- `clearSuggestionLines(n: number)` 接受 `this.suggestionLines` ✓
