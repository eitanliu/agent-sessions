#!/usr/bin/env node
import { TmuxBridge } from "./tmux/bridge.js";
import { AdapterRegistry } from "./adapters/registry.js";
import { ClaudeAdapter } from "./adapters/claude/adapter.js";
import { SessionManager } from "./sessions/manager.js";
import { MessageRouter } from "./routing/router.js";
import { SessionForwarder } from "./routing/forwarder.js";
import { InteractiveREPL } from "./repl/repl.js";

const bridge = new TmuxBridge();
const registry = new AdapterRegistry();
registry.register(new ClaudeAdapter());

const manager = new SessionManager(bridge, registry);
const router = new MessageRouter();
const forwarder = new SessionForwarder(manager, router);

// 会话完成后自动路由输出到目标会话
manager.on("settled", (sessionId: string, result: unknown) => {
  const r = result as { content: string };
  forwarder.forward(sessionId, r.content).catch((err) =>
    process.stderr.write(`[agent-sessions] forward error: ${err.message}\n`)
  );
});

const repl = new InteractiveREPL(manager, router, forwarder);
repl.start();
