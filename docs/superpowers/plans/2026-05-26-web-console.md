# Web 控制台（HTTP + WebSocket）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 agent-sessions 添加 Web 控制台，通过浏览器实时查看所有 Claude 会话状态、输出，并可发送命令，使用 HTTP + WebSocket 实现。

**Architecture:** `src/web/` 目录下新增三个模块：`server.ts`（Express HTTP 服务器 + 静态文件）、`ws-hub.ts`（WebSocket 事件广播中枢，订阅 SessionManager 的 status_change/settled 事件及 MessageRouter 的 message_sent 事件），`static/`（单页前端 HTML/JS，原生 WebSocket API，无构建工具）。入口 `src/index.ts` 可选通过 `--web` 标志启动 Web 服务。

**Tech Stack:** Node.js `http`（内置）+ `ws`（WebSocket 库，新增依赖）+ Express（可选，或直接用 `http`）+ 原生浏览器 WebSocket + Vanilla JS 前端（无框架）

**命令运行方式：** `export PATH="$(cygpath -u "$PROGRAMFILES")/nodejs:$PATH"` 后直接用 `npm`

---

## 文件结构总览

```
src/web/
├── server.ts           # HTTP 服务器：静态文件 + REST API (/api/sessions, /api/routes)
├── ws-hub.ts           # WebSocket 广播中枢，订阅 Manager/Router 事件推给客户端
└── static/
    └── index.html      # 单页前端：会话列表、输出面板、发送输入框、实时状态

src/index.ts            # MODIFY: 添加 --web 标志支持，可选启动 Web 服务
package.json            # MODIFY: 添加 ws 依赖

src/__tests__/web/
└── ws-hub.test.ts      # WebSocket 事件广播逻辑单测（mock WebSocket）
```

---

## Task 1: 添加 ws 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 ws 依赖**

```bash
cd D:/code/ai/agent-sessions
npm install ws
npm install --save-dev @types/ws
```

期望：`package.json` 中出现 `"ws": "^8.x"` 和 `"@types/ws": "^8.x"`

- [ ] **Step 2: 验证安装**

```bash
npm test 2>&1 | tail -5
```

期望：70 passed / 2 skipped，无回归

- [ ] **Step 3: 提交**

```bash
GIT="$(command -v git)"
cd /d/code/ai/agent-sessions
"$GIT" add package.json package-lock.json
"$GIT" -c core.quotepath=false commit -m "chore: 添加 ws WebSocket 依赖"
```

---

## Task 2: WebSocket 广播中枢（ws-hub.ts）

**Files:**
- Create: `src/web/ws-hub.ts`
- Create: `src/__tests__/web/ws-hub.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/web/ws-hub.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WsHub } from "../../web/ws-hub.js";

// Mock WebSocket
function makeMockWs(readyState = 1 /* OPEN */) {
  return { readyState, send: vi.fn(), on: vi.fn() };
}

describe("WsHub", () => {
  let hub: WsHub;

  beforeEach(() => {
    hub = new WsHub();
  });

  it("addClient / broadcast sends to open clients", () => {
    const ws1 = makeMockWs(1);
    const ws2 = makeMockWs(1);
    hub.addClient(ws1 as any);
    hub.addClient(ws2 as any);
    hub.broadcast({ type: "ping" });
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
  });

  it("removeClient stops receiving broadcasts", () => {
    const ws = makeMockWs(1);
    hub.addClient(ws as any);
    hub.removeClient(ws as any);
    hub.broadcast({ type: "ping" });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("broadcast skips closed clients (readyState !== 1)", () => {
    const closed = makeMockWs(3); // CLOSED
    hub.addClient(closed as any);
    hub.broadcast({ type: "ping" });
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("clientCount returns correct count", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    expect(hub.clientCount).toBe(0);
    hub.addClient(ws1 as any);
    hub.addClient(ws2 as any);
    expect(hub.clientCount).toBe(2);
    hub.removeClient(ws1 as any);
    expect(hub.clientCount).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test 2>&1 | tail -8
```

期望：FAIL，`Cannot find module '../../web/ws-hub.js'`

- [ ] **Step 3: 创建 `src/web/ws-hub.ts`**

