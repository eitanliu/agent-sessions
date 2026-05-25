import * as readline from "node:readline";
import chalk from "chalk";
import { buildPrompt, clearLine, renderSessionTable } from "./renderer.js";
import { parseCommand, HELP_TEXT } from "./commands.js";
import { pickSession } from "./session-picker.js";
import { completeLine, getMatches } from "./completer.js";
import { SessionView } from "./session-view.js";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "../routing/router.js";
import type { SessionForwarder } from "../routing/forwarder.js";

const STATUS_POLL_MS = 2_000;

export class InteractiveREPL {
  private rl: readline.Interface;
  private currentSessionId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private prevStatuses = new Map<string, string>();
  private suggestionLines = 0;
  private suggestionIdx = 0;
  private suggestionItems: { name: string; description: string; usage: string }[] = [];
  private keypressHandler: ((str: string, key: any) => void) | null = null;
  private overlayActive = false;
  private sessionView!: SessionView;

  constructor(
    private manager: SessionManager,
    private router: MessageRouter,
    private forwarder: SessionForwarder,
  ) {
    this.sessionView = new SessionView(this.manager);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: buildPrompt(undefined),
      terminal: true,
      completer: completeLine,
    });
  }

  start(): void {
    process.stdout.write("\x1b[2J\x1b[H"); // 清屏
    console.log(
      chalk.bold("agent-sessions") +
      chalk.dim(" — 多窗口 Claude 会话管理器")
    );
    console.log(chalk.dim("─".repeat(48)));
    console.log(
      chalk.dim("  /") + chalk.white("new") + chalk.dim(" 新建会话   ") +
      chalk.dim("  /") + chalk.white("help") + chalk.dim(" 查看命令   ") +
      chalk.dim("  Tab") + chalk.dim(" 补全   ") +
      chalk.dim("  Ctrl+C") + chalk.dim(" 退出")
    );
    console.log(chalk.dim("─".repeat(48)) + "\n");

    this.setupKeypressOverlay();
    this.setupRouterListener();
    this.startStatusPoll();
    this.refreshPrompt();

    this.rl.on("line", async (line) => {
      await this.handleLine(line.trim());
      this.refreshPrompt();
    });

    // Ctrl+C: 有会话时清空输入行（不退出），无会话时退出
    this.rl.on("SIGINT", () => {
      this.clearOverlay();
      if (this.currentSessionId) {
        process.stdout.write("\n");
        console.log(chalk.yellow("  (Ctrl+C) 已清空输入。使用 /exit 退出程序。"));
        // 清空当前 readline 输入行
        ((this.rl as unknown) as { line: string; cursor: number }).line = "";
        ((this.rl as unknown) as { line: string; cursor: number }).cursor = 0;
        this.refreshPrompt();
      } else {
        console.log(chalk.dim("\n  再见"));
        this.stop();
        process.exit(0);
      }
    });

    this.rl.on("close", () => { this.stop(); process.exit(0); });
  }

  stop(): void {
    if (this.keypressHandler) {
      process.stdin.removeListener("keypress", this.keypressHandler);
      this.keypressHandler = null;
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.rl.close();
  }

  private refreshPrompt(): void {
    // 清除叠加层，恢复基础 prompt
    this.suggestionLines = 0;
    this.suggestionItems = [];
    this.suggestionIdx = 0;
    const session = this.currentSessionId
      ? this.manager.getSession(this.currentSessionId)
      : undefined;
    this.rl.setPrompt(buildPrompt(session));
    this.rl.prompt();
  }

  private async handleLine(input: string): Promise<void> {
    this.clearOverlay();
    if (!input) return;
    if (input.startsWith("/")) {
      await this.handleCommand(input);
    } else if (this.currentSessionId) {
      await this.manager.sendPrompt(this.currentSessionId, input).catch((e) =>
        console.log(chalk.red(`  发送失败: ${e.message}`))
      );
      console.log(chalk.dim(`  → sent to ${this.currentSessionId}`));
    } else {
      console.log(chalk.yellow("  没有选中的会话。使用 /new 新建或 /select <id> 选择。"));
    }
  }

  private async handleCommand(raw: string): Promise<void> {
    const cmd = parseCommand(raw);
    if (!cmd) { console.log(chalk.red("  无效命令")); return; }

    switch (cmd.name) {
      case "help":
        console.log("\n" + HELP_TEXT + "\n");
        break;

      case "list": {
        const sessions = this.manager.listSessions();
        if (sessions.length === 0) {
          console.log(chalk.dim("  (暂无会话，使用 /new 新建)"));
          break;
        }

        // Step 1: 先显示会话表格
        console.log("\n" + renderSessionTable(sessions) + "\n");
        console.log(chalk.dim("  ↑↓ 方向键选择会话，Enter 进入交互视图，Esc 取消"));

        // Step 2: 进入选择器（方向键导航 + Enter 确认选中）
        this.suggestionLines = 0;
        this.suggestionItems = [];
        this.overlayActive = true;
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        if (this.keypressHandler) process.stdin.removeListener("keypress", this.keypressHandler);

        // 循环：选择器 → 视图 → 返回选择器
        while (true) {
          const chosen = await pickSession(this.manager.listSessions());
          if (!chosen) break; // Esc 在选择器 → 退出到主 REPL
          this.currentSessionId = chosen.id;
          const result = this.sessionView.enter(chosen.id, this.rl);
          if (result === "exit") break; // Ctrl+C 在视图 → 退出到主 REPL
          // result === "back" → 重新显示选择器
        }

        if (this.keypressHandler) {
          process.stdin.resume();
          process.stdin.on("keypress", this.keypressHandler);
        }
        this.startStatusPoll();
        this.overlayActive = false;
        break;
      }

      case "new": {
        const workingDir = cmd.args[0] ?? process.cwd();
        console.log(chalk.dim(`  正在启动 Claude 会话（${workingDir}）...`));
        let newSessionId: string | null = null;
        try {
          const s = await this.manager.createSession({ adapterId: "claude", workingDir });
          this.currentSessionId = s.id;
          newSessionId = s.id;
          console.log(chalk.green(`  ✓ 已启动 ${s.id}，正在进入交互视图...`));
        } catch (e: any) {
          console.log(chalk.red(`  ✗ 启动失败: ${e.message}`));
        }
        // 启动成功后自动进入会话视图
        if (newSessionId) {
          this.overlayActive = true;
          if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
          if (this.keypressHandler) process.stdin.removeListener("keypress", this.keypressHandler);
          while (true) {
            const result = this.sessionView.enter(newSessionId, this.rl);
            if (result === "exit") break;
            // result === "back" → 进选择器让用户选择其他会话
            const sessions = this.manager.listSessions();
            if (sessions.length === 0) break;
            const chosen = await pickSession(sessions);
            if (!chosen) break;
            this.currentSessionId = chosen.id;
            newSessionId = chosen.id;
          }
          if (this.keypressHandler) {
            process.stdin.resume();
            process.stdin.on("keypress", this.keypressHandler);
          }
          this.startStatusPoll();
          this.overlayActive = false;
        }
        break;
      }

      case "select": {
        const id = cmd.args[0];
        if (!id) {
          // 无参数：弹出选择器，仅切换（不进入视图）
          const sessions = this.manager.listSessions();
          if (sessions.length === 0) {
            console.log(chalk.dim("  (暂无会话，使用 /new 新建)"));
            break;
          }
          this.overlayActive = true;
          if (this.keypressHandler) process.stdin.removeListener("keypress", this.keypressHandler);
          const chosen = await pickSession(sessions);
          if (this.keypressHandler) {
            process.stdin.resume();
            process.stdin.on("keypress", this.keypressHandler);
          }
          this.overlayActive = false;
          if (chosen) {
            this.currentSessionId = chosen.id;
            console.log(chalk.green(`  ✓ 已切换到 ${chosen.id}`));
          }
        } else {
          if (!this.manager.getSession(id)) {
            console.log(chalk.red(`  找不到会话: ${id}`));
            break;
          }
          this.currentSessionId = id;
          console.log(chalk.green(`  ✓ 已切换到 ${id}`));
        }
        break;
      }

      case "enter": {
        // 进入全屏会话交互视图
        const sessions = this.manager.listSessions();
        const specifiedId = cmd.args[0] ?? this.currentSessionId;

        this.suggestionLines = 0;
        this.suggestionItems = [];
        this.overlayActive = true;
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        if (this.keypressHandler) process.stdin.removeListener("keypress", this.keypressHandler);

        let targetId: string | undefined = specifiedId ?? undefined;
        if (!targetId) {
          if (sessions.length === 0) {
            console.log(chalk.dim("  (暂无会话，使用 /new 新建)"));
            this.overlayActive = false;
            this.startStatusPoll();
            if (this.keypressHandler) {
              process.stdin.resume();
              process.stdin.on("keypress", this.keypressHandler);
            }
            break;
          }
          const chosen = await pickSession(sessions);
          targetId = chosen?.id ?? undefined;
        }

        if (targetId) {
          if (!this.manager.getSession(targetId)) {
            console.log(chalk.red(`  找不到会话: ${targetId}`));
          } else {
            this.currentSessionId = targetId;
            this.sessionView.enter(targetId, this.rl);
          }
        }

        if (this.keypressHandler) {
          process.stdin.resume();
          process.stdin.on("keypress", this.keypressHandler);
        }
        this.startStatusPoll();
        this.overlayActive = false;
        break;
      }

      case "send": {
        const [id, ...rest] = cmd.args;
        if (!id || rest.length === 0) { console.log(chalk.yellow("  用法: /send <id> <prompt>")); break; }
        await this.manager.sendPrompt(id, rest.join(" ")).catch((e) =>
          console.log(chalk.red(`  发送失败: ${e.message}`))
        );
        console.log(chalk.dim(`  → sent to ${id}`));
        break;
      }

      case "wait": {
        const id = cmd.args[0] ?? this.currentSessionId;
        if (!id) { console.log(chalk.yellow("  用法: /wait <id>")); break; }
        console.log(chalk.dim(`  等待 ${id} 完成...`));
        await this.manager.sendAndWait(id, "").catch((e) =>
          console.log(chalk.red(`  等待失败: ${e.message}`))
        );
        console.log(chalk.dim(`  ✓ ${id} 完成`));
        break;
      }

      case "read": {
        const id = cmd.args[0] ?? this.currentSessionId;
        if (!id) { console.log(chalk.yellow("  用法: /read [id]")); break; }
        const out = await this.manager.readOutput(id).catch((e) => {
          console.log(chalk.red(`  读取失败: ${e.message}`));
          return "";
        });
        if (out) console.log("\n" + out + "\n");
        break;
      }

      case "status": {
        const sessions = cmd.args[0]
          ? [this.manager.getSession(cmd.args[0])].filter(Boolean) as any[]
          : this.manager.listSessions();
        console.log("\n" + renderSessionTable(sessions) + "\n");
        break;
      }

      case "route": {
        if (cmd.args[0] === "add") {
          const [, from, to] = cmd.args;
          if (!from || !to) { console.log(chalk.yellow("  用法: /route add <from> <to>")); break; }
          const id = this.router.addRule({ sourceSessionId: from, targetSessionId: to, enabled: true });
          console.log(chalk.green(`  ✓ 路由已添加 (${id.slice(0, 8)})`));
        } else {
          console.log(chalk.yellow("  用法: /route add <from> <to>"));
        }
        break;
      }

      case "routes": {
        const rules = this.router.getAllRules();
        if (rules.length === 0) { console.log(chalk.dim("  (无路由规则)")); break; }
        rules.forEach((r) => {
          const status = r.enabled ? chalk.green("on") : chalk.gray("off");
          console.log(`  ${r.id.slice(0, 8)}  ${r.sourceSessionId} → ${r.targetSessionId}  [${status}]`);
        });
        break;
      }

      case "unroute": {
        const id = cmd.args[0];
        if (!id) { console.log(chalk.yellow("  用法: /unroute <rule-id>")); break; }
        const rule = this.router.getAllRules().find((r) => r.id.startsWith(id));
        if (!rule) { console.log(chalk.red(`  找不到规则: ${id}`)); break; }
        this.router.removeRule(rule.id);
        console.log(chalk.green(`  ✓ 路由已删除`));
        break;
      }

      case "attach": {
        const id = cmd.args[0] ?? this.currentSessionId;
        if (!id) { console.log(chalk.yellow("  用法: /attach <id>")); break; }
        const session = this.manager.getSession(id);
        if (!session) { console.log(chalk.red(`  找不到会话: ${id}`)); break; }
        // Windows/MSYS2: 使用 mintty 打开新窗口 attach
        const minttyCmd = `mintty -e tmux attach -t ${session.tmuxSession}`;
        console.log(chalk.dim(`  运行: ${minttyCmd}`));
        console.log(chalk.dim("  (在 MSYS2 终端中执行，或在新 mintty 窗口中 attach)"));
        break;
      }

      case "kill": {
        const id = cmd.args[0];
        if (!id) { console.log(chalk.yellow("  用法: /kill <id>")); break; }
        await this.manager.destroySession(id).catch((e) =>
          console.log(chalk.red(`  销毁失败: ${e.message}`))
        );
        if (this.currentSessionId === id) this.currentSessionId = null;
        console.log(chalk.green(`  ✓ 已销毁 ${id}`));
        break;
      }

      case "exit":
        console.log(chalk.dim("  再见"));
        this.stop();
        process.exit(0);
        break;

      default:
        console.log(chalk.red(`  未知命令，输入 /help 查看帮助`));
    }
  }

  private setupRouterListener(): void {
    this.router.onEvent((event) => {
      if (event.type === "message_sent" && event.envelope) {
        const { fromSessionId, toSessionId, content } = event.envelope;
        const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
        clearLine();
        console.log(chalk.cyan(`[ROUTE] ${fromSessionId} → ${toSessionId}: ${preview}`));
        this.rl.prompt(true);
      }
    });
  }

  private startStatusPoll(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.pollTimer = setInterval(() => {
      for (const s of this.manager.listSessions()) {
        const prev = this.prevStatuses.get(s.id);
        if (prev && prev !== s.status) {
          clearLine();
          console.log(chalk.dim(`[${s.id}] ${prev} → ${s.status}`));
          this.rl.prompt(true);
        }
        this.prevStatuses.set(s.id, s.status);
      }
    }, STATUS_POLL_MS);
    this.pollTimer.unref();
  }

  private setupKeypressOverlay(): void {
    readline.emitKeypressEvents(process.stdin, this.rl);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    this.keypressHandler = (str: string, key: any) => {
      if (!key || this.overlayActive) return;

      // Ctrl+L: 清屏
      if (key.ctrl && key.name === "l") {
        this.rl.setPrompt(this.buildBasePrompt());
        this.suggestionLines = 0;
        process.stdout.write("[2J[H");
        this.rl.prompt(true);
        return;
      }

      // Esc: 关闭建议
      if (key.name === "escape" && !key.ctrl) {
        if (this.suggestionLines > 0) {
          this.suggestionLines = 0;
          this.suggestionItems = [];
          this.rl.setPrompt(this.buildBasePrompt());
          (this.rl as any)._refreshLine?.();
        }
        return;
      }

      // ↑↓ 导航建议
      if (this.suggestionLines > 0 && key.name === "up") {
        this.suggestionIdx = Math.max(0, this.suggestionIdx - 1);
        setImmediate(() => this.updateOverlayPrompt((this.rl as any).line ?? ""));
        return;
      }
      if (this.suggestionLines > 0 && key.name === "down") {
        this.suggestionIdx = Math.min(this.suggestionItems.length - 1, this.suggestionIdx + 1);
        setImmediate(() => this.updateOverlayPrompt((this.rl as any).line ?? ""));
        return;
      }

      // Tab: 接受高亮建议（填入选中命令）
      if (key.name === "tab" && this.suggestionLines > 0 && this.suggestionItems[this.suggestionIdx]) {
        const currentLine = ((this.rl as unknown) as { line: string }).line ?? "";
        let chosen: string;
        if (currentLine.includes(" ")) {
          // Case 2: 会话 ID 候选，填入 /cmd <id>
          const parts = currentLine.slice(1).split(/\s+/);
          chosen = "/" + parts[0] + " " + this.suggestionItems[this.suggestionIdx].name + " ";
        } else {
          // Case 1: 命令名候选
          chosen = "/" + this.suggestionItems[this.suggestionIdx].name + " ";
        }
        // 清除建议，设置输入行
        this.suggestionLines = 0;
        this.suggestionItems = [];
        this.rl.setPrompt(this.buildBasePrompt());
        (this.rl as any).line = chosen;
        (this.rl as any).cursor = chosen.length;
        (this.rl as any)._refreshLine?.();
        return;
      }

      // 每次按键后更新建议（等 readline 处理完 line buffer）
      setImmediate(() => this.updateOverlayPrompt((this.rl as any).line ?? ""));
    };

    process.stdin.on("keypress", this.keypressHandler);
  }

  /** 根据当前输入行更新多行 prompt（建议列表 + 基础 prompt）*/
  private updateOverlayPrompt(currentLine: string): void {
    const base = this.buildBasePrompt();

    // === Case 1: 命令名补全（输入 /xxx，不含空格）===
    if (currentLine.startsWith("/") && !currentLine.includes(" ") && currentLine.length > 0) {
      const partial = currentLine.slice(1);
      const matches = getMatches(partial);
      this.suggestionItems = matches;
      this.suggestionIdx = Math.min(this.suggestionIdx, Math.max(0, matches.length - 1));

      if (matches.length > 0) {
        const lines = matches.slice(0, 6).map((m, i) => {
          const sel = i === this.suggestionIdx;
          const prefix = sel ? chalk.cyan("❯ ") : "  ";
          const name = sel ? chalk.bold.cyan("/" + m.name) : chalk.dim("/" + m.name);
          const desc = chalk.dim(m.description);
          return prefix + name.padEnd(sel ? 18 : 16) + desc;
        });
        const sep = chalk.dim("  " + "─".repeat(44));
        const newPrompt = "\n" + lines.join("\n") + "\n" + sep + "\n" + base;
        if (this.rl.getPrompt() !== newPrompt) {
          this.rl.setPrompt(newPrompt);
          (this.rl as any)._refreshLine?.();
        }
        this.suggestionLines = matches.length + 2;
        return;
      }
    }

    // === Case 2: 命令后接 <id> 候选（如 "/send cl" 或 "/kill "）===
    // 需要 <id> 的命令列表
    const ID_COMMANDS = new Set(["send", "kill", "select", "wait", "read", "attach", "status"]);

    if (currentLine.startsWith("/") && currentLine.includes(" ")) {
      const parts = currentLine.slice(1).split(/\s+/);
      const cmdName = parts[0].toLowerCase();
      const idPartial = parts[1] ?? ""; // 正在输入的 id（可能为空）

      if (ID_COMMANDS.has(cmdName) && parts.length <= 2) {
        const sessions = this.manager.listSessions();
        const candidates = idPartial
          ? sessions.filter(s => s.id.includes(idPartial) || s.adapterId.includes(idPartial))
          : sessions;

        if (candidates.length > 0) {
          const displayCandidates = candidates.slice(0, 6);
          const lines = displayCandidates.map((s, i) => {
            const sel = i === this.suggestionIdx;
            const prefix = sel ? chalk.cyan("❯ ") : "  ";
            const id = sel ? chalk.bold.cyan(s.id) : chalk.white(s.id);
            const status = chalk.dim(s.status.padEnd(14));
            const dir = chalk.dim((s.workingDir.slice(-20)));
            return prefix + id.padEnd(sel ? 16 : 14) + status + dir;
          });
          const sep = chalk.dim("  " + "─".repeat(44));
          const newPrompt = "\n" + lines.join("\n") + "\n" + sep + "\n" + base;
          if (this.rl.getPrompt() !== newPrompt) {
            this.rl.setPrompt(newPrompt);
            (this.rl as any)._refreshLine?.();
          }
          this.suggestionLines = displayCandidates.length + 2;
          // 注入选中的会话 ID（Tab 接受）
          this.suggestionItems = displayCandidates.map(s => ({
            name: s.id,
            description: s.status,
            usage: s.workingDir,
          }));
          return;
        }
      }
    }

    // === 无候选：恢复基础 prompt ===
    if (this.suggestionLines > 0) {
      this.suggestionLines = 0;
      this.suggestionItems = [];
      this.rl.setPrompt(base);
      (this.rl as any)._refreshLine?.();
    }
  }

  private buildBasePrompt(): string {
    const session = this.currentSessionId
      ? this.manager.getSession(this.currentSessionId)
      : undefined;
    return buildPrompt(session);
  }

  private showOverlay(_line: string): void { /* replaced by updateOverlayPrompt */ }
  private clearOverlay(): void {
    this.suggestionLines = 0;
    this.suggestionItems = [];
    this.rl.setPrompt(this.buildBasePrompt());
    (this.rl as any)._refreshLine?.();
  }

}

