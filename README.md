# agent-sessions

> **开发中** · 多窗口 CLI 会话管理工具

同时管理多个 Claude（及后续 Codex、OpenCode）的 CLI 进程窗口，支持会话间互相输入输出路由。

---

## 特性

- **多窗口并发** — 在独立 tmux pane 中启动多个 Claude 实例，互不干扰
- **状态感知** — 自动检测每个会话的状态（空闲 / 处理中 / 等待确认 / 错误）
- **会话间路由** — 将会话 A 的输出自动转发到会话 B 的输入，支持多对多规则
- **交互式 REPL** — 带颜色状态提示符，直接输入或使用 `/` 命令管理所有会话
- **可扩展适配器** — 策略模式架构，预留 Codex / OpenCode 扩展位

## 前置条件

- Node.js ≥ 20
- tmux（Linux/macOS 原生；Windows 需 WSL）
- Claude CLI（`claude` 命令可用）

## 安装

```bash
git clone https://github.com/eitanliu/agent-sessions.git
cd agent-sessions
npm install
npm run build
```

## 使用

```bash
node dist/index.js
# 或安装后
npx agent-sessions
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
| `/route add <from> <to>` | 添加路由规则（A 输出 → B 输入） |
| `/routes` | 查看所有路由规则 |
| `/unroute <规则id>` | 删除路由规则 |
| `/attach <id>` | 直接 attach 到 tmux 窗口 |
| `/exit` | 退出程序 |

> 不以 `/` 开头的输入会直接发送到当前选中的会话。

## 架构

```
src/
├── tmux/        # tmux 桥接（Windows/WSL/Linux/macOS 跨平台）
├── adapters/    # CLI 适配器（claude / codex / opencode）
├── sessions/    # 会话生命周期 + 状态检测
├── routing/     # 消息路由引擎
└── repl/        # 交互式命令行界面
```

详见 [docs/plan.md](docs/plan.md)。

## 路线图

- [ ] Claude 多窗口会话（当前阶段）
- [ ] Codex CLI 适配器
- [ ] OpenCode CLI 适配器
- [ ] Web 控制台（HTTP + WebSocket）
- [ ] 会话历史持久化

## License

MIT
