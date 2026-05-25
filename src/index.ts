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

// --web [port] 启动 Web 控制台（默认端口 3000）
const webIdx = process.argv.indexOf("--web");
if (webIdx !== -1) {
  const port = parseInt(process.argv[webIdx + 1] ?? "3000", 10) || 3000;
  const webServer = createWebServer(manager, router, port);
  webServer.start();
}

const repl = new InteractiveREPL(manager, router, forwarder);
repl.start();
