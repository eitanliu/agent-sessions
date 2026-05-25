# 多窗口 CLI 会话管理工具（agent-sessions）

## Context

在 Windows（MSYS2 + tmux）环境下，同时管理多个 Claude CLI 进程窗口，支持会话间互相输入输出。Phase 1 已完成 Claude 多窗口会话，架构为后续扩展预留。

---

## 技术选型（实际实现）

- **语言**：TypeScript 5.7 + Node.js ≥ 22，ESM 模块
- **多窗口**：tmux — **所有平台直接调用**（Windows 使用 MSYS2 内置 tmux，不走 WSL）
- **终端**：mintty（MSYS2 自带，用于 `/attach` 查看会话）
- **依赖**：仅 `chalk`（终端颜色），其余全部用 Node.js 内置模块
- **构建**：`tsc`，输出 `dist/`（不提交到 git）

---

## 项目文件结构

```
D:\code\ai\agent-sessions\
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # CLI 入口（bin: agent-sessions）
    ├── tmux/
    │   ├── platform.ts             # 平台检测（windows/wsl/linux/macos）
    │   ├── bridge.ts               # TmuxBridge — 所有平台统一 execFile("tmux", args)
    │   └── types.ts                # TmuxSession, TmuxPane, CaptureResult, TmuxError
    ├── adapters/
    │   ├── base.ts                 # AgentAdapter 接口 + AgentPatterns 类型
    │   ├── registry.ts             # AdapterRegistry，支持 claude/codex/opencode 注册
    │   └── claude/
    │       ├── adapter.ts          # ClaudeAdapter（含 Windows PATH 注入）
    │       └── patterns.ts         # Claude 专属正则（idle/active/waitingInput/error）
    ├── sessions/
    │   ├── types.ts                # AgentSession, SessionStatus, PaneAnalysis
    │   ├── state-detector.ts       # StateDetector — hash 轮询 + 正则匹配（无 LLM）
    │   └── manager.ts              # SessionManager — 生命周期管理，EventEmitter
    ├── routing/
    │   ├── types.ts                # RouteRule, MessageEnvelope, RouterEvent
    │   ├── router.ts               # MessageRouter — 路由规则 CRUD + 事件发布
    │   └── forwarder.ts            # SessionForwarder — 会话A输出 → 会话B输入（循环防护）
    └── repl/
        ├── commands.ts             # 命令解析（/new /list /send /route /attach /exit 等）
        ├── renderer.ts             # 终端渲染（chalk 表格/状态色块）
        ├── session-picker.ts       # 方向键交互式 session 选择（raw mode stdin）
        └── repl.ts                 # InteractiveREPL — readline 主循环 + 后台状态轮询
```

---

## 关键接口定义

### AgentAdapter（扩展点）
```typescript
interface AgentAdapter {
  readonly id: "claude" | "codex" | "opencode"
  readonly displayName: string
  launch(bridge: TmuxBridge, config: LaunchConfig): Promise<string>       // 返回 paneTarget
  sendPrompt(bridge: TmuxBridge, paneTarget: string, prompt: string): Promise<void>
  sendResponse(bridge: TmuxBridge, paneTarget: string, response: string): Promise<void>
  abort(bridge: TmuxBridge, paneTarget: string): Promise<void>
  shutdown(bridge: TmuxBridge, paneTarget: string): Promise<void>
  getPatterns(): AgentPatterns
}
```

### SessionStatus
```typescript
type SessionStatus = "launching" | "idle" | "active" | "waiting_input" | "error" | "dead"
```

### CaptureOptions
```typescript
interface CaptureOptions {
  startLine?: number;
  endLine?: number;
  includeEscapeSequences?: boolean;  // true = 保留 ANSI 转义序列（tmux -e 标志）
}
```

---

## 核心实现要点（实际实现）

### 1. TmuxBridge（bridge.ts）

**所有平台直接调用 `tmux`**，支持 `TMUX_BIN` 环境变量覆盖：

```typescript
const TMUX_BIN = process.env.TMUX_BIN ?? "tmux";
await execFileAsync(TMUX_BIN, args, { timeout: 10_000 })
```

长文本注入（>200 字节）：写临时文件 → `tmux load-buffer <path> → paste-buffer -d`
- Windows：`os.tmpdir()` 路径（来自 `TEMP` / `TMP` 环境变量）转为 MSYS2 格式
- 短文本：`send-keys -l`（literal 模式）

