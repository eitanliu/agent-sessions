import type { TmuxBridge } from "../../tmux/bridge.js";
import type { AgentAdapter, AgentAdapterId, AgentPatterns, LaunchConfig } from "../base.js";
import { TmuxBridge as TmuxBridgeClass } from "../../tmux/bridge.js";
import { CLAUDE_PATTERNS } from "./patterns.js";

const INIT_WAIT_MS = 10_000;

export class ClaudeAdapter implements AgentAdapter {
  readonly id: AgentAdapterId = "claude";
  readonly displayName = "Claude";

  async launch(bridge: TmuxBridge, config: LaunchConfig): Promise<string> {
    const { sessionName, workingDir, bypassPermissions, resumeSessionId } = config;
    if (!(await bridge.hasSession(sessionName))) {
      await bridge.createSession(sessionName, { cwd: workingDir });
    }
    const paneTarget = TmuxBridgeClass.target(sessionName, 0, 0);
    const parts: string[] = ["claude"];
    if (resumeSessionId) parts.push("--resume", resumeSessionId);
    if (bypassPermissions) parts.push("--dangerously-skip-permissions");
    await bridge.sendText(paneTarget, parts.join(" "));
    await new Promise((r) => setTimeout(r, 200));
    await bridge.sendEnter(paneTarget);
    await new Promise((r) => setTimeout(r, INIT_WAIT_MS));
    return paneTarget;
  }

  async sendPrompt(bridge: TmuxBridge, paneTarget: string, prompt: string): Promise<void> {
    await bridge.sendText(paneTarget, prompt);
    await new Promise((r) => setTimeout(r, 100));
    await bridge.sendEnter(paneTarget);
  }

  async sendResponse(bridge: TmuxBridge, paneTarget: string, response: string): Promise<void> {
    if (response === "Enter") { await bridge.sendEnter(paneTarget); return; }
    if (response === "Escape") { await bridge.sendEscape(paneTarget); return; }
    if (response === "y") {
      await bridge.sendKeys(paneTarget, "y");
      await bridge.sendEnter(paneTarget);
      return;
    }
    await bridge.sendText(paneTarget, response);
    await bridge.sendEnter(paneTarget);
  }

  async abort(bridge: TmuxBridge, paneTarget: string): Promise<void> {
    await bridge.sendCtrlC(paneTarget);
    await new Promise((r) => setTimeout(r, 20));
    await bridge.sendCtrlC(paneTarget);
  }

  async shutdown(bridge: TmuxBridge, paneTarget: string): Promise<void> {
    await bridge.sendText(paneTarget, "/exit");
    await bridge.sendEnter(paneTarget);
    await new Promise((r) => setTimeout(r, 1_000));
  }

  getPatterns(): AgentPatterns {
    return CLAUDE_PATTERNS;
  }
}
