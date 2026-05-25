import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TmuxSession, TmuxPane, CaptureResult, CaptureOptions, SendKeysOptions } from "./types.js";
import { TmuxError } from "./types.js";

const execFileAsync = promisify(execFile);
const SEP = "|||";

export class TmuxBridge {
  private async exec(args: string[]): Promise<string> {
    // tmux 通过 PATH 解析（MSYS2 已将 tmux.exe 加入 PATH）
    try {
      const result = await execFileAsync("tmux", args, {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const stdout = typeof result === "string" ? result : (result as any).stdout ?? "";
      return stdout;
    } catch (err: any) {
      throw new TmuxError(
        `tmux ${args.join(" ")} failed: ${err.stderr || err.message}`,
        args.join(" "),
        err.code ?? null,
        err.stderr ?? "",
      );
    }
  }

  static target(session: string, window?: string | number, pane?: string | number): string {
    let t = session;
    if (window !== undefined) t += `:${window}`;
    if (pane !== undefined) t += `.${pane}`;
    return t;
  }

  async createSession(name: string, opts?: { cwd?: string; env?: Record<string, string>; command?: string | string[] }): Promise<void> {
    const args = ["new-session", "-d", "-s", name];
    if (opts?.cwd) args.push("-c", opts.cwd);
    if (opts?.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    // 支持字符串（单词）或数组（多词命令，如 ["bash", "-c", "..."]）
    if (opts?.command) {
      if (Array.isArray(opts.command)) {
        args.push(...opts.command);
      } else {
        args.push(opts.command);
      }
    }
    await this.exec(args);
  }

  async hasSession(name: string): Promise<boolean> {
    try {
      await this.exec(["has-session", "-t", name]);
      return true;
    } catch {
      return false;
    }
  }

  async killSession(name: string): Promise<void> {
    await this.exec(["kill-session", "-t", name]);
  }

  async listSessions(): Promise<TmuxSession[]> {
    const fmt = `#{session_name}${SEP}#{session_windows}${SEP}#{session_created}${SEP}#{session_attached}`;
    const out = await this.exec(["list-sessions", "-F", fmt]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, windows, created, attached] = line.split(SEP);
        return {
          name,
          windows: parseInt(windows, 10),
          created: parseInt(created, 10),
          attached: attached.trim() === "1",
        };
      });
  }

  async sendKeys(target: string, keys: string, opts?: SendKeysOptions): Promise<void> {
    const args = ["send-keys", "-t", target];
    if (opts?.literal) args.push("-l");
    args.push(keys);
    await this.exec(args);
  }

  async sendText(target: string, text: string): Promise<void> {
    if (text.length <= 200) {
      await this.sendKeys(target, text, { literal: true });
      return;
    }
    // 写入临时文件（Windows: 转换为 MSYS2 路径格式）
    const tmpPath = join(tmpdir(), `as-${randomUUID()}.txt`);
    await writeFile(tmpPath, text, "utf8");
    // 将 Windows 路径转为 MSYS2 路径（如 C:\Temp\file → /c/Temp/file）
    const msysPath = tmpPath.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, "/");
    const bufPath = process.platform === "win32" ? msysPath : tmpPath;
    try {
      await this.exec(["load-buffer", bufPath]);
      await this.exec(["paste-buffer", "-t", target, "-d"]);
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  async sendEnter(target: string): Promise<void> {
    await this.sendKeys(target, "Enter");
  }

  async sendCtrlC(target: string): Promise<void> {
    await this.sendKeys(target, "C-c");
  }

  async sendEscape(target: string): Promise<void> {
    await this.sendKeys(target, "Escape");
  }

  async capturePane(target: string, opts?: CaptureOptions): Promise<CaptureResult> {
    const args = ["capture-pane", "-t", target, "-p"];
    if (opts?.includeEscapeSequences) args.push("-e");
    if (opts?.startLine !== undefined) args.push("-S", String(opts.startLine));
    if (opts?.endLine !== undefined) args.push("-E", String(opts.endLine));
    const raw = await this.exec(args);
    const content = raw.replace(/\n+$/, "");
    return { content, lines: content.split("\n"), timestamp: Date.now() };
  }

  async runInPane(target: string, command: string): Promise<void> {
    await this.sendText(target, command);
    await this.sendEnter(target);
  }

  async listPanes(target: string): Promise<TmuxPane[]> {
    const fmt = [
      "#{pane_id}", "#{pane_index}", "#{pane_width}", "#{pane_height}",
      "#{pane_active}", "#{pane_pid}", "#{pane_current_command}",
    ].join(SEP);
    const out = await this.exec(["list-panes", "-t", target, "-F", fmt]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [id, index, width, height, active, pid, currentCommand] = line.split(SEP);
        return {
          id,
          index: parseInt(index, 10),
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          active: active.trim() === "1",
          pid: parseInt(pid, 10),
          currentCommand: currentCommand.trim(),
        };
      });
  }
}
