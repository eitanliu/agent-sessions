import { existsSync } from "node:fs";
import type { TmuxBridge } from "../../tmux/bridge.js";
import type { AgentAdapter, AgentAdapterId, AgentPatterns, LaunchConfig } from "../base.js";
import { TmuxBridge as TmuxBridgeClass } from "../../tmux/bridge.js";
import { CLAUDE_PATTERNS } from "./patterns.js";

const INIT_WAIT_MS = 0; // 立即 attach，让用户从头看到 Claude 启动

export class ClaudeAdapter implements AgentAdapter {
  readonly id: AgentAdapterId = "claude";
  readonly displayName = "Claude";

  async launch(bridge: TmuxBridge, config: LaunchConfig): Promise<string> {
    const { sessionName, workingDir, bypassPermissions, resumeSessionId } = config;

    // 解析 claude 可执行文件路径
    const claudeCmd = resolveClaudeCommand();
    const claudeArgs: string[] = [];
    if (config.resumeSessionId) claudeArgs.push("--resume", config.resumeSessionId);
    if (config.bypassPermissions) claudeArgs.push("--dangerously-skip-permissions");

    if (!(await bridge.hasSession(sessionName))) {
      const posixCwd = toPosixPath(workingDir);
      const claudeParts = [claudeCmd, ...claudeArgs].join(" ");
      // 覆盖 $HOME：MSYS2 里 HOME=/home/eitanliu，Node.js 版 Claude Code CLI 读取后
      // 将其解析为 MSYS2 home 目录作为默认工作区。强制设为 Windows 用户目录即可修复。
      const posixUserProfile = toPosixPath(process.env.USERPROFILE ?? "");
      const bashScript = [
        `export HOME='${posixUserProfile}'`,
        `export TERM=xterm-256color`,
        `cd '${posixCwd}'`,
        `exec ${claudeParts}`,
      ].join(" && ");
      // 作为单个字符串传给 tmux，避免 tmux 把 bash 的 -c 误解为自己的 -c start-directory
      await bridge.createSession(sessionName, {
        command: `bash -c "${bashScript.replace(/"/g, '\\"')}"`,
      });
    }

    const paneTarget = TmuxBridgeClass.target(sessionName, 0, 0);
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
    await new Promise((r) => setTimeout(r, 500));
  }

  getPatterns(): AgentPatterns {
    return CLAUDE_PATTERNS;
  }
}

/**
 * 解析 claude 可执行文件路径：
 * - Windows：若 %USERPROFILE%\.local\bin\claude.exe 存在，返回绝对 POSIX 路径
 * - 否则返回 "claude"，依赖 PATH
 */
function resolveClaudeCommand(): string {
  if (process.platform !== "win32") return "claude";

  const userProfile = process.env.USERPROFILE ?? "";
  const winExe = `${userProfile}\\.local\\bin\\claude.exe`;

  if (existsSync(winExe)) {
    const posixHome = userProfile
      .replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)
      .replace(/\\/g, "/");
    return `${posixHome}/.local/bin/claude`;
  }

  return "claude";
}

/** 将路径转为 POSIX 格式（Windows: D:\foo 或 D:/foo → /d/foo） */
function toPosixPath(p: string): string {
  if (process.platform !== "win32") return p;
  return p
    .replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)
    .replace(/\\/g, "/");
}
