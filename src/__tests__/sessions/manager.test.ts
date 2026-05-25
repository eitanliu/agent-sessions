import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../sessions/manager.js";
import { TmuxBridge } from "../../tmux/bridge.js";
import { AdapterRegistry } from "../../adapters/registry.js";
import { ClaudeAdapter } from "../../adapters/claude/adapter.js";

vi.mock("../../tmux/bridge.js");
vi.mock("../../adapters/claude/adapter.js");

describe("SessionManager", () => {
  let manager: SessionManager;
  let bridge: TmuxBridge;
  let registry: AdapterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    bridge = new (vi.mocked(TmuxBridge))();
    const adapter = new (vi.mocked(ClaudeAdapter))();

    // Setup adapter mock
    Object.defineProperty(adapter, "id", { value: "claude", configurable: true });
    Object.defineProperty(adapter, "displayName", { value: "Claude", configurable: true });
    vi.mocked(adapter.launch).mockResolvedValue("as-claude-0:0.0");
    vi.mocked(adapter.sendPrompt).mockResolvedValue(undefined);
    vi.mocked(adapter.shutdown).mockResolvedValue(undefined);
    vi.mocked(adapter.getPatterns).mockReturnValue({
      idle: [/❯\s*$/m], active: [], waitingInput: [], error: [],
    });

    vi.mocked(bridge.killSession).mockResolvedValue(undefined);
    vi.mocked(bridge.capturePane).mockResolvedValue({
      content: "❯", lines: ["❯"], timestamp: Date.now(),
    });

    registry = new AdapterRegistry();
    registry.register(adapter as any);
    manager = new SessionManager(bridge, registry);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("createSession assigns sequential ids", async () => {
    const launchPromise0 = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    const s0 = await launchPromise0;

    const launchPromise1 = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    const s1 = await launchPromise1;

    expect(s0.id).toBe("claude-0");
    expect(s1.id).toBe("claude-1");
  });

  it("listSessions returns all sessions", async () => {
    const p = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    await p;
    expect(manager.listSessions()).toHaveLength(1);
  });

  it("getSession returns session by id", async () => {
    const p = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    const s = await p;
    expect(manager.getSession(s.id)).toBe(s);
  });

  it("getSession returns undefined for unknown id", () => {
    expect(manager.getSession("unknown")).toBeUndefined();
  });

  it("destroySession removes session and kills tmux", async () => {
    const p = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    const s = await p;
    await manager.destroySession(s.id);
    expect(manager.getSession(s.id)).toBeUndefined();
    expect(bridge.killSession).toHaveBeenCalledWith(s.tmuxSession);
  });

  it("sendPrompt calls adapter.sendPrompt", async () => {
    const p = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    const s = await p;
    const sendP = manager.sendPrompt(s.id, "hello");
    await vi.runAllTimersAsync();
    await sendP;
    const adapter = registry.get("claude") as any;
    expect(adapter.sendPrompt).toHaveBeenCalled();
  });

  it("emits status_change event when status updates", async () => {
    const changes: string[] = [];
    manager.on("status_change", (id, old, next) => changes.push(`${old}->${next}`));
    const p = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    await p;
    expect(changes).toContain("launching->idle");
  });

  it("sendAndWait returns output and emits settled", async () => {
    const p = manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    const s = await p;

    // 让 capturePane 返回 idle 内容（使 waitForSettled 快速结束）
    vi.mocked(bridge.capturePane).mockResolvedValue({
      content: "❯", lines: ["❯"], timestamp: Date.now(),
    });

    const settled: any[] = [];
    manager.on("settled", (...args) => settled.push(args));

    const waitP = manager.sendAndWait(s.id, "hello", 5000);
    await vi.runAllTimersAsync();
    const output = await waitP;

    expect(typeof output).toBe("string");
    expect(settled.length).toBeGreaterThan(0);
  });
});
