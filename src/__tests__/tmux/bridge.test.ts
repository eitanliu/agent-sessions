import { describe, it, expect, vi, beforeEach } from "vitest";
import { TmuxBridge } from "../../tmux/bridge.js";
import { TmuxError } from "../../tmux/types.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

const mockExecFile = vi.mocked(
  (await import("node:child_process")).execFile
);

function mockSuccess(stdout: string) {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb: any) => {
    cb(null, stdout, "");
  });
}

function mockFail(stderr: string, code = 1) {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb: any) => {
    const err: any = new Error(stderr);
    err.stderr = stderr;
    err.code = code;
    cb(err, "", stderr);
  });
}

describe("TmuxBridge", () => {
  let bridge: TmuxBridge;

  beforeEach(() => {
    bridge = new TmuxBridge();
    vi.clearAllMocks();
  });

  it("hasSession returns true when tmux exits 0", async () => {
    mockSuccess("");
    expect(await bridge.hasSession("my-session")).toBe(true);
  });

  it("hasSession returns false when tmux exits non-zero", async () => {
    mockFail("can't find session: my-session");
    expect(await bridge.hasSession("my-session")).toBe(false);
  });

  it("listSessions parses output correctly", async () => {
    mockSuccess("sess1|||2|||1716700000|||1\nsess2|||1|||1716700001|||0\n");
    const sessions = await bridge.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      name: "sess1", windows: 2, created: 1716700000, attached: true,
    });
    expect(sessions[1].attached).toBe(false);
  });

  it("capturePane trims trailing newlines", async () => {
    mockSuccess("line1\nline2\n\n\n");
    const result = await bridge.capturePane("sess:0.0");
    expect(result.content).toBe("line1\nline2");
    expect(result.lines).toEqual(["line1", "line2"]);
  });

  it("sendText uses send-keys for short text", async () => {
    mockSuccess("");
    await bridge.sendText("sess:0.0", "hello");
    expect(mockExecFile).toHaveBeenCalledOnce();
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("send-keys");
    expect(args).toContain("-l");
    expect(args).toContain("hello");
  });

  it("static target builds correct string", () => {
    expect(TmuxBridge.target("s")).toBe("s");
    expect(TmuxBridge.target("s", 0)).toBe("s:0");
    expect(TmuxBridge.target("s", 0, 0)).toBe("s:0.0");
  });

  it("throws TmuxError on exec failure", async () => {
    mockFail("no server running", 1);
    await expect(bridge.createSession("x")).rejects.toBeInstanceOf(TmuxError);
  });

  it("sendText uses load-buffer + paste-buffer for long text", async () => {
    // 三次 exec 调用：load-buffer + paste-buffer
    mockSuccess("");  // load-buffer
    mockSuccess("");  // paste-buffer
    const longText = "x".repeat(201);
    await bridge.sendText("sess:0.0", longText);
    // 第一次调用：应该是 load-buffer
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    const firstArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(firstArgs).toContain("load-buffer");
    const secondArgs = mockExecFile.mock.calls[1][1] as string[];
    expect(secondArgs).toContain("paste-buffer");
  });
});
