import chalk from "chalk";
import type { SessionManager } from "../sessions/manager.js";
import { colorStatus } from "./renderer.js";

const MAX_OUTPUT_LINES = 500;

export class SessionView {
  private sessionId: string | null = null;
  private outputLines: string[] = [];
  private inputBuf = "";
  private active = false;
  private maxOutputLines = MAX_OUTPUT_LINES;
  private dataHandler: ((buf: Buffer) => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private manager: SessionManager) {}

  async enter(sessionId: string): Promise<void> {
    const session = this.manager.getSession(sessionId);
    if (!session) return;

    this.sessionId = sessionId;
    this.active = true;
    this.inputBuf = "";
    this.outputLines = [];

    try {
      const existing = await this.manager.readOutput(sessionId, 100);
      if (existing) this.outputLines = existing.split("\n");
    } catch { /* best effort */ }

    this.enterRawMode();
    this.setupLayout();
    this.renderAll();

    this.pollTimer = setInterval(async () => {
      if (!this.active) return;
      try {
        const s = this.manager.getSession(sessionId);
        if (s) this.renderStatusBar(s.status);
      } catch { /* best effort */ }
    }, 1500);
    this.pollTimer.unref();

    await new Promise<void>((resolve) => {
      this.dataHandler = (buf: Buffer) => {
        const key = buf.toString();
        if (key === "\x1b" || key === "\x03") {
          this.exitView();
          resolve();
          return;
        }
        if (key === "\r" || key === "\n") {
          const msg = this.inputBuf.trim();
          this.inputBuf = "";
          this.renderInputLine();
          if (msg) this.handleSend(msg).catch(() => {});
          return;
        }
        if (key === "\x7f" || key === "\b") {
          this.inputBuf = this.inputBuf.slice(0, -1);
          this.renderInputLine();
          return;
        }
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          this.inputBuf += key;
          this.renderInputLine();
        }
      };
      process.stdin.on("data", this.dataHandler);
    });
  }

  private async handleSend(msg: string): Promise<void> {
    const sessionId = this.sessionId!;
    this.appendOutputLine(chalk.cyan("> ") + msg);
    this.renderOutputArea();
    this.renderInputLine();
    const s = this.manager.getSession(sessionId);
    if (s) this.renderStatusBar("active");

    try {
      const response = await this.manager.sendAndWait(sessionId, msg, 120_000);
      if (response) {
        for (const line of response.split("\n")) {
          this.appendOutputLine(line);
        }
      }
      const s2 = this.manager.getSession(sessionId);
      if (s2) this.renderStatusBar(s2.status);
    } catch (e: any) {
      this.appendOutputLine(chalk.red("  Error: " + e.message));
    }
    this.renderOutputArea();
    this.renderInputLine();
  }

  private appendOutputLine(line: string): void {
    this.outputLines.push(line);
    if (this.outputLines.length > this.maxOutputLines) {
      this.outputLines = this.outputLines.slice(-this.maxOutputLines);
    }
  }

  private exitView(): void {
    this.active = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.dataHandler) {
      process.stdin.removeListener("data", this.dataHandler);
      this.dataHandler = null;
    }
    this.teardownLayout();
    this.exitRawMode();
  }

  private get rows(): number { return process.stdout.rows ?? 24; }
  private get cols(): number { return process.stdout.columns ?? 80; }

  private setupLayout(): void {
    process.stdout.write("\x1b[2J");
    process.stdout.write(`\x1b[2;${this.rows - 1}r`);
    process.stdout.write("\x1b[?25l");
  }

  private teardownLayout(): void {
    process.stdout.write("\x1b[r");
    process.stdout.write("\x1b[?25h");
    process.stdout.write("\x1b[2J\x1b[H");
  }

  private renderAll(): void {
    const s = this.manager.getSession(this.sessionId!);
    this.renderStatusBar(s?.status ?? "unknown");
    this.renderOutputArea();
    this.renderInputLine();
  }

  private renderStatusBar(status: string): void {
    const s = this.manager.getSession(this.sessionId!);
    const bar = this.formatStatusBar(this.sessionId ?? "", status, s?.workingDir ?? "");
    process.stdout.write(`\x1b[1;1H\x1b[2K${bar}`);
  }

  private renderOutputArea(): void {
    const displayRows = this.rows - 2;
    const lines = this.outputLines.slice(-displayRows);
    process.stdout.write(`\x1b[2;1H`);
    for (let i = 0; i < displayRows; i++) {
      process.stdout.write(`\x1b[2K`);
      if (i < lines.length) {
        process.stdout.write(lines[i].slice(0, this.cols));
      }
      if (i < displayRows - 1) process.stdout.write("\n");
    }
  }

  private renderInputLine(): void {
    const s = this.manager.getSession(this.sessionId!);
    const line = this.formatInputLine(this.inputBuf, s?.status ?? "unknown");
    process.stdout.write(`\x1b[${this.rows};1H\x1b[2K${line}`);
  }

  formatStatusBar(sessionId: string, status: string, workingDir = ""): string {
    const id = chalk.bold.cyan(sessionId.padEnd(14));
    const st = colorStatus(status as any).padEnd(24);
    const dir = chalk.dim((workingDir.length > 20 ? "..." + workingDir.slice(-17) : workingDir).padEnd(22));
    const hint = chalk.dim("Esc 退出列表");
    return `  ${id}${st}${dir}  ${hint}`;
  }

  formatInputLine(input: string, status: string): string {
    const prompt = chalk.cyan("> ");
    const statusBadge = chalk.dim(`[${status}]`);
    const available = Math.max(10, this.cols - 4 - status.length - 3);
    const displayInput = input.length > available ? "…" + input.slice(-(available - 1)) : input;
    return `${prompt}${displayInput}`.padEnd(this.cols - statusBadge.length - 2) + "  " + statusBadge;
  }

  private wasRaw = false;
  private enterRawMode(): void {
    if (process.stdin.isTTY) {
      this.wasRaw = process.stdin.isRaw ?? false;
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }
  }
  private exitRawMode(): void {
    if (process.stdin.isTTY && !this.wasRaw) {
      process.stdin.setRawMode(false);
    }
  }
}
