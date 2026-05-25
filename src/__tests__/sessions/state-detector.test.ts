import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StateDetector } from "../../sessions/state-detector.js";
import { TmuxBridge } from "../../tmux/bridge.js";
import { CLAUDE_PATTERNS } from "../../adapters/claude/patterns.js";

vi.mock("../../tmux/bridge.js");

function makeBridge(lines: string[]): TmuxBridge {
  const b = new (vi.mocked(TmuxBridge))();
  vi.mocked(b.capturePane).mockResolvedValue({
    content: lines.join("\n"),
    lines,
    timestamp: Date.now(),
  });
  return b;
}

describe("StateDetector.quickCheck", () => {
  let detector: StateDetector;

  beforeEach(() => {
    detector = new StateDetector(new (vi.mocked(TmuxBridge))(), CLAUDE_PATTERNS);
  });

  it("detects idle when pane ends with ❯", () => {
    expect(detector.quickCheck("some output\n❯").status).toBe("idle");
  });

  it("detects active with spinner char", () => {
    expect(detector.quickCheck("⠙ Thinking...").status).toBe("active");
  });

  it("detects waitingInput with y/n prompt", () => {
    expect(detector.quickCheck("Allow access? (y/n)").status).toBe("waiting_input");
  });

  it("detects error with 'Error:' prefix", () => {
    expect(detector.quickCheck("Error: something went wrong").status).toBe("error");
  });

  it("returns null for unknown content", () => {
    expect(detector.quickCheck("some random output with no signals")).toBeNull();
  });

  it("error takes priority over active", () => {
    expect(detector.quickCheck("⠙ Running\nError: failed").status).toBe("error");
  });
});

describe("StateDetector.captureHash", () => {
  it("returns md5 hex string of pane content", async () => {
    const bridge = makeBridge(["hello"]);
    const detector = new StateDetector(bridge, CLAUDE_PATTERNS);
    const hash = await detector.captureHash("sess:0.0");
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  it("same content returns same hash", async () => {
    const bridge1 = makeBridge(["hello"]);
    const bridge2 = makeBridge(["hello"]);
    const d1 = new StateDetector(bridge1, CLAUDE_PATTERNS);
    const d2 = new StateDetector(bridge2, CLAUDE_PATTERNS);
    expect(await d1.captureHash("t")).toBe(await d2.captureHash("t"));
  });

  it("different content returns different hash", async () => {
    const bridge1 = makeBridge(["hello"]);
    const bridge2 = makeBridge(["world"]);
    const d1 = new StateDetector(bridge1, CLAUDE_PATTERNS);
    const d2 = new StateDetector(bridge2, CLAUDE_PATTERNS);
    expect(await d1.captureHash("t")).not.toBe(await d2.captureHash("t"));
  });
});

describe("StateDetector.waitForSettled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns timedOut:true when content never changes", async () => {
    // bridge 每次 capturePane 返回相同内容 -> hash 不变 -> phase1 永不推进 -> timeout
    const bridge = makeBridge(["❯"]);
    vi.mocked(bridge.capturePane).mockResolvedValue({
      content: "❯", lines: ["❯"], timestamp: Date.now(),
    });
    const detector = new StateDetector(bridge, CLAUDE_PATTERNS, {
      pollIntervalMs: 100,
      stableThresholdMs: 200,
      captureLines: 50,
    });
    // preHash 等于 "❯" 的 md5，这样 phase1 中 hash === preHash，永远不会推进到 phase2
    const promise = detector.waitForSettled("t", { preHash: "91a0fec27cfe1d55b75264e063475f14", timeoutMs: 500 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.timedOut).toBe(true);
  });

  it("detects idle after content stabilizes", async () => {
    const bridge = new (vi.mocked(TmuxBridge))();
    let callCount = 0;
    vi.mocked(bridge.capturePane).mockImplementation(async () => {
      callCount++;
      // 前两次返回变化内容（触发 phase2），后续返回稳定的 idle 内容
      const content = callCount <= 2 ? `output-${callCount}` : "❯";
      return { content, lines: [content], timestamp: Date.now() };
    });
    const detector = new StateDetector(bridge, CLAUDE_PATTERNS, {
      pollIntervalMs: 100,
      stableThresholdMs: 200,
      captureLines: 50,
    });

    // preHash 与初始内容不同，让 phase1 立即推进到 phase2
    const promise = detector.waitForSettled("t", { preHash: "different-hash", timeoutMs: 5000 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.analysis.status).toBe("idle");
  });

  it("fast-exits on error pattern in phase2", async () => {
    const bridge = new (vi.mocked(TmuxBridge))();
    let callCount = 0;
    vi.mocked(bridge.capturePane).mockImplementation(async () => {
      callCount++;
      const content = callCount === 1 ? "initial" : "Error: something failed";
      return { content, lines: [content], timestamp: Date.now() };
    });
    const detector = new StateDetector(bridge, CLAUDE_PATTERNS, {
      pollIntervalMs: 100,
      stableThresholdMs: 5000, // 长稳定阈值，但 error 应快速退出
      captureLines: 50,
    });
    const promise = detector.waitForSettled("t", { preHash: "different-hash", timeoutMs: 10000 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.analysis.status).toBe("error");
    expect(result.timedOut).toBe(false);
  });

  it("returns idle immediately when isAborted returns true", async () => {
    const bridge = makeBridge(["active content"]);
    const detector = new StateDetector(bridge, CLAUDE_PATTERNS, {
      pollIntervalMs: 100,
      stableThresholdMs: 200,
      captureLines: 50,
    });
    const promise = detector.waitForSettled("t", {
      preHash: "different-hash",
      timeoutMs: 10000,
      isAborted: () => true,  // 立即 abort
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.analysis.detail).toBe("aborted");
  });
});
