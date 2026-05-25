import type { TmuxBridge } from "../tmux/bridge.js";

export type AgentAdapterId = "claude" | "codex" | "opencode";

export interface AgentPatterns {
  idle: RegExp[];
  active: RegExp[];
  waitingInput: RegExp[];
  error: RegExp[];
}

export interface LaunchConfig {
  sessionName: string;
  workingDir: string;
  env?: Record<string, string>;
  bypassPermissions?: boolean;
  resumeSessionId?: string;
}

export interface AgentAdapter {
  readonly id: AgentAdapterId;
  readonly displayName: string;
  launch(bridge: TmuxBridge, config: LaunchConfig): Promise<string>;
  sendPrompt(bridge: TmuxBridge, paneTarget: string, prompt: string): Promise<void>;
  sendResponse(bridge: TmuxBridge, paneTarget: string, response: string): Promise<void>;
  abort(bridge: TmuxBridge, paneTarget: string): Promise<void>;
  shutdown(bridge: TmuxBridge, paneTarget: string): Promise<void>;
  getPatterns(): AgentPatterns;
}
