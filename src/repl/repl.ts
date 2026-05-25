import * as readline from "node:readline";
import chalk from "chalk";
import { buildPrompt, clearLine, renderSessionTable, renderSuggestions, clearSuggestionLines, type SuggestionItem } from "./renderer.js";
import { parseCommand, HELP_TEXT } from "./commands.js";
import { pickSession } from "./session-picker.js";
import { completeLine, getMatches } from "./completer.js";
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
  private suggestionItems: SuggestionItem[] = [];
  private keypressHandler: ((str: string, key: any) => void) | null = null;
  private overlayActive = false;

  constructor(
    private manager: SessionManager,
    private router: MessageRouter,
    private forwarder: SessionForwarder,
  ) {
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
        console.log("\n" + renderSessionTable(sessions) + "\n");
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
        break;
      }

      case "new": {
        const workingDir = cmd.args[0] ?? process.cwd();
        console.log(chalk.dim(`  正在启动 Claude 会话（${workingDir}）...`));
        try {
          const s = await this.manager.createSession({ adapterId: "claude", workingDir });
          this.currentSessionId = s.id;
          console.log(chalk.green(`  ✓ 已启动 ${s.id}`));
        } catch (e: any) {
          console.log(chalk.red(`  ✗ 启动失败: ${e.message}`));
        }
        break;
      }

      case "select": {
        const id = cmd.args[0];
        if (!id) { console.log(chalk.yellow("  用法: /select <id>")); break; }
        if (!this.manager.getSession(id)) { console.log(chalk.red(`  找不到会话: ${id}`)); break; }
        this.currentSessionId = id;
        console.log(chalk.green(`  ✓ 已切换到 ${id}`));
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
      if (!key) return;
      // 获取 readline 当前缓冲行（内部属性）
      const line = ((this.rl as unknown) as { line: string }).line ?? "";

      // Ctrl+L: 清屏
      if (key.ctrl && key.name === "l") {
        this.suggestionLines = 0; // 直接置 0，跳过 ANSI 上移（屏幕即将被清除）
        process.stdout.write("\x1b[2J\x1b[H");
        this.rl.prompt(true);
        return;
      }

      // Esc: 关闭建议叠加层
      if (key.name === "escape" && !key.ctrl) {
        this.clearOverlay();
        return;
      }

      // 建议层打开时，方向键 ↑↓ 导航
      if (this.suggestionLines > 0) {
        if (key.name === "up") {
          this.clearOverlay();
          this.suggestionIdx = Math.max(0, this.suggestionIdx - 1);
          this.showOverlay(line);
          return;
        }
        if (key.name === "down") {
          this.clearOverlay();
          this.suggestionIdx = Math.min(
            this.suggestionItems.length - 1,
            this.suggestionIdx + 1,
          );
          this.showOverlay(line);
          return;
        }
      }

      // 实时更新：当前行以 / 开头且不含空格 → 显示/更新建议层
      // 使用 setTimeout 确保 readline 已更新内部 line buffer
      setTimeout(() => {
        const currentLine = ((this.rl as unknown) as { line: string }).line ?? "";
        if (currentLine.startsWith("/") && !currentLine.includes(" ")) {
          this.clearOverlay();
          this.suggestionIdx = 0;
          this.showOverlay(currentLine);
        } else if (this.suggestionLines > 0) {
          this.clearOverlay();
        }
      }, 0);
    };

    process.stdin.on("keypress", this.keypressHandler);
  }

  private showOverlay(line: string): void {
    const partial = line.startsWith("/") ? line.slice(1) : "";
    this.suggestionItems = getMatches(partial);
    if (this.suggestionItems.length === 0) return;
    // clamp idx 防止导航后 items 数量变化时越界
    this.suggestionIdx = Math.min(this.suggestionIdx, this.suggestionItems.length - 1);
    this.suggestionLines = renderSuggestions(this.suggestionItems, this.suggestionIdx);
  }

  private clearOverlay(): void {
    if (this.suggestionLines > 0) {
      clearSuggestionLines(this.suggestionLines);
      this.suggestionLines = 0;
    }
  }
}
