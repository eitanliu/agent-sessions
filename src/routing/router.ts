import { randomUUID } from "node:crypto";
import type { RouteRule, RouterEvent } from "./types.js";

type EventListener = (event: RouterEvent) => void;

export class MessageRouter {
  private rules = new Map<string, RouteRule>();
  private listeners: EventListener[] = [];

  addRule(rule: Omit<RouteRule, "id">): string {
    const id = randomUUID();
    const full: RouteRule = { ...rule, id };
    this.rules.set(id, full);
    this.emit({ type: "route_added", rule: full, timestamp: Date.now() });
    return id;
  }

  removeRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      this.rules.delete(ruleId);
      this.emit({ type: "route_removed", rule, timestamp: Date.now() });
    }
  }

  getRulesForSource(sourceSessionId: string): RouteRule[] {
    return [...this.rules.values()].filter(
      (r) => r.enabled && r.sourceSessionId === sourceSessionId,
    );
  }

  getAllRules(): RouteRule[] {
    return [...this.rules.values()];
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  emit(event: RouterEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore */ }
    }
  }
}
