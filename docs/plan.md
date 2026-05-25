# 多窗口 CLI 会话管理工具（agent-sessions）

## Context

用户需要一个命令行工具，能够同时管理多个 Claude（及后续 Codex、OpenCode）的 CLI 进程窗口，支持会话间互相输入输出。当前阶段：从零创建，先实现 Claude 多窗口会话，架构上为后续扩展预留。

工作目录：`D:\code\ai\agent-sessions`（空目录）

参考项目（同级目录，已验证可用的实现）：
- `D:\code\ai\Cliclaw\src\tmux\` — TmuxBridge、StateDetector、ClaudeCodeAdapter
- `D:\code\ai\zylos-core\cli\lib\runtime\` — RuntimeAdapter 策略模式、tmux buffer 注入技术

---

## 技术选型

- **语言**：TypeScript + Node.js ≥ 20，ESM 模块
- **多窗口**：tmux（Windows 下通过 `wsl -e tmux` 路由，来自 Claude Code 官方实现）
- **依赖**：仅 `chalk`（终端颜色），其余全部用 Node.js 内置模块
- **构建**：`tsc`，输出 `dist/`

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
    │   ├── bridge.ts               # TmuxBridge — execFile("wsl","-e","tmux") / execFile("tmux")
    │   └── types.ts                # TmuxSession, TmuxPane, CaptureResult
    ├── adapters/
    │   ├── base.ts                 # AgentAdapter 接口 + AgentPatterns 类型
    │   ├── registry.ts             # AdapterRegistry，支持 claude/codex/opencode 注册
    │   └── claude/
    │       ├── adapter.ts          # ClaudeAdapter（launch/sendPrompt/abort/shutdown）
    │       └── patterns.ts         # Claude 专属正则（idle/active/waitingInput/error）
    ├── sessions/
    │   ├── types.ts                # AgentSession, SessionStatus, SessionConfig
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

---

## 核心实现要点

### 1. Windows/WSL tmux 路由（bridge.ts）
```typescript
// Windows: execFile("wsl", ["-e", "tmux", ...args])
// 其他:    execFile("tmux", args)
// 长文本注入（>200 字节）：写 WSL /tmp 临时文件 → load-buffer → paste-buffer -d
// 短文本：send-keys -l（literal 模式）
```

### 2. Claude 启动参数（adapter.ts）
- 命令：`claude` 或 `claude --resume <sessionId>`
- 可选：`--dangerously-skip-permissions`
- 启动前清除 `CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT` 环境变量（防止嵌套启动检测）
- 启动后等待 10s 再开始状态检测

### 3. 状态检测（state-detector.ts，轻量两层）
- Phase 1：轮询 MD5 hash，等 hash 变化（agent 开始响应）
- Phase 2：等内容稳定 ≥1500ms，再 quickCheck 正则匹配
- error/waiting_input 快速退出（不等稳定）；active 且高置信度则继续等待

### 4. Claude patterns（patterns.ts）
```typescript
idle:         [/❯\s*$/m]
active:       [/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, /\.\.\.\s*$/m, /Reading|Writing|Editing|Running/i]
waitingInput: [/\(y\/n\)/i, /\bAllow\b.*\?/i, /❯\s*\d+[.)]\s/]
error:        [/^\s*Error:/m, /ENOENT|EACCES|EPERM/, /API Error/i]
```

### 5. REPL 交互
- 不以 `/` 开头的输入 → 发送到当前选中 session
- 命令：`/new [workdir]`、`/list`、`/select <id>`、`/send <id> <prompt>`、
  `/wait <id>`、`/read [id]`、`/route add <from> <to>`、`/routes`、`/unroute <id>`、
  `/attach <id>`（tmux attach）、`/exit`
- 提示符：`[claude-0 idle] > `（带颜色状态）
- 后台每 2s 轮询状态，变化时在提示符上方打印通知

### 6. 循环路由防护（forwarder.ts）
- `forward()` 维护调用链 Set，检测到 A→B→A 闭环时跳过并打印警告

---

## 实现顺序

1. `package.json` + `tsconfig.json`（初始化项目）
2. `src/tmux/platform.ts` + `src/tmux/types.ts`（平台检测）
3. `src/tmux/bridge.ts`（TmuxBridge 核心，Windows/WSL 路由）
4. `src/adapters/base.ts` + `src/adapters/registry.ts`（适配器框架）
5. `src/adapters/claude/patterns.ts` + `src/adapters/claude/adapter.ts`（Claude 适配器）
6. `src/sessions/types.ts` + `src/sessions/state-detector.ts`（状态检测）
7. `src/sessions/manager.ts`（会话管理器）
8. `src/routing/types.ts` + `src/routing/router.ts` + `src/routing/forwarder.ts`（路由）
9. `src/repl/renderer.ts` + `src/repl/commands.ts` + `src/repl/session-picker.ts` + `src/repl/repl.ts`（REPL）
10. `src/index.ts`（入口）

---

## 验证方案

1. 构建：`npm run build`，确认无 TypeScript 报错
2. 启动：`node dist/index.js`（或 `npx agent-sessions`）
3. 功能测试：
   - `/new` → 新建 claude-0 session，tmux 窗口出现
   - `/list` → 显示 claude-0 状态 launching → idle
   - 直接输入 `hello` → 发送到 claude-0，状态变 active → idle
   - `/read` → 显示 claude-0 输出
   - `/new` → 新建 claude-1，`/route add claude-0 claude-1` → claude-0 完成后自动转发到 claude-1
   - `/attach claude-0` → tmux attach 到该 session 直观查看
4. Windows/WSL 验证：确认 `wsl -e tmux` 可正常执行，临时文件路径正确

---

## 后续扩展规划（已预留架构）

- `src/adapters/codex/adapter.ts` — Codex CLI（指令文件 `AGENTS.md`，不同 bypass 标志）
- `src/adapters/opencode/adapter.ts` — OpenCode CLI
- `src/web/` — Web 控制台（HTTP + WebSocket，参考 zylos-core web-console）
- 持久化：引入 `better-sqlite3`，会话历史存储
