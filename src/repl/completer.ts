export interface CommandDef {
  name: string;
  description: string;
  usage: string;
}

export const COMMAND_DEFS: CommandDef[] = [
  { name: "new",     description: "新建 Claude 会话",              usage: "/new [workdir]" },
  { name: "list",    description: "选择会话并进入全屏交互",         usage: "/list" },
  { name: "enter",   description: "进入全屏会话交互视图",           usage: "/enter [id]" },
  { name: "select",  description: "切换当前操作的会话（仅切换）",   usage: "/select <id>" },
  { name: "send",    description: "向指定会话发送消息",             usage: "/send <id> <prompt>" },
  { name: "wait",    description: "等待会话完成（变为空闲）",       usage: "/wait <id>" },
  { name: "read",    description: "读取会话最新输出",               usage: "/read [id]" },
  { name: "status",  description: "查看会话状态",                   usage: "/status [id]" },
  { name: "route",   description: "添加路由规则",                   usage: "/route add <from> <to>" },
  { name: "routes",  description: "列出路由规则",                   usage: "/routes" },
  { name: "unroute", description: "删除路由规则",                   usage: "/unroute <rule-id>" },
  { name: "attach",  description: "显示 mintty attach 命令",        usage: "/attach <id>" },
  { name: "kill",    description: "销毁会话",                       usage: "/kill <id>" },
  { name: "help",    description: "显示帮助信息",                   usage: "/help" },
  { name: "exit",    description: "退出程序",                       usage: "/exit" },
];

const MAX_SUGGESTIONS = 6;

/**
 * 按 partial 过滤命令：前缀匹配优先，其次子串匹配，最多返回 MAX_SUGGESTIONS 条。
 */
export function getMatches(partial: string): CommandDef[] {
  const lower = partial.toLowerCase();
  if (!lower) return COMMAND_DEFS.slice(0, MAX_SUGGESTIONS);

  const prefix: CommandDef[] = [];
  const substr: CommandDef[] = [];

  for (const def of COMMAND_DEFS) {
    if (def.name.startsWith(lower)) prefix.push(def);
    else if (def.name.includes(lower)) substr.push(def);
  }

  return [...prefix, ...substr].slice(0, MAX_SUGGESTIONS);
}

/**
 * readline-compatible completer 函数。
 * 输入以 "/" 开头时补全命令名，否则返回空。
 */
export function completeLine(line: string): [string[], string] {
  if (!line.startsWith("/")) return [[], line];

  // 命令名后有空格（进入参数部分）→ 不补全
  const parts = line.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length > 1 || /\s/.test(line.slice(1))) return [[], line];

  const partial = (parts[0] ?? "").toLowerCase();
  const matches = getMatches(partial);
  const completions = matches.map(d => `/${d.name}`);
  return [completions, line];
}
