export interface TmuxSession {
  name: string;
  windows: number;
  /** Unix 秒时间戳（tmux session_created 格式变量） */
  created: number;
  attached: boolean;
}

export interface TmuxPane {
  id: string;
  index: number;
  width: number;
  height: number;
  active: boolean;
  pid: number;
  currentCommand: string;
}

export interface CaptureResult {
  content: string;
  lines: string[];
  timestamp: number;
}

export interface CaptureOptions {
  startLine?: number;
  endLine?: number;
  /** true = 在输出中保留 ANSI 转义序列（tmux capture-pane -e） */
  includeEscapeSequences?: boolean;
}

export interface SendKeysOptions {
  literal?: boolean;
}

export class TmuxError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "TmuxError";
  }
}
