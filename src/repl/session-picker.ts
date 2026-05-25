import chalk from "chalk";
import type { AgentSession } from "../sessions/types.js";
import { colorStatus } from "./renderer.js";

const STATUS_ICON: Record<string, string> = {
  idle:          "●",
  active:        "◎",
  launching:     "○",
  waiting_input: "?",
  error:         "✗",
  dead:          "·",
};

function renderList(sessions: AgentSession[], idx: number): void {
  // 清屏并将光标移到顶部
  process.stdout.write("\x1b[2J\x1b[H");

  // 标题栏（固定顶部）
  console.log(chalk.bold("  会话列表") + chalk.dim("  ↑↓ 导航  Enter 选择  Esc 取消"));
  console.log(chalk.dim("  " + "─".repeat(58)));

  // 会话列表
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const selected = i === idx;
    const icon = STATUS_ICON[s.status] ?? "·";
    const prefix = selected ? chalk.cyan("❯ ") : "  ";
    const idStr = selected ? chalk.bold.cyan(s.id.padEnd(14)) : chalk.white(s.id.padEnd(14));
    const statusStr = colorStatus(s.status).padEnd(24);
    const dirStr = chalk.dim(
      s.workingDir.length > 28 ? "..." + s.workingDir.slice(-25) : s.workingDir
    );
    console.log(`${prefix}${chalk.dim(icon)} ${idStr}${statusStr}${dirStr}`);
  }

  // 分隔线
  console.log(chalk.dim("  " + "─".repeat(58)));

  // 选中会话详情（固定底部区）
  const sel = sessions[idx];
  if (sel) {
    console.log(
      chalk.dim("  适配器: ") + chalk.white(sel.adapterId) +
      chalk.dim("   状态: ") + colorStatus(sel.status) +
      chalk.dim("   tmux: ") + chalk.white(sel.tmuxSession)
    );
    console.log(
      chalk.dim("  目录: ") + chalk.white(sel.workingDir)
    );
  }

  // 底部输入提示（固定底部）
  console.log(chalk.dim("  " + "─".repeat(58)));
  process.stdout.write(
    chalk.cyan("  ❯ ") +
    chalk.dim("输入会话编号直接跳转，或用方向键导航后按 Enter 选择... ")
  );
}

export async function pickSession(sessions: AgentSession[]): Promise<AgentSession | null> {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) {
    // 只有一个会话时直接确认
    return sessions[0];
  }

  return new Promise((resolve) => {
    let idx = 0;
    let inputBuf = "";

    renderList(sessions, idx);

    const wasRaw = process.stdin.isRaw ?? false;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (buf: Buffer) => {
      const key = buf.toString();

      // 方向键
      if (key === "\x1b[A") { idx = Math.max(0, idx - 1); inputBuf = ""; renderList(sessions, idx); return; }
      if (key === "\x1b[B") { idx = Math.min(sessions.length - 1, idx + 1); inputBuf = ""; renderList(sessions, idx); return; }

      // Enter 确认
      if (key === "\r" || key === "\n") { cleanup(); resolve(sessions[idx]); return; }

      // Esc 取消
      if (key === "\x1b") { cleanup(); resolve(null); return; }

      // Ctrl+C 取消
      if (key === "\x03") { cleanup(); resolve(null); return; }

      // 数字键快速跳转
      if (/^\d$/.test(key)) {
        inputBuf += key;
        const n = parseInt(inputBuf, 10) - 1;
        if (n >= 0 && n < sessions.length) {
          idx = n;
          renderList(sessions, idx);
        } else if (parseInt(inputBuf, 10) > sessions.length) {
          inputBuf = key; // 重置为当前键
          const n2 = parseInt(key, 10) - 1;
          if (n2 >= 0 && n2 < sessions.length) { idx = n2; renderList(sessions, idx); }
        }
        return;
      }

      // 其他键清除数字输入缓冲
      inputBuf = "";
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      if (!wasRaw) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[2J\x1b[H"); // 清屏，交还终端
    };

    process.stdin.on("data", onData);
  });
}
