import { describe, it, expect, vi, beforeEach } from "vitest";
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
