# agent-sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建多窗口 CLI 会话管理器，在 tmux pane 中运行多个 Claude 实例，并支持会话间输出路由。

**Architecture:** TmuxBridge 封装跨平台 tmux 命令（Windows 通过 `wsl -e tmux`）；ClaudeAdapter 用 TmuxBridge 启动并与 claude CLI 交互；SessionManager 管理多个会话并用 StateDetector 轮询状态；MessageRouter 实现会话间输出→输入转发；InteractiveREPL 提供 readline 交互界面。

**Tech Stack:** TypeScript 5.7，Node.js 25（ESM），vitest 3，chalk 5，仅用 node 内置模块（child_process、readline、crypto、fs/promises）

**命令运行环境说明**（Windows/MSYS2：先执行 export PATH="$(cygpath -u "$PROGRAMFILES")/nodejs:$PATH"）：
- 安装依赖：`npm install`
- 构建：`npm run build`
- 测试：`npm test`
- git：`git`

---

## 文件结构总览

```
src/
├── index.ts
├── tmux/
│   ├── platform.ts         # getPlatform() — 平台检测
│   ├── types.ts            # TmuxSession, TmuxPane, CaptureResult, TmuxError
│   └── bridge.ts           # TmuxBridge — execFile 封装
├── adapters/
│   ├── base.ts             # AgentAdapter 接口, AgentPatterns, LaunchConfig
│   ├── registry.ts         # AdapterRegistry
│   └── claude/
│       ├── patterns.ts     # CLAUDE_PATTERNS
│       └── adapter.ts      # ClaudeAdapter
├── sessions/
│   ├── types.ts            # AgentSession, SessionStatus, SessionConfig
│   ├── state-detector.ts   # StateDetector
│   └── manager.ts          # SessionManager
├── routing/
│   ├── types.ts            # RouteRule, MessageEnvelope, RouterEvent
│   ├── router.ts           # MessageRouter
│   └── forwarder.ts        # SessionForwarder
└── repl/
    ├── renderer.ts         # 终端渲染工具
    ├── commands.ts         # 命令解析
    ├── session-picker.ts   # 交互式会话选择
    └── repl.ts             # InteractiveREPL 主循环

src/__tests__/
├── tmux/platform.test.ts
├── tmux/bridge.test.ts
├── adapters/registry.test.ts
├── adapters/claude/adapter.test.ts
├── sessions/state-detector.test.ts
├── sessions/manager.test.ts
├── routing/router.test.ts
├── routing/forwarder.test.ts
└── repl/commands.test.ts
```

---

## Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "agent-sessions",
  "version": "0.1.0",
  "description": "多窗口 CLI 会话管理工具",
  "type": "module",
  "bin": { "agent-sessions": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "chalk": "^5.4.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 安装依赖**

```powershell
cd D:\code\ai\agent-sessions
npm install
```

期望：生成 `node_modules/`、`package-lock.json`，无报错。

- [ ] **Step 4: 提交**

```bash
GIT="$(command -v git)"
cd "$PROJECT_DIR"
"$GIT" add package.json tsconfig.json package-lock.json
"$GIT" commit -m "chore: 初始化 TypeScript ESM 项目"
```

---

## Task 2: tmux 平台检测与类型定义

**Files:**
- Create: `src/tmux/platform.ts`
- Create: `src/tmux/types.ts`
- Create: `src/__tests__/tmux/platform.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/tmux/platform.test.ts`**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

describe("getPlatform", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns 'windows' on win32", async () => {
    vi.mock("node:os", () => ({ platform: () => "win32" }));
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    expect(getPlatform()).toBe("windows");
  });

  it("returns 'wsl' when WSL_DISTRO_NAME is set", async () => {
    vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu-24.04");
    vi.mock("node:os", () => ({ platform: () => "linux" }));
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    expect(getPlatform()).toBe("wsl");
  });

  it("returns 'linux' on linux without WSL env", async () => {
    vi.stubEnv("WSL_DISTRO_NAME", "");
    vi.stubEnv("WSLENV", "");
    vi.mock("node:os", () => ({ platform: () => "linux" }));
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    expect(getPlatform()).toBe("linux");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "platform"
```

期望：FAIL，`Cannot find module '../../tmux/platform.js'`

- [ ] **Step 3: 创建 `src/tmux/platform.ts`**

```typescript
import { platform } from "node:os";

export type Platform = "windows" | "wsl" | "linux" | "macos";

let _cached: Platform | null = null;

export function getPlatform(): Platform {
  if (_cached) return _cached;
  if (platform() === "win32") return (_cached = "windows");
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) return (_cached = "wsl");
  return (_cached = platform() === "darwin" ? "macos" : "linux");
}

export function resetPlatformCache(): void {
  _cached = null;
}
```

- [ ] **Step 4: 创建 `src/tmux/types.ts`**

```typescript
export interface TmuxSession {
  name: string;
  windows: number;
  created: number;
  attached: boolean;
}

export interface TmuxPane {
  id: string;
  index: number;
  width: number;
  height: number;
  active: boolean;
  pid: number;
  currentCommand: string;
}

export interface CaptureResult {
  content: string;
  lines: string[];
  timestamp: number;
}

export interface CaptureOptions {
  startLine?: number;
  endLine?: number;
  escapeSequences?: boolean;
}

export interface SendKeysOptions {
  literal?: boolean;
}

export class TmuxError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "TmuxError";
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "platform|PASS|FAIL"
```

期望：platform 测试 PASS

- [ ] **Step 6: 提交**

```bash
"$GIT" add src/tmux/platform.ts src/tmux/types.ts src/__tests__/tmux/platform.test.ts
"$GIT" commit -m "feat: tmux 平台检测与类型定义"
```

---

## Task 3: TmuxBridge

**Files:**
- Create: `src/tmux/bridge.ts`
- Create: `src/__tests__/tmux/bridge.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/tmux/bridge.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TmuxBridge } from "../../tmux/bridge.js";
import { TmuxError } from "../../tmux/types.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
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
});
```

- [ ] **Step 2: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "bridge|PASS|FAIL" | head -20
```

期望：FAIL，`Cannot find module '../../tmux/bridge.js'`

- [ ] **Step 3: 创建 `src/tmux/bridge.ts`**

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getPlatform } from "./platform.js";
import type { TmuxSession, TmuxPane, CaptureResult, CaptureOptions, SendKeysOptions } from "./types.js";
import { TmuxError } from "./types.js";

