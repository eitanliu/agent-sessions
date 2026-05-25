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

    const wasRaw = process.stdin.isRaw ?? false;
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
