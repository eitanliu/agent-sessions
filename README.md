# agent-sessions

> 多窗口 CLI 会话管理工具 · Phase 1 完成

同时管理多个 Claude CLI 进程窗口，支持会话间互相输入输出路由。

---

## 特性

- **多窗口并发** — 在独立 tmux pane 中启动多个 Claude 实例，互不干扰
- **状态感知** — 自动检测每个会话的状态（空闲 / 处理中 / 等待确认 / 错误）
- **会话间路由** — 将会话 A 的输出自动转发到会话 B 的输入，支持过滤与转换
- **交互式 REPL** — 带颜色状态提示符，直接输入或使用 `/` 命令管理所有会话
- **可扩展适配器** — 策略模式架构，预留 Codex / OpenCode 扩展位

---

## 前置条件

| 依赖 | 要求 | 说明 |
|------|------|------|
| Node.js | ≥ 22 | `C:\Program Files\nodejs\` |
| tmux | ≥ 3.x | **Windows：MSYS2 内置**（`/usr/bin/tmux`，无需 WSL） |
| Claude CLI | 最新版 | 安装在 `~/.local/bin/claude.exe` |
| MSYS2 | 最新版 | Windows 用户必须；提供 bash、tmux、mintty |

> **Linux / macOS：** 直接使用系统 tmux，无需 MSYS2。

---

## 安装

```bash
git clone https://github.com/eitanliu/agent-sessions.git
cd agent-sessions
npm install
npm run build
```

> **Windows / MSYS2 运行测试：** npm 不在 MSYS bash PATH 中，需指定完整路径：
> ```bash
> PATH="/c/Program Files/nodejs:$PATH" "/c/Program Files/nodejs/npm.cmd" test
> ```

---

## 使用

```bash
# Linux / macOS
node dist/index.js

# Windows（MSYS2 bash）
"/c/Program Files/nodejs/node.exe" dist/index.js
```

### REPL 命令

| 命令 | 说明 |
|------|------|
| `/new [工作目录]` | 新建 Claude 会话 |
| `/list` | 列出所有会话及状态 |
| `/select <id>` | 切换当前操作的会话 |
| `/send <id> <提示词>` | 向指定会话发送消息 |
| `/wait <id>` | 等待指定会话完成（变为空闲） |
| `/read [id]` | 读取会话最新输出 |
| `/status [id]` | 查看会话状态 |
| `/route add <from> <to>` | 添加路由规则（A 输出 → B 输入） |
| `/routes` | 查看所有路由规则 |
| `/unroute <规则id>` | 删除路由规则 |
| `/attach <id>` | 显示 mintty attach 命令（在新窗口中查看会话） |
| `/kill <id>` | 销毁会话 |
| `/exit` | 退出程序 |

> 不以 `/` 开头的输入会直接发送到当前选中的会话。

### /attach 说明（Windows）

`/attach <id>` 会输出 mintty 命令，在新终端窗口中查看对应的 tmux 会话：

```
mintty -e tmux attach -t as-claude-0
```

在 MSYS2 bash 中直接运行该命令即可打开新窗口。

---

## 架构

```
src/
├── tmux/
│   ├── platform.ts     # 平台检测（windows/wsl/linux/macos）
│   ├── types.ts        # TmuxSession, TmuxPane, CaptureResult, TmuxError
│   └── bridge.ts       # TmuxBridge — 所有平台直接调用 tmux
├── adapters/
│   ├── base.ts         # AgentAdapter 接口、AgentPatterns、LaunchConfig
│   ├── registry.ts     # AdapterRegistry
│   └── claude/
│       ├── patterns.ts # Claude 专属正则模式
│       └── adapter.ts  # ClaudeAdapter（含 Windows PATH 自动注入）
├── sessions/
│   ├── types.ts        # AgentSession, SessionStatus, PaneAnalysis
│   ├── state-detector.ts # 两阶段状态检测（hash 轮询 + 正则）
│   └── manager.ts      # SessionManager（EventEmitter）
├── routing/
│   ├── types.ts        # RouteRule, MessageEnvelope, RouterEvent
│   ├── router.ts       # MessageRouter（规则 CRUD + 事件）
│   └── forwarder.ts    # SessionForwarder（循环路由防护）
└── repl/
    ├── renderer.ts     # chalk 终端渲染
    ├── commands.ts     # 命令解析
    ├── session-picker.ts # 方向键会话选择器
    └── repl.ts         # InteractiveREPL 主循环
```

详见 [docs/plan.md](docs/plan.md)。

---

## Windows 实现说明

### tmux 方案

原计划使用 `wsl -e tmux` 路由，**实际改为 MSYS2 内置 tmux 直接调用**：

- MSYS2 自带 tmux 3.6a（`/d/DevSoft/msys64/usr/bin/tmux.exe`）已在 Windows PATH 中
- `TmuxBridge` 对所有平台统一使用 `execFile(TMUX_BIN, args)`，无需平台分支
- 查看会话使用 mintty：`mintty -e tmux attach -t <session-name>`

```bash
# 可选：手动指定 tmux 可执行文件路径
export TMUX_BIN="/usr/bin/tmux"
node dist/index.js
```

### claude.exe 路径

Claude CLI 安装在 `%USERPROFILE%\.local\bin\claude.exe`，该路径默认不在 MSYS2 tmux 会话的 PATH 中。`ClaudeAdapter.launch()` 启动前自动注入 PATH：

- 设置了 `CLAUDE_BIN_DIR` 环境变量时，直接使用该路径
- 未设置时，自动通过 `cygpath` 推导 `$USERPROFILE/.local/bin`

```bash
# 可选：手动指定 claude.exe 所在目录（POSIX 格式）
export CLAUDE_BIN_DIR="/c/Users/yourname/.local/bin"
node dist/index.js
```

---

## 路线图

- [x] **Claude 多窗口会话（Phase 1 完成）**
- [ ] Codex CLI 适配器（`src/adapters/codex/`）
- [ ] OpenCode CLI 适配器（`src/adapters/opencode/`）
- [ ] Web 控制台（HTTP + WebSocket）
- [ ] 会话历史持久化（`better-sqlite3`）

---

## License

MIT
