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
 * 在 prompt 行上方插入建议列表。
 * 使用 \x1b[nL（插入 n 行）将 prompt 向下推，然后填充建议内容，光标最终回到 prompt 行。
 * 返回插入的行数，用于 clearSuggestionLines 清除。
 */
export function renderSuggestions(
  items: SuggestionItem[],
  selectedIdx: number,
): number {
  if (items.length === 0) return 0;
  const n = items.length + 1; // 1 空行 + items.length 行
  // 移到行首，插入 n 行（将 prompt 行向下推）
  process.stdout.write(`\r\x1b[${n}L`);
  // 光标现在在插入区域顶部，打印建议
  process.stdout.write("\n"); // 空行缓冲
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
  // 不需要额外移动光标，readline 会把 prompt 重绘在当前位置
  return n;
}

/**
 * 清除 prompt 上方的 n 行建议（向上移除插入的行）。
 */
export function clearSuggestionLines(n: number): void {
  // 移到行首，向上 n 行，删除 n 行
  process.stdout.write(`\r\x1b[${n}A\x1b[${n}M`);
}