const execFileAsync = promisify(execFile);
const SEP = "|||";

export class TmuxBridge {
  private async exec(args: string[]): Promise<string> {
    const plat = getPlatform();
    const [cmd, fullArgs] =
      plat === "windows"
        ? ["wsl", ["-e", "tmux", ...args]]
        : ["tmux", args];
    try {
      const { stdout } = await execFileAsync(cmd, fullArgs, {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      return stdout;
    } catch (err: any) {
      throw new TmuxError(
        `tmux ${args.join(" ")} failed: ${err.stderr || err.message}`,
        args.join(" "),
        err.code ?? null,
        err.stderr ?? "",
      );
    }
  }

  static target(session: string, window?: string | number, pane?: string | number): string {
    let t = session;
    if (window !== undefined) t += `:${window}`;
    if (pane !== undefined) t += `.${pane}`;
    return t;
  }

  async createSession(name: string, opts?: { cwd?: string }): Promise<void> {
    const args = ["new-session", "-d", "-s", name];
    if (opts?.cwd) args.push("-c", opts.cwd);
    await this.exec(args);
  }

  async hasSession(name: string): Promise<boolean> {
    try {
      await this.exec(["has-session", "-t", name]);
      return true;
    } catch {
      return false;
    }
  }

  async killSession(name: string): Promise<void> {
    await this.exec(["kill-session", "-t", name]);
  }

  async listSessions(): Promise<TmuxSession[]> {
    const fmt = `#{session_name}${SEP}#{session_windows}${SEP}#{session_created}${SEP}#{session_attached}`;
    const out = await this.exec(["list-sessions", "-F", fmt]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, windows, created, attached] = line.split(SEP);
        return {
          name,
          windows: parseInt(windows, 10),
          created: parseInt(created, 10),
          attached: attached.trim() === "1",
        };
      });
  }

  async sendKeys(target: string, keys: string, opts?: SendKeysOptions): Promise<void> {
    const args = ["send-keys", "-t", target];
    if (opts?.literal) args.push("-l");
    args.push(keys);
    await this.exec(args);
  }

  async sendText(target: string, text: string): Promise<void> {
    if (text.length <= 200) {
      await this.sendKeys(target, text, { literal: true });
      return;
    }
    const plat = getPlatform();
    if (plat === "windows") {
      const tmpPath = `/tmp/as-${randomUUID()}.txt`;
      await execFileAsync("wsl", ["-e", "sh", "-c", `cat > ${tmpPath}`], {
        ...(({ input: text } as any)),
        timeout: 5_000,
      });
      try {
        await this.exec(["load-buffer", tmpPath]);
        await this.exec(["paste-buffer", "-t", target, "-d"]);
      } finally {
        await execFileAsync("wsl", ["-e", "rm", "-f", tmpPath]).catch(() => undefined);
      }
    } else {
      const tmpPath = join(tmpdir(), `as-${randomUUID()}.txt`);
      await writeFile(tmpPath, text, "utf8");
      try {
        await this.exec(["load-buffer", tmpPath]);
        await this.exec(["paste-buffer", "-t", target, "-d"]);
      } finally {
        await unlink(tmpPath).catch(() => undefined);
      }
    }
  }

  async sendEnter(target: string): Promise<void> {
    await this.sendKeys(target, "Enter");
  }

  async sendCtrlC(target: string): Promise<void> {
    await this.sendKeys(target, "C-c");
  }

  async sendEscape(target: string): Promise<void> {
    await this.sendKeys(target, "Escape");
  }

  async capturePane(target: string, opts?: CaptureOptions): Promise<CaptureResult> {
    const args = ["capture-pane", "-t", target, "-p"];
    if (opts?.escapeSequences) args.push("-e");
    if (opts?.startLine !== undefined) args.push("-S", String(opts.startLine));
    if (opts?.endLine !== undefined) args.push("-E", String(opts.endLine));
    const raw = await this.exec(args);
    const content = raw.replace(/\n+$/, "");
    return { content, lines: content.split("\n"), timestamp: Date.now() };
  }

  async runInPane(target: string, command: string): Promise<void> {
    await this.sendText(target, command);
    await this.sendEnter(target);
  }

