# 待修复问题记录

## 问题 1：/new 工作目录不正确

**现象：** 执行 `/new` 后 Claude Code CLI 在 MSYS2 home 目录启动（`D:\DevSoft\msys64\home\eitanliu`），而不是用户当前所在目录。

**期望：** 应在执行 `/new` 时所在的目录启动。

**已尝试的方案（均未生效）：**
- `process.cwd()` → `D:\code\ai\agent-sessions`，`toPosixPath()` 转换为 `/d/code/ai/agent-sessions`
- `tmux new-session -c /d/code/ai/agent-sessions` → tmux 忽略，回退到 home
- `bash -c "cd '/d/code/ai/agent-sessions' && exec claude"` → 目录传入了但仍不对

**当前代码路径：**
- `src/repl/repl.ts:170` — `toPosixPath(process.cwd())`
- `src/adapters/claude/adapter.ts:24` — `toPosixPath(workingDir)` → bash 脚本
- `src/tmux/bridge.ts:40` — `createSession({ command: ["bash", "-c", script] })`

**排查方向：**
- 确认 `console.log` 里显示的 `workingDir` 值是否正确
- 确认 Claude Code CLI 用什么方式确定工作目录（是否忽略 cwd，改用其他机制）
- 尝试：在 bash 脚本里 `echo $PWD > /tmp/debug.txt` 确认 bash 的 cwd 是否正确
- 尝试：直接在 MSYS2 终端手动执行 `tmux new-session -d -s test bash -c "export TERM=xterm-256color; cd '/d/code/ai/agent-sessions' && exec /c/Users/eitanliu/.local/bin/claude"` 并 attach 查看

---

## 问题 2：Unicode 字符显示为 `_`

**现象：** Claude Code CLI 欢迎界面的圆角框（╭╮╰╯）、特殊图标显示为 `_`，后续会话也有 `⏵⏵ ❯` 字符异常。

**环境：** MSYS2（非 mintty），字体应支持 Unicode。

**已尝试的方案（未生效）：**
- `export TERM=xterm-256color` 加在 bash 启动脚本里

**当前代码：**
- `src/adapters/claude/adapter.ts:36` — `export TERM=xterm-256color; cd '...' && exec claude`

**排查方向：**
- 确认 Claude Code CLI 版本（`claude --version`），某些版本在 Windows 下强制使用 ASCII fallback
- 尝试：`export TERM=xterm-256color LANG=C.UTF-8 LC_ALL=C.UTF-8` 同时设置
- 尝试：直接在 MSYS2 终端 `TERM=xterm-256color /c/Users/eitanliu/.local/bin/claude` 看效果
- 检查：Windows Terminal 的配置是否启用了 UTF-8 输出（"Use UTF-8 encoding"）
- 可能原因：Claude Code CLI 在 Windows 上通过 Win32 API 检测终端能力，MSYS2 的 PTY 可能被识别为不支持 Unicode 的 Windows 控制台

---

## 已修复

- ✅ 首次 `/new` 乱码：改为立即 attach（`INIT_WAIT_MS=0`），用户从头看到 Claude 启动
- ✅ `/list` 进入需要选择再回车
- ✅ `export PATH=...` 不再出现在会话输入历史
- ✅ 返回列表提示（`Ctrl+B D`）显示在状态栏
