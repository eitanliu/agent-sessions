import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "../../adapters/registry.js";
import type { AgentAdapter, AgentPatterns } from "../../adapters/base.js";

const mockAdapter: AgentAdapter = {
  id: "claude",
  displayName: "Claude",
  launch: async () => "sess:0.0",
  sendPrompt: async () => {},
  sendResponse: async () => {},
  abort: async () => {},
  shutdown: async () => {},
  getPatterns: (): AgentPatterns => ({
    idle: [], active: [], waitingInput: [], error: [],
  }),
};

describe("AdapterRegistry", () => {
  it("registers and retrieves an adapter", () => {
    const registry = new AdapterRegistry();
    registry.register(mockAdapter);
    expect(registry.get("claude")).toBe(mockAdapter);
  });

  it("throws on unknown adapter id", () => {
    const registry = new AdapterRegistry();
    expect(() => registry.get("codex")).toThrow("Unknown adapter: codex");
  });

  it("lists registered adapter ids", () => {
    const registry = new AdapterRegistry();
    registry.register(mockAdapter);
    expect(registry.list()).toEqual(["claude"]);
  });
});