```typescript
import type WebSocket from "ws";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "../routing/router.js";
import type { AgentSession } from "../sessions/types.js";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export class WsHub {
  private clients = new Set<WebSocket>();

  get clientCount(): number {
    return this.clients.size;
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === 1 /* WebSocket.OPEN */) {
        ws.send(data);
      }
    }
  }

  /**
   * 订阅 SessionManager 和 MessageRouter 事件，变化时广播给所有客户端。
   */
  attach(manager: SessionManager, router: MessageRouter): void {
    manager.on("status_change", (sessionId: string, oldStatus: string, newStatus: string) => {
      this.broadcast({ type: "session_status", sessionId, oldStatus, newStatus });
    });

    manager.on("settled", (sessionId: string, result: { content: string; analysis: { status: string } }) => {
      this.broadcast({
        type: "session_output",
        sessionId,
        content: result.content,
        status: result.analysis.status,
      });
    });

    router.onEvent((event) => {
      if (event.type === "message_sent" && event.envelope) {
        this.broadcast({
          type: "route_message",
          from: event.envelope.fromSessionId,
          to: event.envelope.toSessionId,
          content: event.envelope.content,
        });
      }
    });
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test 2>&1 | tail -10
```

期望：ws-hub 4 个测试全 PASS，无回归

- [ ] **Step 5: 提交**

```bash
GIT="$(command -v git)"
"$GIT" add src/web/ws-hub.ts src/__tests__/web/ws-hub.test.ts
"$GIT" -c core.quotepath=false commit -m "feat: WebSocket 广播中枢（ws-hub.ts）"
```

---

## Task 3: HTTP 服务器（server.ts）

**Files:**
- Create: `src/web/server.ts`

- [ ] **Step 1: 创建 `src/web/server.ts`**

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "../routing/router.js";
import { WsHub } from "./ws-hub.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebServer {
  start(): void;
  stop(): void;
}

