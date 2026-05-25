import { createHash } from "node:crypto";
import type { TmuxBridge } from "../tmux/bridge.js";
import type { AgentPatterns } from "../adapters/base.js";
import type { PaneAnalysis, WaitOptions, WaitResult } from "./types.js";

const POLL_INTERVAL_MS = 500;
const STABLE_THRESHOLD_MS = 1_500;
const CAPTURE_LINES = 50;

export class StateDetector {
  constructor(
    private bridge: TmuxBridge,
    private patterns: AgentPatterns,
    private config = {
      pollIntervalMs: POLL_INTERVAL_MS,
      stableThresholdMs: STABLE_THRESHOLD_MS,
      captureLines: CAPTURE_LINES,
    },
  ) {}

  quickCheck(content: string): PaneAnalysis | null {
    const tail = content.split("\n").slice(-8).join("\n");
    for (const p of this.patterns.error) {
      if (p.test(tail)) return { status: "error", confidence: 0.9, detail: "error pattern" };
    }
    for (const p of this.patterns.waitingInput) {
      if (p.test(tail)) return { status: "waiting_input", confidence: 0.85, detail: "waiting pattern" };
    }
    for (const p of this.patterns.active) {
      if (p.test(tail)) return { status: "active", confidence: 0.8, detail: "active pattern" };
    }
    for (const p of this.patterns.idle) {
      if (p.test(tail)) return { status: "idle", confidence: 0.75, detail: "idle pattern" };
    }
    return null;
  }

  async captureHash(paneTarget: string): Promise<string> {
    const capture = await this.bridge.capturePane(paneTarget, {
      startLine: -this.config.captureLines,
    });
    return createHash("md5").update(capture.content).digest("hex");
  }

  async waitForSettled(paneTarget: string, opts: WaitOptions): Promise<WaitResult> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const start = Date.now();
    let lastHash = opts.preHash;
    let lastChangeTime = Date.now();
    let lastContent = "";
    let phase: 1 | 2 = 1;

    while (true) {
      if (Date.now() - start >= timeoutMs) {
        return { analysis: { status: "active", confidence: 0, detail: "timeout" }, content: lastContent, timedOut: true };
      }
      if (opts.isAborted?.()) {
        return { analysis: { status: "idle", confidence: 0, detail: "aborted" }, content: lastContent, timedOut: false };
      }

      await new Promise((r) => setTimeout(r, this.config.pollIntervalMs));

      const capture = await this.bridge.capturePane(paneTarget, {
        startLine: -this.config.captureLines,
      });
      const hash = createHash("md5").update(capture.content).digest("hex");

      if (phase === 1) {
        if (hash !== opts.preHash) {
          lastHash = hash;
          lastChangeTime = Date.now();
          lastContent = capture.content;
          phase = 2;
        }
        continue;
      }

      if (hash !== lastHash) {
        lastHash = hash;
        lastChangeTime = Date.now();
        lastContent = capture.content;
        const quick = this.quickCheck(capture.content);
        if (quick && (quick.status === "error" || quick.status === "waiting_input")) {
          return { analysis: quick, content: capture.content, timedOut: false };
        }
        continue;
      }

      if (Date.now() - lastChangeTime >= this.config.stableThresholdMs) {
        const quick = this.quickCheck(lastContent);
        if (quick) {
          if (quick.status === "active" && quick.confidence > 0.7) {
            lastChangeTime = Date.now();
            continue;
          }
          return { analysis: quick, content: lastContent, timedOut: false };
        }
        return {
          analysis: { status: "idle", confidence: 0.5, detail: "stable, no pattern" },
          content: lastContent,
          timedOut: false,
        };
      }
    }
  }
}