### 2. Claude 启动参数（adapter.ts）

**Windows PATH 自动注入**（通过系统 `USERPROFILE` 环境变量，无需手动配置）：

```typescript
if (process.platform === "win32") {
  const posixHome = (process.env.USERPROFILE ?? "")
    .replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)
    .replace(/\\/g, "/");
  await bridge.runInPane(paneTarget, `export PATH="${posixHome}/.local/bin:$PATH"`);
}
```

**说明：** `USERPROFILE` 是 Windows 系统内置环境变量（如 `C:\Users\name`），Node.js 直接读取，无需额外配置。

然后发送 `claude` 命令（可选 `--resume <sessionId>` 或 `--dangerously-skip-permissions`），等待 10s 初始化。

### 3. 状态检测（state-detector.ts，两阶段轻量检测）

- **Phase 1**：轮询 MD5 hash，等 hash 变化（agent 开始响应）
  - 循环前先捕获初始内容，避免 timeout 时返回空 content
- **Phase 2**：等内容稳定 ≥1500ms，再 quickCheck 正则匹配
  - error/waiting_input 一旦检测到立即退出（不等稳定）
  - active 且高置信度则重置稳定计时，继续等待
- timeout/abort 检查在 sleep 之前（避免多等一个轮询周期）

### 4. Claude patterns（patterns.ts）

```typescript
idle:         [/❯\s*$/m]
active:       [/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, /\.\.\.\s*$/m, /Reading|Writing|Editing|Running|Thinking/i]
waitingInput: [/\(y\/n\)/i, /\bAllow\b.*\?/i, /❯\s*\d+[.)]\s/, /Do you want to/i]
error:        [/^\s*Error:/m, /ENOENT|EACCES|EPERM/, /Connection refused/i, /API Error/i]
```

### 5. REPL 交互

- 不以 `/` 开头的输入 → 发送到当前选中 session
- 命令：`/new [workdir]`、`/list`、`/select <id>`、`/send <id> <prompt>`、
  `/wait <id>`、`/read [id]`、`/status [id]`、`/route add <from> <to>`、`/routes`、
  `/unroute <id>`、`/attach <id>`、`/kill <id>`、`/exit`
- `/attach <id>`：**输出 mintty 命令**（不直接执行）：`mintty -e tmux attach -t as-<id>`
- 提示符：`[claude-0 idle] > `（带颜色状态）
- 后台每 2s 轮询状态，变化时在提示符上方打印通知

### 6. 循环路由防护（forwarder.ts）

`forward(sourceId, output, chain = new Set())` — 递归转发时将已处理的 sourceId 加入 chain，检测到目标已在 chain 中时跳过并打印 WARNING。

---

## 运行与验证

> **Windows/MSYS2 说明：** 运行前先将 Node.js 加入 PATH：
> ```bash
> export PATH="$(cygpath -u "$PROGRAMFILES")/nodejs:$PATH"
> ```
> 或将此行加入 `~/.bashrc` 永久生效。之后直接使用 `npm`、`node` 命令。

### 构建

```bash
npm run build
```

### 测试

```bash
npm test
```

测试结果（Phase 1 完成后）：**59 passed，2 skipped**（平台跳过测试正常）

### 启动

```bash
node dist/index.js
```

### 冒烟测试流程

```
/new                    → 新建 claude-0，tmux pane 中启动 claude
/list                   → 显示 claude-0 状态 launching → idle
hello                   → 发送到 claude-0，状态变 active → idle
/read                   → 显示 claude-0 输出
/new                    → 新建 claude-1
/route add claude-0 claude-1  → claude-0 完成后自动转发到 claude-1
/routes                 → 显示路由规则
/attach claude-0        → 输出 mintty 命令，在新窗口查看
/exit
```

---

## 后续扩展规划（已预留架构）

- `src/adapters/codex/adapter.ts` — Codex CLI（指令文件 `AGENTS.md`，`--dangerously-bypass-approvals-and-sandbox`）
- `src/adapters/opencode/adapter.ts` — OpenCode CLI
- `src/web/` — Web 控制台（HTTP + WebSocket）
- 持久化：引入 `better-sqlite3`，会话历史存储