export function createWebServer(
  manager: SessionManager,
  router: MessageRouter,
  port = 3000,
): WebServer {
  const hub = new WsHub();
  hub.attach(manager, router);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    // REST API
    if (url === "/api/sessions" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(manager.listSessions()));
      return;
    }

    if (url === "/api/routes" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(router.getAllRules()));
      return;
    }

    // POST /api/sessions/:id/send
    if (url.match(/^\/api\/sessions\/[^/]+\/send$/) && req.method === "POST") {
      const sessionId = url.split("/")[3];
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { prompt } = JSON.parse(body) as { prompt: string };
          await manager.sendPrompt(sessionId, prompt);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // 静态文件（默认返回 index.html）
    try {
      const staticPath = join(__dirname, "static", "index.html");
      const html = readFileSync(staticPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    hub.addClient(ws);
    // 发送当前全量状态
    ws.send(JSON.stringify({
      type: "init",
      sessions: manager.listSessions(),
      routes: router.getAllRules(),
    }));
    ws.on("close", () => hub.removeClient(ws));
    ws.on("error", () => hub.removeClient(ws));
  });

  return {
    start() {
      server.listen(port, () => {
        process.stderr.write(`[web] 控制台已启动: http://localhost:${port}\n`);
      });
    },
    stop() {
      wss.close();
      server.close();
    },
  };
}
```

- [ ] **Step 2: 创建静态前端 `src/web/static/index.html`**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-sessions 控制台</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #1a1a1a; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
  header { background: #111; padding: 10px 16px; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 14px; color: #7ec8e3; }
  #status { font-size: 12px; color: #666; }
  #status.connected { color: #4caf50; }
  main { flex: 1; display: grid; grid-template-columns: 280px 1fr; overflow: hidden; }
  #sessions { border-right: 1px solid #333; overflow-y: auto; padding: 8px; }
  .session-card { background: #222; border: 1px solid #333; border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: border-color .15s; }
  .session-card:hover, .session-card.active { border-color: #7ec8e3; }
  .session-card .sid { font-size: 12px; font-weight: bold; color: #7ec8e3; }
  .session-card .stat { font-size: 11px; margin-top: 2px; }
  .stat-idle { color: #4caf50; } .stat-active { color: #ff9800; } .stat-error { color: #f44336; }
  .stat-launching { color: #9e9e9e; } .stat-waiting_input { color: #ce93d8; }
  #panel { display: flex; flex-direction: column; overflow: hidden; }
  #output { flex: 1; overflow-y: auto; padding: 12px 16px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
  #output .ts { color: #555; font-size: 11px; }
  #input-area { border-top: 1px solid #333; display: flex; padding: 8px; gap: 8px; background: #111; }
  #msg { flex: 1; background: #222; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; padding: 6px 10px; font-family: monospace; font-size: 13px; outline: none; }
  #msg:focus { border-color: #7ec8e3; }
  #send-btn { background: #7ec8e3; color: #111; border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; font-weight: bold; }
  #send-btn:hover { background: #a8d8ea; }
  #empty { color: #555; margin: auto; text-align: center; padding: 40px; }
</style>
</head>
<body>
<header>
  <h1>agent-sessions</h1>
  <span id="status">● 连接中...</span>
</header>
<main>
  <div id="sessions"></div>
  <div id="panel">
    <div id="output"><div id="empty">← 选择一个会话查看输出</div></div>
    <div id="input-area">
      <input id="msg" type="text" placeholder="输入消息发送到当前会话..." disabled>
      <button id="send-btn" disabled>发送</button>
    </div>
  </div>
</main>
<script>
let ws, sessions = {}, currentId = null, outputLog = {};
const statusEl = document.getElementById('status');
const sessionsEl = document.getElementById('sessions');
const outputEl = document.getElementById('output');
const msgEl = document.getElementById('msg');
const sendBtn = document.getElementById('send-btn');

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => { statusEl.textContent = '● 已连接'; statusEl.className = 'connected'; };
  ws.onclose = () => { statusEl.textContent = '● 已断开'; statusEl.className = ''; setTimeout(connect, 3000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') {
      msg.sessions.forEach(s => { sessions[s.id] = s; outputLog[s.id] = []; });
      renderSessions();
    } else if (msg.type === 'session_status') {
      if (sessions[msg.sessionId]) { sessions[msg.sessionId].status = msg.newStatus; renderSessions(); }
    } else if (msg.type === 'session_output') {
      if (!outputLog[msg.sessionId]) outputLog[msg.sessionId] = [];
      outputLog[msg.sessionId].push({ ts: new Date().toLocaleTimeString(), content: msg.content });
      if (msg.sessionId === currentId) renderOutput(msg.sessionId);
    } else if (msg.type === 'route_message') {
      const line = `[ROUTE ${msg.from} → ${msg.to}]: ${msg.content.slice(0, 80)}`;
      appendOutput(line, '#7ec8e3');
    }
  };
}

function renderSessions() {
  sessionsEl.innerHTML = '';
  Object.values(sessions).forEach(s => {
    const el = document.createElement('div');
    el.className = 'session-card' + (s.id === currentId ? ' active' : '');
    el.innerHTML = `<div class="sid">${s.id}</div><div class="stat stat-${s.status}">${s.status}</div><div style="font-size:11px;color:#555;margin-top:2px">${s.workingDir.slice(-30)}</div>`;
    el.onclick = () => selectSession(s.id);
    sessionsEl.appendChild(el);
  });
}

function selectSession(id) {
  currentId = id;
  msgEl.disabled = false; sendBtn.disabled = false;
  document.querySelectorAll('.session-card').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');
  renderOutput(id);
}

function renderOutput(id) {
  if (!outputLog[id] || outputLog[id].length === 0) {
    outputEl.innerHTML = '<div id="empty" style="color:#555;padding:20px">（暂无输出）</div>';
    return;
  }
  outputEl.innerHTML = outputLog[id].map(e =>
    `<div><span class="ts">[${e.ts}] </span>${escHtml(e.content)}</div>`
  ).join('');
  outputEl.scrollTop = outputEl.scrollHeight;
}

function appendOutput(text, color = '#e0e0e0') {
  if (!currentId) return;
  const div = document.createElement('div');
  div.style.color = color;
  div.textContent = text;
  const empty = document.getElementById('empty');
  if (empty) empty.remove();
  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendMsg() {
  const prompt = msgEl.value.trim();
  if (!prompt || !currentId) return;
  msgEl.value = '';
  appendOutput(`> ${prompt}`, '#7ec8e3');
  await fetch(`/api/sessions/${currentId}/send`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ prompt })
  });
}

sendBtn.onclick = sendMsg;
msgEl.onkeydown = e => { if (e.key === 'Enter') sendMsg(); };
connect();
</script>
</body>
</html>
```

