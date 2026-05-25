import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { SessionView } from "../../repl/session-view.js";
import type { SessionManager } from "../../sessions/manager.js";
import type { AgentSession } from "../../sessions/types.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0 }),
}));

const mockedSpawnSync = vi.mocked(spawnSync);

function makeManager(sessions: Partial<AgentSession>[] = []): SessionManager {
  return {
    getSession: vi.fn((id: string) => sessions.find(s => s.id === id) as AgentSession | undefined),
    listSessions: vi.fn(() => sessions as AgentSession[]),
  } as unknown as SessionManager;
}

describe("SessionView", () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.clearAllMocks();
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    manager = makeManager([{
      id: "claude-0", status: "idle", workingDir: "/tmp",
      adapterId: "claude", tmuxSession: "as-claude-0", paneTarget: "as-claude-0:0.0",
      createdAt: Date.now(), lastStatusChange: Date.now(), lastOutput: "",
    }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enter returns 'back' for unknown session", () => {
    const view = new SessionView(manager);
    expect(view.enter("unknown-id")).toBe("back");
  });

  it("enter calls tmux attach-session with correct session name", () => {
    const view = new SessionView(manager);
    view.enter("claude-0");
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "tmux",
      ["attach-session", "-t", "as-claude-0"],
      { stdio: "inherit" },
    );
  });

  it("enter returns 'back' when tmux exits 0 (normal detach)", () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const view = new SessionView(manager);
    expect(view.enter("claude-0")).toBe("back");
  });

  it("enter returns 'exit' when tmux exits non-zero", () => {
    mockedSpawnSync.mockReturnValue({ status: 1 } as any);
    const view = new SessionView(manager);
    expect(view.enter("claude-0")).toBe("exit");
  });
});

