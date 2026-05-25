import { EventEmitter } from "node:events";
import type { TmuxBridge } from "../tmux/bridge.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { AgentAdapterId } from "../adapters/base.js";
import { StateDetector } from "./state-detector.js";
import type { AgentSession, SessionConfig, SessionStatus } from "./types.js";

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, AgentSession>();
  private detectors = new Map<string, StateDetector>();
  private counters = new Map<AgentAdapterId, number>();

  constructor(
    private bridge: TmuxBridge,
    private registry: AdapterRegistry,
  ) {
    super();
  }

  async createSession(config: SessionConfig): Promise<AgentSession> {
    const adapter = this.registry.get(config.adapterId);
    const count = this.counters.get(config.adapterId) ?? 0;
    const id = `${config.adapterId}-${count}`;
    this.counters.set(config.adapterId, count + 1);
    const tmuxSession = `as-${id}`;

    const session: AgentSession = {
      id,
      tmuxSession,
      paneTarget: "",
      adapterId: config.adapterId,
      workingDir: config.workingDir,
      status: "launching",
      createdAt: Date.now(),
      lastStatusChange: Date.now(),
      lastOutput: "",
    };
    this.sessions.set(id, session);
    this.emit("status_change", id, "launching", "launching");

    const paneTarget = await adapter.launch(this.bridge, {
      sessionName: tmuxSession,
      workingDir: config.workingDir,
      bypassPermissions: config.bypassPermissions,
      resumeSessionId: config.resumeSessionId,
    });

    session.paneTarget = paneTarget;
    this.updateStatus(session, "idle");

    const detector = new StateDetector(this.bridge, adapter.getPatterns());
    this.detectors.set(id, detector);

    return session;
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const adapter = this.registry.get(session.adapterId);
    await adapter.sendPrompt(this.bridge, session.paneTarget, prompt);
    this.updateStatus(session, "active");
  }

  async sendAndWait(sessionId: string, prompt: string, timeoutMs = 120_000): Promise<string> {
    const session = this.requireSession(sessionId);
    const detector = this.detectors.get(sessionId)!;
    const preHash = await detector.captureHash(session.paneTarget);
    await this.sendPrompt(sessionId, prompt);
    const result = await detector.waitForSettled(session.paneTarget, { preHash, timeoutMs });
    this.updateStatus(session, result.analysis.status);
    session.lastOutput = result.content;
    this.emit("settled", sessionId, result);
    return result.content;
  }

  async readOutput(sessionId: string, lines = 50): Promise<string> {
    const session = this.requireSession(sessionId);
    const capture = await this.bridge.capturePane(session.paneTarget, {
      startLine: -lines,
    });
    session.lastOutput = capture.content;
    return capture.content;
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const adapter = this.registry.get(session.adapterId);
    try {
      await adapter.shutdown(this.bridge, session.paneTarget);
    } catch { /* best-effort */ }
    await this.bridge.killSession(session.tmuxSession).catch(() => undefined);
    this.sessions.delete(sessionId);
    this.detectors.delete(sessionId);
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }

  private requireSession(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  private updateStatus(session: AgentSession, status: SessionStatus): void {
    if (session.status === status) return;
    const old = session.status;
    session.status = status;
    session.lastStatusChange = Date.now();
    this.emit("status_change", session.id, old, status);
  }
}
