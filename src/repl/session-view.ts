import chalk from "chalk";
import { spawnSync } from "node:child_process";
import type { Interface as ReadlineInterface } from "node:readline";
import type { SessionManager } from "../sessions/manager.js";

export class SessionView {
  constructor(private manager: SessionManager) {}

  /**
   * 直接 attach 到 tmux 会话，用户与 Claude CLI 原生交互。
   * Ctrl+B D detach → 返回会话列表。
   */
  enter(sessionId: string, rl?: ReadlineInterface): "back" | "exit" {
    const session = this.manager.getSession(sessionId);
    if (!session) return "back";

    // 在 tmux 状态栏固定显示返回提示，进入后随时可见
    spawnSync("tmux", [
      "set-option", "-t", session.tmuxSession,
      "status-right",
      "  #[fg=cyan]Ctrl+B D#[fg=default] 返回列表  ",
    ]);
    spawnSync("tmux", ["set-option", "-t", session.tmuxSession, "status", "on"]);

    // 暂停 readline，让 tmux attach 完全接管终端
    rl?.pause();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);

    // 阻塞等待：tmux attach 接管整个终端，用户直接与 Claude 交互
    const result = spawnSync("tmux", ["attach-session", "-t", session.tmuxSession], {
      stdio: "inherit",
    });

    // 恢复终端
    process.stdout.write("\x1b[2J\x1b[H");
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    rl?.resume();

    // tmux 异常退出（如 session 不存在）返回 exit，正常 detach 返回 back
    return result.status === 0 ? "back" : "exit";
  }
}
