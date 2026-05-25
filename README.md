# agent-sessions

> 多窗口 CLI 会话管理工具 · Phase 2 进行中

同时管理多个 Claude CLI 进程窗口，支持会话间互相输入输出路由，提供增强交互 REPL 和 Web 控制台。

---

## 前置条件

| 依赖 | 要求 | 说明 |
|------|------|------|
| Node.js | ≥ 22 | 需在 PATH 中可用 |
| tmux | ≥ 3.x | **Windows：MSYS2 内置**（`$MSYS2_ROOT/usr/bin/tmux`，无需 WSL） |
| Claude CLI | 最新版 | 默认安装在 `$USERPROFILE\.local\bin\` |
| MSYS2 | 最新版 | Windows 用户必须；提供 bash、tmux、mintty |

> **Linux / macOS：** 直接使用系统 tmux，无需 MSYS2。

---

## 特性

- **多窗口并发** — 在独立 tmux pane 中启动多个 Claude 实例，互不干扰
- **状态感知** — 自动检测每个会话的状态（空闲 / 处理中 / 等待确认 / 错误）
- **会话间路由** — 将会话 A 的输出自动转发到会话 B 的输入，支持过滤与转换
- **增强 REPL** — `/` 输入实时命令候选、`<id>` 参数实时会话候选、Tab 补全、方向键导航
- **全屏会话视图** — 参照 Claude CLI agent-view，固定状态栏 + 滚动输出区 + 底部输入框
- **Web 控制台** — HTTP + WebSocket，浏览器实时查看会话状态和输出，支持发送消息
- **可扩展适配器** — 策略模式架构，预留 Codex / OpenCode 扩展位

---

## 安装

```bash
git clone https://github.com/eitanliu/agent-sessions.git
cd agent-sessions
npm install
npm run build
```

> **Windows / MSYS2：** 先将 Node.js 加入 PATH：
> ```bash
> export PATH="$(cygpath -u "$PROGRAMFILES")/nodejs:$PATH"
> # 建议加入 ~/.bashrc 永久生效
> ```

---

## 使用

```bash
# CLI 模式
node dist/index.js

# CLI + Web 控制台（默认 3000 端口）
node dist/index.js --web

# 指定端口
node dist/index.js --web 8080
```

### REPL 命令

| 命令 | 说明 |
|------|------|
| `/new [工作目录]` | 新建 Claude 会话 |
| `/list` | 方向键选择会话 → 进入全屏交互视图 |
| `/enter [id]` | 进入全屏会话交互视图（不指定则弹选择器） |
| `/select [id]` | 仅切换当前操作的会话（不进入视图） |
| `/send <id> <提示词>` | 向指定会话发送消息 |
| `/wait <id>` | 等待指定会话完成（变为空闲） |
| `/read [id]` | 读取会话最新输出 |
| `/status [id]` | 查看会话状态 |
| `/route add <from> <to>` | 添加路由规则（A 输出 → B 输入） |
| `/routes` | 查看所有路由规则 |
| `/unroute <规则id>` | 删除路由规则 |
| `/attach <id>` | 显示 mintty attach 命令（新窗口查看） |
| `/kill <id>` | 销毁会话 |
| `/exit` | 退出程序 |

> - 不以 `/` 开头的输入直接发送到当前选中的会话
> - 需要 `<id>` 的命令在输入空格后会**实时显示会话候选列表**，Tab 接受
> - 快捷键：**Ctrl+C** 清空输入 / **Ctrl+L** 清屏 / **Esc** 关闭建议

### 全屏会话视图（/list 或 /enter）

参照 Claude CLI agent-view 布局：

```
┌──────────────────────────────────────────────────────┐
│ [claude-0]  idle  /home/user/project    Esc 退出列表 │
├──────────────────────────────────────────────────────┤
│  > hello                                             │
│  Hi! How can I help you today?                       │
│                                                      │
├──────────────────────────────────────────────────────┤
│ > 输入消息...                          [idle]        │
└──────────────────────────────────────────────────────┘
```

按 **Esc** 退出回主 REPL。

### Web 控制台

访问 `http://localhost:3000`，功能：
- 左侧会话列表（实时状态更新）
- 右上输出区（实时 Claude 响应）
- 右下固定输入框（发送消息）

---

## 架构

```
src/
├── tmux/
│   ├── platform.ts       # 平台检测
│   ├── types.ts          # 类型定义
│   └── bridge.ts         # TmuxBridge
├── adapters/
│   ├── base.ts           # AgentAdapter 接口
│   ├── registry.ts       # AdapterRegistry
│   └── claude/           # Claude CLI 适配器
├── sessions/
│   ├── types.ts          # AgentSession 等类型
│   ├── state-detector.ts # 两阶段状态检测
│   └── manager.ts        # SessionManager
├── routing/
│   ├── types.ts          # 路由类型
│   ├── router.ts         # MessageRouter
│   └── forwarder.ts      # SessionForwarder（循环防护）
├── repl/
│   ├── completer.ts      # 命令定义 + Tab 补全
│   ├── commands.ts       # 命令解析
│   ├── renderer.ts       # 终端渲染
│   ├── session-picker.ts # 方向键会话选择器
│   ├── session-view.ts   # 全屏会话交互视图
│   └── repl.ts           # InteractiveREPL 主循环
└── web/
    ├── ws-hub.ts         # WebSocket 广播中枢
    ├── server.ts         # HTTP + WebSocket 服务器
    └── static/
        └── index.html    # Web 控制台前端
```

详见 [docs/plan.md](docs/plan.md)。

---

## 环境变量

| 系统变量 | 用途 |
|----------|------|
| `USERPROFILE` | 定位 `claude.exe`（`%USERPROFILE%\.local\bin\`），Windows 自动注入 |
| `PROGRAMFILES` | 定位 Node.js |
| `PATH` | tmux、git、gh 均通过 PATH 解析 |

---

## 路线图

- [x] Claude 多窗口会话管理
- [x] 会话间消息路由（循环防护）
- [x] 增强 REPL（命令补全 + 会话 ID 候选）
- [x] 全屏会话交互视图（agent-view 风格）
- [x] Web 控制台（HTTP + WebSocket）
- [ ] Codex CLI 适配器（`src/adapters/codex/`）
- [ ] OpenCode CLI 适配器（`src/adapters/opencode/`）
- [ ] 会话历史持久化（`better-sqlite3`）

---

## License

MIT
