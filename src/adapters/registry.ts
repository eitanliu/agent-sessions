import type { AgentAdapter, AgentAdapterId } from "./base.js";

export class AdapterRegistry {
  private adapters = new Map<AgentAdapterId, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentAdapterId): AgentAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown adapter: ${id}`);
    return adapter;
  }

  list(): AgentAdapterId[] {
    return [...this.adapters.keys()];
  }
}
