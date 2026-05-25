import { describe, it, expect } from "vitest";
import { MessageRouter } from "../../routing/router.js";

describe("MessageRouter", () => {
  it("addRule returns unique id and emits route_added", () => {
    const router = new MessageRouter();
    const events: string[] = [];
    router.onEvent((e) => events.push(e.type));
    const id = router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-1", enabled: true });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(events).toContain("route_added");
  });

  it("removeRule emits route_removed and clears rule", () => {
    const router = new MessageRouter();
    const events: string[] = [];
    router.onEvent((e) => events.push(e.type));
    const id = router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    router.removeRule(id);
    expect(events).toContain("route_removed");
    expect(router.getAllRules()).toHaveLength(0);
  });

  it("getRulesForSource filters by sourceSessionId and enabled", () => {
    const router = new MessageRouter();
    router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    router.addRule({ sourceSessionId: "a", targetSessionId: "c", enabled: false });
    router.addRule({ sourceSessionId: "x", targetSessionId: "b", enabled: true });
    expect(router.getRulesForSource("a")).toHaveLength(1);
  });

  it("onEvent returns unsubscribe function", () => {
    const router = new MessageRouter();
    const events: string[] = [];
    const unsub = router.onEvent((e) => events.push(e.type));
    router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    unsub();
    router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    expect(events).toHaveLength(1);
  });
});
