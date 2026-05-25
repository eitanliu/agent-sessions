import type WebSocket from "ws";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "../routing/router.js";

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
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

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
