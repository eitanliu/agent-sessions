import { COMMAND_DEFS } from "./completer.js";
export { COMMAND_DEFS } from "./completer.js";

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

export const HELP_TEXT = (() => {
  const lines = COMMAND_DEFS.map(d => `  ${d.usage.padEnd(32)}${d.description}`);
  return [
    "Commands:",
    ...lines,
    "",
    "直接输入（不以 / 开头）→ 发送到当前选中会话",
    "快捷键：Ctrl+C 中止操作  Ctrl+L 清屏  Esc 关闭建议",
  ].join("\n");
})();
