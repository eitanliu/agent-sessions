# 多窗口 CLI 会话管理工具（agent-sessions）

## Context

在 Windows（MSYS2 + tmux）环境下，同时管理多个 Claude CLI 进程窗口，支持会话间互相输入输出。Phase 1（Claude 多窗口）已完成，当前进入 Phase 2（增强交互 + Web 控制台）。

> 按照 superpowers 规范开发测试，直到所有功能完成编译通过，测试验证通过，全部完成后自己运行测试功能修复 bug，阶段任务完成要提交推送

---

## 技术选型（实际实现）

- **语言**：TypeScript 5.7 + Node.js ≥ 22，ESM 模块
- **多窗口**：tmux — **所有平台直接调用**（Windows 使用 MSYS2 内置 tmux，不走 WSL）
- **终端**：mintty（MSYS2 自带，用于 `/attach` 查看会话）
- **依赖**：`chalk`（终端颜色）+ `ws`（WebSocket），其余 Node.js 内置模块
- **构建**：`tsc`，输出 `dist/`（不提交到 git）

---

## 项目文件结构

```
D:\code\ai\agent-sessions\
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # CLI 入口（--web [port] 启动 Web 控制台）
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
    ├── repl/
    │   ├── completer.ts            # 命令定义（COMMAND_DEFS）+ Tab 补全逻辑
    │   ├── commands.ts             # CommandName 类型 + parseCommand + HELP_TEXT
    │   ├── renderer.ts             # chalk 终端渲染（colorStatus/buildPrompt 等）
    │   ├── session-picker.ts       # 方向键交互式会话选择（全屏，支持数字快速跳转）
    │   ├── session-view.ts         # SessionView — 全屏会话交互视图（Claude CLI agent-view 风格）
    │   └── repl.ts                 # InteractiveREPL — readline 主循环 + 多行 prompt 建议层
    └── web/
        ├── ws-hub.ts               # WebSocket 广播中枢（订阅 Manager/Router 事件）
        ├── server.ts               # HTTP + WebSocket 服务器（REST API + 静态文件）
        └── static/
            └── index.html          # Web 控制台前端（原生 WebSocket，无框架）
```

---

## 关键接口定义

### AgentAdapter（扩展点）
```typescript
interface AgentAdapter {
  readonly id: "claude" | "codex" | "opencode"
  readonly displayName: string
  launch(bridge: TmuxBridge, config: LaunchConfig): Promise<string>
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

**所有平台直接调用 `tmux`**，通过 PATH 解析（无平台分支）：

```typescript
await execFileAsync("tmux", args, { timeout: 10_000 })
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

### 5. REPL 交互（repl.ts）

- 输入 `/` 后实时显示命令候选（readline 多行 prompt 机制，无冲突）
- 需要 `<id>` 的命令（`/send /kill /wait /read /attach /status /select /enter`）在输入空格后实时显示会话 ID 候选
- Tab 键接受当前高亮候选（命令名或会话 ID）
- ↑↓ 方向键导航候选列表，Esc 关闭
- Ctrl+C（有会话时清空输入，无会话时退出），Ctrl+L 清屏

### 6. REPL 命令列表

| 命令 | 说明 |
|------|------|
| `/new [workdir]` | 新建 Claude 会话 |
| `/list` | 方向键选择会话 → 进入全屏交互视图 |
| `/enter [id]` | 进入全屏会话交互视图（不指定则弹选择器） |
| `/select [id]` | 仅切换当前会话（不进入视图），不指定则弹选择器 |
| `/send <id> <prompt>` | 向指定会话发送消息 |
| `/wait <id>` | 等待会话完成 |
| `/read [id]` | 读取会话最新输出 |
| `/status [id]` | 查看会话状态 |
| `/route add <from> <to>` | 添加路由规则 |
| `/routes` | 列出路由规则 |
| `/unroute <rule-id>` | 删除路由规则 |
| `/attach <id>` | 显示 mintty attach 命令 |
| `/kill <id>` | 销毁会话 |
| `/exit` | 退出程序 |

### 7. SessionView（session-view.ts）— Claude CLI agent-view 风格

参照 Claude CLI 官方 agent-view 交互模式实现：

```
┌──────────────────────────────────────────────────────┐
│ [claude-0]  idle  /home/user/project    Esc 退出列表 │  ← 固定顶部状态栏
├──────────────────────────────────────────────────────┤
│  Claude 的输出内容...                                 │  ← 滚动输出区
├──────────────────────────────────────────────────────┤
│ > 用户输入...                         [idle]         │  ← 固定底部输入行
└──────────────────────────────────────────────────────┘
```

使用 ANSI 滚动区（`\x1b[top;bottomr`）实现固定顶部/底部。Esc 退出回主 REPL。

### 8. Web 控制台（web/）

- **HTTP**：`GET /api/sessions`、`GET /api/routes`、`POST /api/sessions/:id/send`
- **WebSocket**：`ws://localhost:3000`，实时推送 `session_status`、`session_output`、`route_message`、初始化 `init` 事件
- **前端**（`static/index.html`）：深色主题，会话列表在左，输出区在右上，输入框固定右下
- **启动**：`node dist/index.js --web [port]`（默认 3000）

### 9. 循环路由防护（forwarder.ts）

`forward(sourceId, output, chain = new Set())` — 递归转发时将已处理的 sourceId 加入 chain，检测到闭环时跳过并打印 WARNING。

---

## 运行与验证

> **Windows/MSYS2 说明：** 运行前先将 Node.js 加入 PATH：
> ```bash
> export PATH="$(cygpath -u "$PROGRAMFILES")/nodejs:$PATH"
> ```

### 构建

```bash
npm run build
```

### 测试

```bash
npm test
```

当前测试结果：**78 passed，2 skipped**（平台跳过测试正常）

### 启动（CLI 模式）

```bash
node dist/index.js
```

### 启动（CLI + Web 控制台）

```bash
node dist/index.js --web        # 默认 3000 端口
node dist/index.js --web 8080   # 指定端口
```

### 冒烟测试流程

```
/new                          → 新建 claude-0，等待启动
/list                         → 进入选择器 → Enter 选中 → 全屏交互视图
                                输入消息 → Claude 响应显示在输出区
                                Esc → 回到主 REPL
/enter claude-0               → 直接进入 claude-0 全屏视图
/select                       → 弹出选择器，仅切换（不进入视图）
/send claude-0 hello          → 异步发送消息
/route add claude-0 claude-1  → claude-0 完成后自动转发到 claude-1
/attach claude-0              → 输出 mintty 命令
```

---

## 后续扩展规划

### Phase 3（待实现）

- [ ] `src/adapters/codex/` — Codex CLI 适配器
  - 指令文件 `AGENTS.md`，bypass 标志 `--dangerously-bypass-approvals-and-sandbox`
  - 不同的 idle/active/waitingInput patterns（`$` 提示符风格）
- [ ] `src/adapters/opencode/` — OpenCode CLI 适配器
- [ ] 会话历史持久化（`better-sqlite3`，JSONL 存储消息历史）
- [ ] Web 控制台增强（会话历史展示、路由可视化）
