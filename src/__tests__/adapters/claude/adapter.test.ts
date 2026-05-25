import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeAdapter } from "../../../adapters/claude/adapter.js";
import { TmuxBridge } from "../../../tmux/bridge.js";

vi.mock("../../../tmux/bridge.js", () => {
  const mockBridgeInstance = {
    hasSession: vi.fn(),
    createSession: vi.fn(),
    sendText: vi.fn(),
    sendEnter: vi.fn(),
    sendKeys: vi.fn(),
    sendCtrlC: vi.fn(),
    sendEscape: vi.fn(),
    capturePane: vi.fn(),
    runInPane: vi.fn(),
  };
  const MockTmuxBridge = vi.fn(() => mockBridgeInstance);
  // 保留静态方法
  (MockTmuxBridge as any).target = (session: string, window?: string | number, pane?: string | number): string => {
    let t = session;
    if (window !== undefined) t += `:${window}`;
    if (pane !== undefined) t += `.${pane}`;
    return t;
  };
  return { TmuxBridge: MockTmuxBridge };
});

describe("ClaudeAdapter", () => {
  let adapter: ClaudeAdapter;
  let bridge: TmuxBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    bridge = new (vi.mocked(TmuxBridge))();
    adapter = new ClaudeAdapter();

    vi.mocked(bridge.hasSession).mockResolvedValue(false);
    vi.mocked(bridge.createSession).mockResolvedValue(undefined);
    vi.mocked(bridge.sendText).mockResolvedValue(undefined);
    vi.mocked(bridge.sendEnter).mockResolvedValue(undefined);
    vi.mocked(bridge.sendKeys).mockResolvedValue(undefined);
    vi.mocked(bridge.sendCtrlC).mockResolvedValue(undefined);
    vi.mocked(bridge.runInPane).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("launch creates session if not exists and returns pane target", async () => {
    const launchPromise = adapter.launch(bridge, {
      sessionName: "as-claude-0",
      workingDir: "/tmp",
    });
    await vi.runAllTimersAsync();
    const paneTarget = await launchPromise;
    expect(bridge.createSession).toHaveBeenCalledWith("as-claude-0", { cwd: "/tmp" });
    expect(paneTarget).toBe("as-claude-0:0.0");
  });

  it("launch skips createSession if session already exists", async () => {
    vi.mocked(bridge.hasSession).mockResolvedValue(true);
    const launchPromise = adapter.launch(bridge, { sessionName: "as-claude-0", workingDir: "/tmp" });
    await vi.runAllTimersAsync();
    await launchPromise;
    expect(bridge.createSession).not.toHaveBeenCalled();
  });

  it("sendPrompt sends text then enter", async () => {
    const sendPromise = adapter.sendPrompt(bridge, "as-claude-0:0.0", "hello world");
    await vi.runAllTimersAsync();
    await sendPromise;
    expect(bridge.sendText).toHaveBeenCalledWith("as-claude-0:0.0", "hello world");
    expect(bridge.sendEnter).toHaveBeenCalledWith("as-claude-0:0.0");
  });

  it("abort sends two Ctrl+C", async () => {
    const abortPromise = adapter.abort(bridge, "as-claude-0:0.0");
    await vi.runAllTimersAsync();
    await abortPromise;
    expect(bridge.sendCtrlC).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.sendCtrlC).mock.calls[0][0]).toBe("as-claude-0:0.0");
  });

  it("shutdown sends /exit and enter", async () => {
    const shutdownPromise = adapter.shutdown(bridge, "as-claude-0:0.0");
    await vi.runAllTimersAsync();
    await shutdownPromise;
    expect(bridge.sendText).toHaveBeenCalledWith("as-claude-0:0.0", "/exit");
    expect(bridge.sendEnter).toHaveBeenCalled();
  });

  it("getPatterns returns CLAUDE_PATTERNS with idle matching ❯", () => {
    const patterns = adapter.getPatterns();
    expect(patterns.idle.length).toBeGreaterThan(0);
    expect(patterns.idle[0].test("❯")).toBe(true);
  });

  it("sendResponse('Enter') calls sendEnter", async () => {
    await adapter.sendResponse(bridge, "as-claude-0:0.0", "Enter");
    expect(bridge.sendEnter).toHaveBeenCalledWith("as-claude-0:0.0");
  });

  it("sendResponse('y') sends y then enter", async () => {
    await adapter.sendResponse(bridge, "as-claude-0:0.0", "y");
    expect(bridge.sendKeys).toHaveBeenCalledWith("as-claude-0:0.0", "y");
    expect(bridge.sendEnter).toHaveBeenCalled();
  });
});
