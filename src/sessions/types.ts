import type { AgentAdapterId } from "../adapters/base.js";

export type SessionStatus =
  | "launching"
  | "idle"
  | "active"
  | "waiting_input"
  | "error"
  | "dead";

export interface AgentSession {
  id: string;
  tmuxSession: string;
  paneTarget: string;
  adapterId: AgentAdapterId;
  workingDir: string;
  status: SessionStatus;
  createdAt: number;
  lastStatusChange: number;
  lastOutput: string;
}

export interface SessionConfig {
  adapterId: AgentAdapterId;
  workingDir: string;
  bypassPermissions?: boolean;
  resumeSessionId?: string;
}

export interface PaneAnalysis {
  status: SessionStatus;
  confidence: number;
  detail: string;
}

export interface WaitOptions {
  preHash: string;
  timeoutMs?: number;
  isAborted?: () => boolean;
}

export interface WaitResult {
  analysis: PaneAnalysis;
  content: string;
  timedOut: boolean;
}
