import chalk from "chalk";
import type { AgentSession, SessionStatus } from "../sessions/types.js";

const STATUS_COLORS: Record<SessionStatus, (s: string) => string> = {
  launching:     chalk.yellow,
  idle:          chalk.green,
  active:        chalk.cyan,
  waiting_input: chalk.magenta,
  error:         chalk.red,
  dead:          chalk.gray,
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