- [ ] **Step 3: 构建验证**

```bash
npm run build 2>&1 | tail -5
```

期望：0 TypeScript 错误

- [ ] **Step 4: 运行测试（含 ws-hub）**

```bash
npm test 2>&1 | tail -8
```

期望：全部 PASS

- [ ] **Step 5: 提交**

```bash
GIT="$(command -v git)"
"$GIT" add src/web/
"$GIT" -c core.quotepath=false commit -m "feat: Web 控制台 HTTP 服务器 + 前端（server.ts + index.html）"
```

---

## Task 4: 入口文件接入 --web 标志

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 读取当前 `src/index.ts`，添加 --web 支持**

在 `src/index.ts` 中导入 `createWebServer` 并根据命令行参数决定是否启动 Web 服务：

```typescript
#!/usr/bin/env node
import { TmuxBridge } from "./tmux/bridge.js";
import { AdapterRegistry } from "./adapters/registry.js";
import { ClaudeAdapter } from "./adapters/claude/adapter.js";
import { SessionManager } from "./sessions/manager.js";
import { MessageRouter } from "./routing/router.js";
import { SessionForwarder } from "./routing/forwarder.js";
import { InteractiveREPL } from "./repl/repl.js";
import { createWebServer } from "./web/server.js";

const bridge = new TmuxBridge();
const registry = new AdapterRegistry();
registry.register(new ClaudeAdapter());

const manager = new SessionManager(bridge, registry);
const router = new MessageRouter();
const forwarder = new SessionForwarder(manager, router);

manager.on("settled", (sessionId: string, result: { content: string }) => {
  forwarder.forward(sessionId, result.content).catch((err) =>
    process.stderr.write(`[agent-sessions] forward error: ${err.message}\n`)
  );
});

// --web [port] 启动 Web 控制台
const webIdx = process.argv.indexOf("--web");
if (webIdx !== -1) {
  const port = parseInt(process.argv[webIdx + 1] ?? "3000", 10) || 3000;
  const webServer = createWebServer(manager, router, port);
  webServer.start();
}

const repl = new InteractiveREPL(manager, router, forwarder);
repl.start();
```

- [ ] **Step 2: 构建验证**

```bash
npm run build 2>&1 | tail -3
```

期望：0 TypeScript 错误

- [ ] **Step 3: 全量测试**

```bash
npm test 2>&1 | tail -8
```

期望：74+ passed（新增 ws-hub 4 个）/ 2 skipped

- [ ] **Step 4: 提交并推送**

```bash
GIT="$(command -v git)"
TOKEN=$(gh auth token)
"$GIT" add src/index.ts
"$GIT" -c core.quotepath=false commit -m "feat: index.ts 支持 --web 标志启动 Web 控制台"
"$GIT" push "https://$(gh api user --jq .login):${TOKEN}@github.com/$(gh api user --jq .login)/agent-sessions.git" main
```

---

## 自检完成

**Spec 覆盖：**
- ✅ HTTP 服务器（GET /api/sessions，GET /api/routes，POST /api/sessions/:id/send）— Task 3
- ✅ WebSocket 事件广播（session_status，session_output，route_message，init）— Task 2
- ✅ 前端（会话列表 + 输出面板 + 输入框 + 实时更新）— Task 3
- ✅ --web 启动标志 — Task 4
- ✅ 测试覆盖 WsHub 核心逻辑 — Task 2

**占位符扫描：** 无 TBD/TODO

**类型一致性：**
- `WsHub.broadcast(msg: WsMessage)` → `WsMessage` 在 `ws-hub.ts` 定义 ✓
- `createWebServer(manager, router, port)` → `WebServer` 接口有 `start/stop` ✓
- `hub.attach(manager, router)` → 两个参数类型匹配 ✓
- `ws-hub.test.ts` 中 `makeMockWs(readyState)` → `hub.addClient(ws as any)` ✓
