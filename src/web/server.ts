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

    if (/^\/api\/sessions\/[^/]+\/send$/.test(url) && req.method === "POST") {
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
