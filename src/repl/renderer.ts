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

export interface SuggestionItem {
  name: string;
  description: string;
  usage: string;
}

/**
 * 在当前行下方打印建议列表，返回打印的行数（1 空行 + items.length 行）。
 * selectedIdx 对应行用青色高亮显示。
 */
export function renderSuggestions(
  items: SuggestionItem[],
  selectedIdx: number,
): number {
  if (items.length === 0) return 0;
  process.stdout.write("\n");
  for (let i = 0; i < items.length; i++) {
    const selected = i === selectedIdx;
    const prefix = selected ? chalk.cyan("❯ ") : "  ";
    const name = selected
      ? chalk.bold.cyan(`/${items[i].name}`)
      : chalk.white(`/${items[i].name}`);
    const desc = chalk.dim(items[i].description);
    const hint = selected ? chalk.dim(`  ${items[i].usage}`) : "";
    process.stdout.write(`${prefix}${name.padEnd(selected ? 18 : 16)}${desc}${hint}\n`);
  }
  return 1 + items.length;
}

/**
 * 向上清除 n 行（擦除之前打印的建议叠加层）。
 */
export function clearSuggestionLines(n: number): void {
  for (let i = 0; i < n; i++) {
    process.stdout.write("\x1b[1A\x1b[2K"); // 上移一行 + 清除行内容
  }
}
