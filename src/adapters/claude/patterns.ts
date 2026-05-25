import type { AgentPatterns } from "../base.js";

export const CLAUDE_PATTERNS: AgentPatterns = {
  idle: [/❯\s*$/m],
  active: [
    /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,
    /\.\.\.\s*$/m,
    /Reading|Writing|Editing|Running|Thinking/i,
  ],
  waitingInput: [
    /\(y\/n\)/i,
    /\bAllow\b.*\?/i,
    /❯\s*\d+[.)]\s/,
    /Do you want to/i,
  ],
  error: [
    /^\s*Error:/m,
    /ENOENT|EACCES|EPERM/,
    /Connection refused/i,
    /command not found/i,
    /API Error/i,
  ],
};
