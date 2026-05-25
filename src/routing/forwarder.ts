import { randomUUID } from "node:crypto";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "./router.js";

export class SessionForwarder {
  constructor(
    private manager: SessionManager,
    private router: MessageRouter,
  ) {}

  async forward(sourceSessionId: string, output: string, chain = new Set<string>()): Promise<void> {
    const rules = this.router.getRulesForSource(sourceSessionId);
    for (const rule of rules) {
      const target = this.manager.getSession(rule.targetSessionId);
      if (!target) continue;

      if (chain.has(rule.targetSessionId)) {
        process.stderr.write(
          `[agent-sessions] WARNING: circular route detected, skipping ${sourceSessionId} → ${rule.targetSessionId}\n`,
        );
        continue;
      }

      let content = output;
      if (rule.filter) {
        const match = content.match(rule.filter);
        if (!match) continue;
        content = match[0];
      }
      if (rule.transform) content = rule.transform(content);

      try {
        await this.manager.sendPrompt(rule.targetSessionId, content);
        this.router.emit({
          type: "message_sent",
          envelope: {
            id: randomUUID(),
            fromSessionId: sourceSessionId,
            toSessionId: rule.targetSessionId,
            content,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        });
        const nextChain = new Set([...chain, sourceSessionId]);
        await this.forward(rule.targetSessionId, content, nextChain);
      } catch (err) {
        this.router.emit({
          type: "route_error",
          rule,
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    }
  }
}
