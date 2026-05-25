import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionForwarder } from "../../routing/forwarder.js";
import { MessageRouter } from "../../routing/router.js";
import { SessionManager } from "../../sessions/manager.js";
import { TmuxBridge } from "../../tmux/bridge.js";
import { AdapterRegistry } from "../../adapters/registry.js";

vi.mock("../../sessions/manager.js");
vi.mock("../../tmux/bridge.js");
vi.mock("../../adapters/registry.js");

describe("SessionForwarder", () => {
  let router: MessageRouter;
  let manager: SessionManager;
  let forwarder: SessionForwarder;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new MessageRouter();
    manager = new (vi.mocked(SessionManager))(
      new (vi.mocked(TmuxBridge))(),
      new (vi.mocked(AdapterRegistry))(),
    );
    vi.mocked(manager.getSession).mockImplementation((id) =>
      id === "claude-1" ? ({ id: "claude-1" } as any) : undefined
    );
    vi.mocked(manager.sendPrompt).mockResolvedValue(undefined);
    forwarder = new SessionForwarder(manager, router);
  });

  it("forwards output to target session per rule", async () => {
    router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-1", enabled: true });
    await forwarder.forward("claude-0", "hello from 0");
    expect(manager.sendPrompt).toHaveBeenCalledWith("claude-1", "hello from 0");
  });

  it("applies filter — skips if no match", async () => {
    router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-1", enabled: true, filter: /FORWARD:/ });
    await forwarder.forward("claude-0", "no prefix here");
    expect(manager.sendPrompt).not.toHaveBeenCalled();
  });

  it("applies transform before sending", async () => {
    router.addRule({
      sourceSessionId: "claude-0", targetSessionId: "claude-1", enabled: true,
      transform: (c) => `[from claude-0] ${c}`,
    });
    await forwarder.forward("claude-0", "hello");
    expect(manager.sendPrompt).toHaveBeenCalledWith("claude-1", "[from claude-0] hello");
  });

  it("skips unknown target session", async () => {
    router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-999", enabled: true });
    await forwarder.forward("claude-0", "hello");
    expect(manager.sendPrompt).not.toHaveBeenCalled();
  });

  it("prevents circular routing A→B→A", async () => {
    router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-1", enabled: true });
    router.addRule({ sourceSessionId: "claude-1", targetSessionId: "claude-0", enabled: true });
    vi.mocked(manager.getSession).mockImplementation((id) => ({ id } as any));
    const calls: string[] = [];
    vi.mocked(manager.sendPrompt).mockImplementation(async (id) => { calls.push(id); });
    await forwarder.forward("claude-0", "ping");
    // Should forward to claude-1, then stop (claude-0 is in chain)
    expect(calls).toEqual(["claude-1"]);
  });
});
