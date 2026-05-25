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
  stripEscapeSequences?: boolean;  // true = 剥离 ANSI 转义序列
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
