import * as readline from "node:readline";
import chalk from "chalk";
import { buildPrompt, clearLine, renderSessionTable } from "./renderer.js";
import { parseCommand, HELP_TEXT } from "./commands.js";
import { completeLine } from "./completer.js";
import type { SessionManager } from "../sessions/manager.js";
import type { MessageRouter } from "../routing/router.js";
import type { SessionForwarder } from "../routing/forwarder.js";

const STATUS_POLL_MS = 2_000;

export class InteractiveREPL {
  private rl: readline.Interface;
  private currentSessionId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private prevStatuses = new Map<string, string>();

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
    console.log(chalk.bold("\nagent-sessions") + chalk.dim(" — 多窗口 Claude 会话管理器"));
    console.log(chalk.dim('输入 /help 查看命令，/new 新建会话\n'));
    this.setupRouterListener();
    this.startStatusPoll();
    this.refreshPrompt();

    this.rl.on("line", async (line) => {
      await this.handleLine(line.trim());
      this.refreshPrompt();
    });

    this.rl.on("close", () => { this.stop(); process.exit(0); });
  }

  stop(): void {
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

      case "list":
        console.log("\n" + renderSessionTable(this.manager.listSessions()) + "\n");
        break;

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
}