  async listPanes(target: string): Promise<TmuxPane[]> {
    const fmt = [
      "#{pane_id}", "#{pane_index}", "#{pane_width}", "#{pane_height}",
      "#{pane_active}", "#{pane_pid}", "#{pane_current_command}",
    ].join(SEP);
    const out = await this.exec(["list-panes", "-t", target, "-F", fmt]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [id, index, width, height, active, pid, currentCommand] = line.split(SEP);
        return {
          id,
          index: parseInt(index, 10),
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          active: active.trim() === "1",
          pid: parseInt(pid, 10),
          currentCommand: currentCommand.trim(),
        };
      });
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "bridge|platform|PASS|FAIL"
```

期望：全部 PASS

- [ ] **Step 5: 提交**

```bash
"$GIT" add src/tmux/bridge.ts src/__tests__/tmux/bridge.test.ts
"$GIT" commit -m "feat: TmuxBridge — 跨平台 tmux 命令封装"
```

---

## Task 4: 适配器接口与注册表

**Files:**
- Create: `src/adapters/base.ts`
- Create: `src/adapters/registry.ts`
- Create: `src/__tests__/adapters/registry.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/adapters/registry.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "../../adapters/registry.js";
import type { AgentAdapter, AgentPatterns } from "../../adapters/base.js";

const mockAdapter: AgentAdapter = {
  id: "claude",
  displayName: "Claude",
  launch: async () => "sess:0.0",
  sendPrompt: async () => {},
  sendResponse: async () => {},
  abort: async () => {},
  shutdown: async () => {},
  getPatterns: (): AgentPatterns => ({
    idle: [], active: [], waitingInput: [], error: [],
  }),
};

describe("AdapterRegistry", () => {
  it("registers and retrieves an adapter", () => {
    const registry = new AdapterRegistry();
    registry.register(mockAdapter);
    expect(registry.get("claude")).toBe(mockAdapter);
  });

  it("throws on unknown adapter id", () => {
    const registry = new AdapterRegistry();
    expect(() => registry.get("codex")).toThrow("Unknown adapter: codex");
  });

  it("lists registered adapter ids", () => {
    const registry = new AdapterRegistry();
    registry.register(mockAdapter);
    expect(registry.list()).toEqual(["claude"]);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "registry|FAIL"
```

期望：FAIL，`Cannot find module '../../adapters/registry.js'`

- [ ] **Step 3: 创建 `src/adapters/base.ts`**

```typescript
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
```

- [ ] **Step 4: 创建 `src/adapters/registry.ts`**

```typescript
import type { AgentAdapter, AgentAdapterId } from "./base.js";

export class AdapterRegistry {
  private adapters = new Map<AgentAdapterId, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentAdapterId): AgentAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown adapter: ${id}`);
    return adapter;
  }

  list(): AgentAdapterId[] {
    return [...this.adapters.keys()];
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "registry|platform|bridge|PASS|FAIL"
```

期望：全部 PASS

- [ ] **Step 6: 提交**

```bash
"$GIT" add src/adapters/base.ts src/adapters/registry.ts src/__tests__/adapters/registry.test.ts
"$GIT" commit -m "feat: 适配器抽象接口与注册表"
```

---

## Task 5: Claude 适配器

**Files:**
- Create: `src/adapters/claude/patterns.ts`
- Create: `src/adapters/claude/adapter.ts`
- Create: `src/__tests__/adapters/claude/adapter.test.ts`

- [ ] **Step 1: 创建 `src/adapters/claude/patterns.ts`**

```typescript
import type { AgentPatterns } from "../base.js";

export const CLAUDE_PATTERNS: AgentPatterns = {
  idle: [/❯\s*$/m],
  active: [
    /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,
    /\.\.\.\s*$/m,
    /Reading|Writing|Editing|Running|Thinking/i,
  ],
  waitingInput: [
    /\(y\/n\)/i,
    /\bAllow\b.*\?/i,
    /❯\s*\d+[.)]\s/,
    /Do you want to/i,
  ],
  error: [
    /^\s*Error:/m,
    /ENOENT|EACCES|EPERM/,
    /Connection refused/i,
    /command not found/i,
    /API Error/i,
  ],
};
```

- [ ] **Step 2: 写失败测试 `src/__tests__/adapters/claude/adapter.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeAdapter } from "../../../adapters/claude/adapter.js";
import { TmuxBridge } from "../../../tmux/bridge.js";

vi.mock("../../../tmux/bridge.js");

const MockBridge = vi.mocked(TmuxBridge);

describe("ClaudeAdapter", () => {
  let adapter: ClaudeAdapter;
  let bridge: TmuxBridge;

  beforeEach(() => {
    MockBridge.mockClear();
    bridge = new TmuxBridge();
    adapter = new ClaudeAdapter();

    vi.mocked(bridge.hasSession).mockResolvedValue(false);
    vi.mocked(bridge.createSession).mockResolvedValue(undefined);
    vi.mocked(bridge.sendText).mockResolvedValue(undefined);
    vi.mocked(bridge.sendEnter).mockResolvedValue(undefined);
    vi.mocked(bridge.sendKeys).mockResolvedValue(undefined);
    vi.mocked(bridge.capturePane).mockResolvedValue({
      content: "❯", lines: ["❯"], timestamp: Date.now(),
    });
  });

  it("launch creates session if not exists and returns pane target", async () => {
    const paneTarget = await adapter.launch(bridge, {
      sessionName: "as-claude-0",
      workingDir: "/tmp",
    });
    expect(bridge.createSession).toHaveBeenCalledWith("as-claude-0", { cwd: "/tmp" });
    expect(paneTarget).toBe("as-claude-0:0.0");
  });

  it("launch skips createSession if session already exists", async () => {
    vi.mocked(bridge.hasSession).mockResolvedValue(true);
    await adapter.launch(bridge, { sessionName: "as-claude-0", workingDir: "/tmp" });
    expect(bridge.createSession).not.toHaveBeenCalled();
  });

  it("sendPrompt sends text then enter", async () => {
    await adapter.sendPrompt(bridge, "as-claude-0:0.0", "hello world");
    expect(bridge.sendText).toHaveBeenCalledWith("as-claude-0:0.0", "hello world");
    expect(bridge.sendEnter).toHaveBeenCalledWith("as-claude-0:0.0");
  });

  it("abort sends two Ctrl+C", async () => {
    await adapter.abort(bridge, "as-claude-0:0.0");
    expect(bridge.sendKeys).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.sendKeys).mock.calls[0][1]).toBe("C-c");
  });

  it("shutdown sends /exit and enter", async () => {
    await adapter.shutdown(bridge, "as-claude-0:0.0");
    expect(bridge.sendText).toHaveBeenCalledWith("as-claude-0:0.0", "/exit");
    expect(bridge.sendEnter).toHaveBeenCalled();
  });

  it("getPatterns returns CLAUDE_PATTERNS", () => {
    const patterns = adapter.getPatterns();
    expect(patterns.idle.length).toBeGreaterThan(0);
    expect(patterns.idle[0].test("❯")).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "adapter|FAIL" | head -5
```

期望：FAIL，`Cannot find module '../../../adapters/claude/adapter.js'`

- [ ] **Step 4: 创建 `src/adapters/claude/adapter.ts`**

```typescript
import type { TmuxBridge } from "../../tmux/bridge.js";
import type { AgentAdapter, AgentAdapterId, AgentPatterns, LaunchConfig } from "../base.js";
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
    const paneTarget = TmuxBridge.target(sessionName, 0, 0);
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
```

- [ ] **Step 5: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | tail -20
```

期望：全部 PASS

- [ ] **Step 6: 提交**

```bash
"$GIT" add src/adapters/claude/ src/__tests__/adapters/claude/
"$GIT" commit -m "feat: Claude CLI 适配器"
```

---

## Task 6: 会话类型与状态检测器

**Files:**
- Create: `src/sessions/types.ts`
- Create: `src/sessions/state-detector.ts`
- Create: `src/__tests__/sessions/state-detector.test.ts`

- [ ] **Step 1: 创建 `src/sessions/types.ts`**

```typescript
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
```

- [ ] **Step 2: 写失败测试 `src/__tests__/sessions/state-detector.test.ts`**

```typescript
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
    detector = new StateDetector(new TmuxBridge(), CLAUDE_PATTERNS);
  });

  it("detects idle when pane ends with ❯", () => {
    const result = detector.quickCheck("some output\n❯");
    expect(result?.status).toBe("idle");
  });

  it("detects active with spinner char", () => {
    const result = detector.quickCheck("⠙ Thinking...");
    expect(result?.status).toBe("active");
  });

  it("detects waitingInput with y/n prompt", () => {
    const result = detector.quickCheck("Allow access? (y/n)");
    expect(result?.status).toBe("waiting_input");
  });

  it("detects error with 'Error:' prefix", () => {
    const result = detector.quickCheck("Error: something went wrong");
    expect(result?.status).toBe("error");
  });

  it("returns null for unknown content", () => {
    const result = detector.quickCheck("some random output with no signals");
    expect(result).toBeNull();
  });

  it("error takes priority over active", () => {
    const result = detector.quickCheck("⠙ Running\nError: failed");
    expect(result?.status).toBe("error");
  });
});

describe("StateDetector.captureHash", () => {
  it("returns md5 hex string of pane content", async () => {
    const bridge = makeBridge(["hello"]);
    const detector = new StateDetector(bridge, CLAUDE_PATTERNS);
    const hash = await detector.captureHash("sess:0.0");
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "state-detector|FAIL" | head -5
```

期望：FAIL，`Cannot find module '../../sessions/state-detector.js'`

- [ ] **Step 4: 创建 `src/sessions/state-detector.ts`**

```typescript
import { createHash } from "node:crypto";
import type { TmuxBridge } from "../tmux/bridge.js";
import type { AgentPatterns } from "../adapters/base.js";
import type { PaneAnalysis, SessionStatus, WaitOptions, WaitResult } from "./types.js";

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
```

- [ ] **Step 5: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | tail -25
```

期望：全部 PASS

- [ ] **Step 6: 提交**

```bash
"$GIT" add src/sessions/types.ts src/sessions/state-detector.ts src/__tests__/sessions/state-detector.test.ts
"$GIT" commit -m "feat: 会话类型定义与轻量状态检测器"
```

---

## Task 7: SessionManager

**Files:**
- Create: `src/sessions/manager.ts`
- Create: `src/__tests__/sessions/manager.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/sessions/manager.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager } from "../../sessions/manager.js";
import { TmuxBridge } from "../../tmux/bridge.js";
import { AdapterRegistry } from "../../adapters/registry.js";
import { ClaudeAdapter } from "../../adapters/claude/adapter.js";

vi.mock("../../tmux/bridge.js");
vi.mock("../../adapters/claude/adapter.js");

describe("SessionManager", () => {
  let manager: SessionManager;
  let bridge: TmuxBridge;
  let registry: AdapterRegistry;

  beforeEach(() => {
    bridge = new (vi.mocked(TmuxBridge))();
    const adapter = new (vi.mocked(ClaudeAdapter))();
    vi.mocked(adapter).id = "claude";
    vi.mocked(adapter).displayName = "Claude";
    vi.mocked(adapter.launch).mockResolvedValue("as-claude-0:0.0");
    vi.mocked(adapter.sendPrompt).mockResolvedValue(undefined);
    vi.mocked(adapter.shutdown).mockResolvedValue(undefined);
    vi.mocked(adapter.getPatterns).mockReturnValue({
      idle: [/❯\s*$/m], active: [], waitingInput: [], error: [],
    });
    vi.mocked(bridge.killSession).mockResolvedValue(undefined);
    vi.mocked(bridge.capturePane).mockResolvedValue({
      content: "❯", lines: ["❯"], timestamp: Date.now(),
    });
    registry = new AdapterRegistry();
    registry.register(adapter as any);
    manager = new SessionManager(bridge, registry);
  });

  it("createSession assigns sequential ids", async () => {
    const s0 = await manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    const s1 = await manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    expect(s0.id).toBe("claude-0");
    expect(s1.id).toBe("claude-1");
  });

  it("listSessions returns all sessions", async () => {
    await manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    expect(manager.listSessions()).toHaveLength(1);
  });

  it("getSession returns session by id", async () => {
    const s = await manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    expect(manager.getSession(s.id)).toBe(s);
  });

  it("getSession returns undefined for unknown id", () => {
    expect(manager.getSession("unknown")).toBeUndefined();
  });

  it("destroySession removes session and kills tmux", async () => {
    const s = await manager.createSession({ adapterId: "claude", workingDir: "/tmp" });
    await manager.destroySession(s.id);
    expect(manager.getSession(s.id)).toBeUndefined();
    expect(bridge.killSession).toHaveBeenCalledWith(s.tmuxSession);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "manager|FAIL" | head -5
```

期望：FAIL，`Cannot find module '../../sessions/manager.js'`

- [ ] **Step 3: 创建 `src/sessions/manager.ts`**

```typescript
import { EventEmitter } from "node:events";
import type { TmuxBridge } from "../tmux/bridge.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { AgentAdapterId } from "../adapters/base.js";
import { StateDetector } from "./state-detector.js";
import type { AgentSession, SessionConfig, SessionStatus, WaitResult } from "./types.js";

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

    const paneTarget = await adapter.launch(this.bridge, {
      sessionName: tmuxSession,
      workingDir: config.workingDir,
      bypassPermissions: config.bypassPermissions,
      resumeSessionId: config.resumeSessionId,
    });

    session.paneTarget = paneTarget;
    session.status = "idle";
    session.lastStatusChange = Date.now();

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
```

- [ ] **Step 4: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | tail -25
```

期望：全部 PASS

- [ ] **Step 5: 提交**

```bash
"$GIT" add src/sessions/manager.ts src/__tests__/sessions/manager.test.ts
"$GIT" commit -m "feat: SessionManager 会话生命周期管理"
```

---

## Task 8: 消息路由系统

**Files:**
- Create: `src/routing/types.ts`
- Create: `src/routing/router.ts`
- Create: `src/routing/forwarder.ts`
- Create: `src/__tests__/routing/router.test.ts`
- Create: `src/__tests__/routing/forwarder.test.ts`

- [ ] **Step 1: 创建 `src/routing/types.ts`**

```typescript
import type { SessionStatus } from "../sessions/types.js";

export interface MessageEnvelope {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  content: string;
  timestamp: number;
}

export interface RouteRule {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  filter?: RegExp;
  transform?: (content: string) => string;
  enabled: boolean;
}

export type RouterEventType =
  | "message_sent"
  | "route_added"
  | "route_removed"
  | "route_error";

export interface RouterEvent {
  type: RouterEventType;
  envelope?: MessageEnvelope;
  rule?: RouteRule;
  error?: Error;
  timestamp: number;
}
```

- [ ] **Step 2: 写失败测试 `src/__tests__/routing/router.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { MessageRouter } from "../../routing/router.js";

describe("MessageRouter", () => {
  it("addRule returns unique id and emits route_added", () => {
    const router = new MessageRouter();
    const events: string[] = [];
    router.onEvent((e) => events.push(e.type));
    const id = router.addRule({
      sourceSessionId: "claude-0",
      targetSessionId: "claude-1",
      enabled: true,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(events).toContain("route_added");
  });

  it("removeRule emits route_removed", () => {
    const router = new MessageRouter();
    const events: string[] = [];
    router.onEvent((e) => events.push(e.type));
    const id = router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    router.removeRule(id);
    expect(events).toContain("route_removed");
    expect(router.getAllRules()).toHaveLength(0);
  });

  it("getRulesForSource filters by sourceSessionId and enabled", () => {
    const router = new MessageRouter();
    router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    router.addRule({ sourceSessionId: "a", targetSessionId: "c", enabled: false });
    router.addRule({ sourceSessionId: "x", targetSessionId: "b", enabled: true });
    expect(router.getRulesForSource("a")).toHaveLength(1);
  });

  it("onEvent returns unsubscribe function", () => {
    const router = new MessageRouter();
    const events: string[] = [];
    const unsub = router.onEvent((e) => events.push(e.type));
    router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    unsub();
    router.addRule({ sourceSessionId: "a", targetSessionId: "b", enabled: true });
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "router|FAIL" | head -5
```

期望：FAIL，`Cannot find module '../../routing/router.js'`

- [ ] **Step 4: 创建 `src/routing/router.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { RouteRule, RouterEvent } from "./types.js";

type EventListener = (event: RouterEvent) => void;

export class MessageRouter {
  private rules = new Map<string, RouteRule>();
  private listeners: EventListener[] = [];

  addRule(rule: Omit<RouteRule, "id">): string {
    const id = randomUUID();
    const full: RouteRule = { ...rule, id };
    this.rules.set(id, full);
    this.emit({ type: "route_added", rule: full, timestamp: Date.now() });
    return id;
  }

  removeRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      this.rules.delete(ruleId);
      this.emit({ type: "route_removed", rule, timestamp: Date.now() });
    }
  }

  getRulesForSource(sourceSessionId: string): RouteRule[] {
    return [...this.rules.values()].filter(
      (r) => r.enabled && r.sourceSessionId === sourceSessionId,
    );
  }

  getAllRules(): RouteRule[] {
    return [...this.rules.values()];
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  emit(event: RouterEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore listener errors */ }
    }
  }
}
```

- [ ] **Step 5: 写失败测试 `src/__tests__/routing/forwarder.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionForwarder } from "../../routing/forwarder.js";
import { MessageRouter } from "../../routing/router.js";
import { SessionManager } from "../../sessions/manager.js";
import { TmuxBridge } from "../../tmux/bridge.js";
import { AdapterRegistry } from "../../adapters/registry.js";

vi.mock("../../sessions/manager.js");
vi.mock("../../tmux/bridge.js");
vi.mock("../../adapters/registry.js");

describe("SessionForwarder", () => {
  let router: MessageRouter;
  let manager: SessionManager;
  let forwarder: SessionForwarder;

  beforeEach(() => {
    router = new MessageRouter();
    manager = new (vi.mocked(SessionManager))(
      new (vi.mocked(TmuxBridge))(),
      new (vi.mocked(AdapterRegistry))(),
    );
    vi.mocked(manager.getSession).mockImplementation((id) =>
      id === "claude-1" ? { id: "claude-1" } as any : undefined
    );
    vi.mocked(manager.sendPrompt).mockResolvedValue(undefined);
    forwarder = new SessionForwarder(manager, router);
  });

  it("forwards output to target session per rule", async () => {
    router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-1", enabled: true });
    await forwarder.forward("claude-0", "hello from 0");
    expect(manager.sendPrompt).toHaveBeenCalledWith("claude-1", "hello from 0");
  });

  it("applies filter — skips if no match", async () => {
    router.addRule({
      sourceSessionId: "claude-0",
      targetSessionId: "claude-1",
      enabled: true,
      filter: /FORWARD:/,
    });
    await forwarder.forward("claude-0", "no prefix here");
    expect(manager.sendPrompt).not.toHaveBeenCalled();
  });

  it("applies transform before sending", async () => {
    router.addRule({
      sourceSessionId: "claude-0",
      targetSessionId: "claude-1",
      enabled: true,
      transform: (c) => `[from claude-0] ${c}`,
    });
    await forwarder.forward("claude-0", "hello");
    expect(manager.sendPrompt).toHaveBeenCalledWith("claude-1", "[from claude-0] hello");
  });

  it("skips unknown target session", async () => {
    router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-999", enabled: true });
    await forwarder.forward("claude-0", "hello");
    expect(manager.sendPrompt).not.toHaveBeenCalled();
  });

  it("prevents circular routing A→B→A", async () => {
    router.addRule({ sourceSessionId: "claude-0", targetSessionId: "claude-1", enabled: true });
    router.addRule({ sourceSessionId: "claude-1", targetSessionId: "claude-0", enabled: true });
    vi.mocked(manager.getSession).mockImplementation((id) => ({ id } as any));
    const sendCount = { count: 0 };
    vi.mocked(manager.sendPrompt).mockImplementation(async (id, content) => {
      sendCount.count++;
      if (sendCount.count > 3) throw new Error("infinite loop detected");
      await forwarder.forward(id, content);
    });
    await expect(forwarder.forward("claude-0", "ping", new Set(["claude-0"]))).resolves.not.toThrow();
  });
});
```

- [ ] **Step 6: 创建 `src/routing/forwarder.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "./router.js";

export class SessionForwarder {
  constructor(
    private manager: SessionManager,
    private router: MessageRouter,
  ) {}

  async forward(sourceSessionId: string, output: string, chain = new Set<string>()): Promise<void> {
    const rules = this.router.getRulesForSource(sourceSessionId);
    for (const rule of rules) {
      const target = this.manager.getSession(rule.targetSessionId);
      if (!target) continue;

      if (chain.has(rule.targetSessionId)) {
        process.stderr.write(
          `[agent-sessions] WARNING: circular route detected, skipping ${sourceSessionId} → ${rule.targetSessionId}\n`,
        );
        continue;
      }

      let content = output;
      if (rule.filter) {
        const match = content.match(rule.filter);
        if (!match) continue;
        content = match[0];
      }
      if (rule.transform) content = rule.transform(content);

      try {
        await this.manager.sendPrompt(rule.targetSessionId, content);
        this.router.emit({
          type: "message_sent",
          envelope: {
            id: randomUUID(),
            fromSessionId: sourceSessionId,
            toSessionId: rule.targetSessionId,
            content,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        });
        const nextChain = new Set([...chain, sourceSessionId]);
        await this.forward(rule.targetSessionId, content, nextChain);
      } catch (err) {
        this.router.emit({
          type: "route_error",
          rule,
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    }
  }
}
```

- [ ] **Step 7: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | tail -30
```

期望：全部 PASS

- [ ] **Step 8: 提交**

```bash
"$GIT" add src/routing/ src/__tests__/routing/
"$GIT" commit -m "feat: 消息路由引擎（循环防护）"
```

---

## Task 9: REPL 渲染与命令解析

**Files:**
- Create: `src/repl/renderer.ts`
- Create: `src/repl/commands.ts`
- Create: `src/__tests__/repl/commands.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/repl/commands.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { parseCommand } from "../../repl/commands.js";

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
  });

  it("parses /new with no args", () => {
    const cmd = parseCommand("/new");
    expect(cmd).toEqual({ name: "new", args: [], raw: "/new" });
  });

  it("parses /send with session and prompt", () => {
    const cmd = parseCommand("/send claude-0 hello world");
    expect(cmd?.name).toBe("send");
    expect(cmd?.args).toEqual(["claude-0", "hello", "world"]);
  });

  it("parses /route add with from and to", () => {
    const cmd = parseCommand("/route add claude-0 claude-1");
    expect(cmd?.name).toBe("route");
    expect(cmd?.args).toEqual(["add", "claude-0", "claude-1"]);
  });

  it("trims input before parsing", () => {
    const cmd = parseCommand("  /list  ");
    expect(cmd?.name).toBe("list");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```powershell
npm test -- --reporter=verbose 2>&1 | Select-String "commands|FAIL" | head -5
```

期望：FAIL，`Cannot find module '../../repl/commands.js'`

- [ ] **Step 3: 创建 `src/repl/commands.ts`**

```typescript
export type CommandName =
  | "help" | "list" | "new" | "kill" | "select"
  | "send" | "read" | "status" | "wait"
  | "route" | "routes" | "unroute" | "attach" | "exit";

export interface ParsedCommand {
  name: CommandName;
  args: string[];
  raw: string;
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).trim().split(/\s+/);
  return { name: parts[0] as CommandName, args: parts.slice(1), raw: trimmed };
}

export const HELP_TEXT = `
Commands:
  /new [workdir]              新建 Claude 会话
  /list                       列出所有会话
  /select <id>                切换当前会话
  /send <id> <prompt>         向指定会话发送消息
  /wait <id>                  等待会话完成
  /read [id]                  读取会话输出
  /status [id]                查看会话状态
  /route add <from> <to>      添加路由规则
  /routes                     列出路由规则
  /unroute <rule-id>          删除路由规则
  /attach <id>                Attach 到 tmux 窗口
  /kill <id>                  销毁会话
  /exit                       退出程序

直接输入（不以 / 开头）→ 发送到当前选中会话
`.trim();
```

- [ ] **Step 4: 创建 `src/repl/renderer.ts`**

```typescript
import chalk from "chalk";
import type { AgentSession, SessionStatus } from "../sessions/types.js";

const STATUS_COLORS: Record<SessionStatus, (s: string) => string> = {
  launching: chalk.yellow,
  idle:       chalk.green,
  active:     chalk.cyan,
  waiting_input: chalk.magenta,
  error:      chalk.red,
  dead:       chalk.gray,
};

export function colorStatus(status: SessionStatus): string {
  return (STATUS_COLORS[status] ?? chalk.white)(status);
}

export function buildPrompt(session: AgentSession | undefined): string {
  if (!session) return chalk.dim("(no session)") + " > ";
  return `[${chalk.bold(session.id)} ${colorStatus(session.status)}] > `;
}

export function renderSessionTable(sessions: AgentSession[]): string {
  if (sessions.length === 0) return chalk.dim("  (no sessions)");
  const header = chalk.bold("  ID           ADAPTER   STATUS         WORKDIR");
  const rows = sessions.map((s) => {
    const id = s.id.padEnd(12);
    const adapter = s.adapterId.padEnd(9);
    const status = colorStatus(s.status).padEnd(23);
    const cwd = s.workingDir.length > 30 ? "..." + s.workingDir.slice(-27) : s.workingDir;
    return `  ${id} ${adapter} ${status} ${cwd}`;
  });
  return [header, ...rows].join("\n");
}

export function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}
```

- [ ] **Step 5: 运行测试验证通过**

```powershell
npm test -- --reporter=verbose 2>&1 | tail -30
```

期望：全部 PASS

- [ ] **Step 6: 提交**

```bash
"$GIT" add src/repl/renderer.ts src/repl/commands.ts src/__tests__/repl/commands.test.ts
"$GIT" commit -m "feat: REPL 渲染工具与命令解析"
```

---

## Task 10: REPL 会话选择器与主循环

**Files:**
- Create: `src/repl/session-picker.ts`
- Create: `src/repl/repl.ts`

（这两个文件封装 stdin raw mode，单元测试需要大量 mock I/O，留给集成测试覆盖）

- [ ] **Step 1: 创建 `src/repl/session-picker.ts`**

```typescript
import * as readline from "node:readline";
import { renderSessionTable } from "./renderer.js";
import type { AgentSession } from "../sessions/types.js";

export async function pickSession(sessions: AgentSession[]): Promise<AgentSession | null> {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) return sessions[0];

  return new Promise((resolve) => {
    let idx = 0;

    const render = () => {
      process.stdout.write("\x1b[2J\x1b[H");
      console.log("  选择会话 (↑↓ 导航, Enter 确认, Esc 取消):\n");
      sessions.forEach((s, i) => {
        const prefix = i === idx ? "▶ " : "  ";
        const id = s.id.padEnd(12);
        const status = s.status.padEnd(14);
        console.log(`${prefix}${id} ${status} ${s.workingDir}`);
      });
    };

    render();

    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (buf: Buffer) => {
      const key = buf.toString();
      if (key === "\x1b[A" && idx > 0) { idx--; render(); return; }
      if (key === "\x1b[B" && idx < sessions.length - 1) { idx++; render(); return; }
      if (key === "\r" || key === "\n") { cleanup(); resolve(sessions[idx]); return; }
      if (key === "\x1b") { cleanup(); resolve(null); return; }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      if (!wasRaw) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[2J\x1b[H");
    };

    process.stdin.on("data", onData);
  });
}
```

- [ ] **Step 2: 创建 `src/repl/repl.ts`**

```typescript
import * as readline from "node:readline";
import chalk from "chalk";
import { buildPrompt, clearLine, renderSessionTable } from "./renderer.js";
import { parseCommand, HELP_TEXT } from "./commands.js";
import { pickSession } from "./session-picker.js";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "../routing/router.js";
import type { SessionForwarder } from "../routing/forwarder.js";
import type { AgentAdapterId } from "../adapters/base.js";

const STATUS_POLL_MS = 2_000;

export class InteractiveREPL {
  private rl: readline.Interface;
  private currentSessionId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private prevStatuses = new Map<string, string>();

  constructor(
    private manager: SessionManager,
    private router: MessageRouter,
    private forwarder: SessionForwarder,
  ) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: buildPrompt(undefined),
      terminal: true,
    });
  }

  start(): void {
    console.log(chalk.bold("\nagent-sessions") + chalk.dim(" — 多窗口 Claude 会话管理器"));
    console.log(chalk.dim('输入 /help 查看命令，/new 新建会话\n'));

    this.setupRouterListener();
    this.startStatusPoll();
    this.refreshPrompt();

    this.rl.on("line", async (line) => {
      await this.handleLine(line.trim());
      this.refreshPrompt();
    });

    this.rl.on("close", () => { this.stop(); process.exit(0); });
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.rl.close();
  }

  private refreshPrompt(): void {
    const session = this.currentSessionId
      ? this.manager.getSession(this.currentSessionId)
      : undefined;
    this.rl.setPrompt(buildPrompt(session));
    this.rl.prompt();
  }

  private async handleLine(input: string): Promise<void> {
    if (!input) return;
    if (input.startsWith("/")) {
      await this.handleCommand(input);
    } else if (this.currentSessionId) {
      await this.manager.sendPrompt(this.currentSessionId, input);
      console.log(chalk.dim(`  → sent to ${this.currentSessionId}`));
    } else {
      console.log(chalk.yellow("  没有选中的会话。使用 /new 新建或 /select <id> 选择。"));
    }
  }

  private async handleCommand(raw: string): Promise<void> {
    const cmd = parseCommand(raw);
    if (!cmd) { console.log(chalk.red("  无效命令")); return; }

    switch (cmd.name) {
      case "help":
        console.log("\n" + HELP_TEXT + "\n");
        break;

      case "list":
        console.log("\n" + renderSessionTable(this.manager.listSessions()) + "\n");
        break;

      case "new": {
        const workingDir = cmd.args[0] ?? process.cwd();
        console.log(chalk.dim(`  正在启动 Claude 会话（${workingDir}）...`));
        try {
          const s = await this.manager.createSession({ adapterId: "claude", workingDir });
          this.currentSessionId = s.id;
          console.log(chalk.green(`  ✓ 已启动 ${s.id}`));
        } catch (e: any) {
          console.log(chalk.red(`  ✗ 启动失败: ${e.message}`));
        }
        break;
      }

      case "select": {
        const id = cmd.args[0];
        if (!id) { console.log(chalk.yellow("  用法: /select <id>")); break; }
        if (!this.manager.getSession(id)) {
          console.log(chalk.red(`  找不到会话: ${id}`)); break;
        }
        this.currentSessionId = id;
        console.log(chalk.green(`  ✓ 已切换到 ${id}`));
        break;
      }

      case "send": {
        const [id, ...rest] = cmd.args;
        if (!id || rest.length === 0) { console.log(chalk.yellow("  用法: /send <id> <prompt>")); break; }
        await this.manager.sendPrompt(id, rest.join(" "));
        console.log(chalk.dim(`  → sent to ${id}`));
        break;
      }

      case "wait": {
        const id = cmd.args[0] ?? this.currentSessionId;
        if (!id) { console.log(chalk.yellow("  用法: /wait <id>")); break; }
        console.log(chalk.dim(`  等待 ${id} 完成...`));
        const output = await this.manager.sendAndWait(id, "");
        console.log(chalk.dim(`  ✓ ${id} 完成`));
        break;
      }

      case "read": {
        const id = cmd.args[0] ?? this.currentSessionId;
        if (!id) { console.log(chalk.yellow("  用法: /read [id]")); break; }
        const out = await this.manager.readOutput(id);
        console.log("\n" + out + "\n");
        break;
      }

      case "status": {
        const sessions = cmd.args[0]
          ? [this.manager.getSession(cmd.args[0])].filter(Boolean)
          : this.manager.listSessions();
        console.log("\n" + renderSessionTable(sessions as any) + "\n");
        break;
      }

      case "route": {
        if (cmd.args[0] === "add") {
          const [, from, to] = cmd.args;
          if (!from || !to) { console.log(chalk.yellow("  用法: /route add <from> <to>")); break; }
          const id = this.router.addRule({ sourceSessionId: from, targetSessionId: to, enabled: true });
          console.log(chalk.green(`  ✓ 路由已添加 (${id.slice(0, 8)})`));
        } else {
          console.log(chalk.yellow("  用法: /route add <from> <to>"));
        }
        break;
      }

      case "routes": {
        const rules = this.router.getAllRules();
        if (rules.length === 0) { console.log(chalk.dim("  (无路由规则)")); break; }
        rules.forEach((r) => {
          const status = r.enabled ? chalk.green("on") : chalk.gray("off");
          console.log(`  ${r.id.slice(0, 8)}  ${r.sourceSessionId} → ${r.targetSessionId}  [${status}]`);
        });
        break;
      }

      case "unroute": {
        const id = cmd.args[0];
        if (!id) { console.log(chalk.yellow("  用法: /unroute <rule-id>")); break; }
        const rule = this.router.getAllRules().find((r) => r.id.startsWith(id));
        if (!rule) { console.log(chalk.red(`  找不到规则: ${id}`)); break; }
        this.router.removeRule(rule.id);
        console.log(chalk.green(`  ✓ 路由已删除`));
        break;
      }

      case "attach": {
        const id = cmd.args[0] ?? this.currentSessionId;
        if (!id) { console.log(chalk.yellow("  用法: /attach <id>")); break; }
        const session = this.manager.getSession(id);
        if (!session) { console.log(chalk.red(`  找不到会话: ${id}`)); break; }
        console.log(chalk.dim(`  运行: tmux attach -t ${session.tmuxSession}`));
        console.log(chalk.dim("  (在另一个终端中执行上述命令)"));
        break;
      }

      case "kill": {
        const id = cmd.args[0];
        if (!id) { console.log(chalk.yellow("  用法: /kill <id>")); break; }
        await this.manager.destroySession(id);
        if (this.currentSessionId === id) this.currentSessionId = null;
        console.log(chalk.green(`  ✓ 已销毁 ${id}`));
        break;
      }

      case "exit":
        console.log(chalk.dim("  再见"));
        this.stop();
        process.exit(0);

      default:
        console.log(chalk.red(`  未知命令: /${cmd.name}，输入 /help 查看帮助`));
    }
  }

  private setupRouterListener(): void {
    this.router.onEvent((event) => {
      if (event.type === "message_sent" && event.envelope) {
        const { fromSessionId, toSessionId, content } = event.envelope;
        const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
        clearLine();
        console.log(chalk.cyan(`[ROUTE] ${fromSessionId} → ${toSessionId}: ${preview}`));
        this.rl.prompt(true);
      }
    });
  }

  private startStatusPoll(): void {
    this.pollTimer = setInterval(() => {
      for (const s of this.manager.listSessions()) {
        const prev = this.prevStatuses.get(s.id);
        if (prev && prev !== s.status) {
          clearLine();
          console.log(chalk.dim(`[${s.id}] ${prev} → ${s.status}`));
          this.rl.prompt(true);
        }
        this.prevStatuses.set(s.id, s.status);
      }
    }, STATUS_POLL_MS);
    this.pollTimer.unref();
  }
}
```

- [ ] **Step 3: 提交**

```bash
"$GIT" add src/repl/session-picker.ts src/repl/repl.ts
"$GIT" commit -m "feat: 交互式 REPL 主循环与会话选择器"
```

---

## Task 11: 入口文件

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: 创建 `src/index.ts`**

```typescript
#!/usr/bin/env node
import { TmuxBridge } from "./tmux/bridge.js";
import { AdapterRegistry } from "./adapters/registry.js";
import { ClaudeAdapter } from "./adapters/claude/adapter.js";
import { SessionManager } from "./sessions/manager.js";
import { MessageRouter } from "./routing/router.js";
import { SessionForwarder } from "./routing/forwarder.js";
import { InteractiveREPL } from "./repl/repl.js";

const bridge = new TmuxBridge();
const registry = new AdapterRegistry();
registry.register(new ClaudeAdapter());

const manager = new SessionManager(bridge, registry);
const router = new MessageRouter();
const forwarder = new SessionForwarder(manager, router);

manager.on("settled", (sessionId, result) => {
  forwarder.forward(sessionId, result.content);
});

const repl = new InteractiveREPL(manager, router, forwarder);
repl.start();
```

- [ ] **Step 2: 构建项目**

```powershell
cd D:\code\ai\agent-sessions
npm run build 2>&1
```

期望：`dist/` 目录生成，无 TypeScript 错误

- [ ] **Step 3: 确认可执行**

```powershell
node dist/index.js --help 2>&1
```

期望：启动提示或 REPL 初始化信息

- [ ] **Step 4: 运行全量测试**

```powershell
npm test -- --reporter=verbose 2>&1 | tail -40
```

期望：所有测试 PASS，0 failures

- [ ] **Step 5: 提交**

```bash
"$GIT" add src/index.ts dist/ 2>/dev/null || true
"$GIT" add src/index.ts
"$GIT" commit -m "feat: 入口文件，完成 Phase 1 实现"
```

---

## Task 12: 推送与烟雾验证

- [ ] **Step 1: 推送到 GitHub**

```bash
GIT="$(command -v git)"
TOKEN=$(gh auth token)
"$GIT" push "https://$(gh api user --jq .login):${TOKEN}@github.com/$(gh api user --jq .login)/agent-sessions.git" main
```

- [ ] **Step 2: 烟雾测试（需要 WSL + tmux + claude CLI 可用）**

在 WSL 终端中：
```bash
node dist/index.js
# 然后执行:
# /new "$PROJECT_DIR"
# /list         → 应显示 claude-0 launching → idle
# hello         → 发送到 claude-0，状态变 active → idle
# /read         → 显示 claude-0 输出
# /new          → 新建 claude-1
# /route add claude-0 claude-1
# /routes       → 显示路由规则
# /exit
```

期望：每个命令按预期工作，状态轮询每 2s 更新一次。

---

## 自检完成

- **Spec 覆盖**：plan.md 中 10 个实现顺序条目全部对应到 Task 1–11 ✓
- **占位符扫描**：无 TBD / TODO / "similar to" ✓
- **类型一致性**：
  - `AgentAdapterId` 在 `base.ts` 定义，`registry.ts`、`session/types.ts`、`manager.ts` 均导入使用 ✓
  - `TmuxBridge` 在 `bridge.ts` 定义，所有 adapter 通过参数注入 ✓
  - `AgentSession.paneTarget` 在 `manager.ts` 创建时赋值，`state-detector.ts` 通过参数接收 ✓
  - `SessionForwarder.forward(sessionId, output, chain)` 签名在 `forwarder.ts` 定义，`index.ts` 调用时只传两个参数（第三个有默认值）✓
