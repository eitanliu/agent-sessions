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
  /attach <id>                Attach 到 tmux（mintty）窗口
  /kill <id>                  销毁会话
  /exit                       退出程序

直接输入（不以 / 开头）→ 发送到当前选中会话
`.trim();
