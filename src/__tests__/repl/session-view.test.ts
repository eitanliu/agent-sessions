import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionView } from "../../repl/session-view.js";
import type { SessionManager } from "../../sessions/manager.js";
import type { AgentSession } from "../../sessions/types.js";

function makeManager(sessions: Partial<AgentSession>[] = []): SessionManager {
  return {
    getSession: vi.fn((id: string) => sessions.find(s => s.id === id) as AgentSession | undefined),
    listSessions: vi.fn(() => sessions as AgentSession[]),
    readOutput: vi.fn().mockResolvedValue("some output"),
    sendAndWait: vi.fn().mockResolvedValue("response from claude"),
  } as unknown as SessionManager;
}

describe("SessionView", () => {
  let view: SessionView;
  let manager: SessionManager;

  beforeEach(() => {
    Object.defineProperty(process.stdout, "rows", { value: 24, configurable: true });
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    manager = makeManager([{
      id: "claude-0", status: "idle", workingDir: "/tmp",
      adapterId: "claude", tmuxSession: "as-claude-0", paneTarget: "as-claude-0:0.0",
      createdAt: Date.now(), lastStatusChange: Date.now(), lastOutput: "",
    }]);
    view = new SessionView(manager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formatStatusBar contains session id and Esc hint", () => {
    const bar = (view as any).formatStatusBar("claude-0", "idle", "/tmp");
    expect(bar).toContain("claude-0");
    expect(bar).toContain("Esc");
  });

  it("formatInputLine contains > prefix and input text", () => {
    const line = (view as any).formatInputLine("hello", "idle");
    expect(line).toContain(">");
    expect(line).toContain("hello");
  });

  it("appendOutputLine trims to maxOutputLines", () => {
    const v = view as any;
    v.maxOutputLines = 3;
    v.outputLines = ["a", "b", "c"];
    v.appendOutputLine("d");
    expect(v.outputLines).toEqual(["b", "c", "d"]);
  });

  it("sendMessage calls manager.sendAndWait and appends response", async () => {
    const v = view as any;
    v.sessionId = "claude-0";
    v.outputLines = [];
    await v.handleSend("hi");
    expect(manager.sendAndWait).toHaveBeenCalledWith("claude-0", "hi", 120000);
    expect(v.outputLines.some((l: string) => l.includes("response from claude"))).toBe(true);
  });
});
