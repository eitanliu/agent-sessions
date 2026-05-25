import { describe, it, expect, vi, afterEach } from "vitest";

describe("getPlatform", () => {
  afterEach(() => vi.unstubAllEnvs());

  // windows 分支：只在 win32 上运行，清除 WSL 相关 env
  it.skipIf(process.platform !== "win32")("returns 'windows' on win32", async () => {
    vi.stubEnv("WSL_DISTRO_NAME", "");
    vi.stubEnv("WSLENV", "");
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    expect(getPlatform()).toBe("windows");
  });

  // WSL 分支：只在 linux 上运行（vi.mock("node:os") 对 ESM 有限制，无法在 win32 伪造 linux）
  it.skipIf(process.platform !== "linux")("returns 'wsl' when WSL_DISTRO_NAME is set", async () => {
    vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu-24.04");
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    expect(getPlatform()).toBe("wsl");
  });

  // linux 分支：只在 linux 上运行
  it.skipIf(process.platform !== "linux")("returns 'linux' on linux without WSL env", async () => {
    vi.stubEnv("WSL_DISTRO_NAME", "");
    vi.stubEnv("WSLENV", "");
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    expect(getPlatform()).toBe("linux");
  });

  // 通用测试：getPlatform 返回合法值
  it("returns a valid platform string", async () => {
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    const result = getPlatform();
    expect(["windows", "wsl", "linux", "macos"]).toContain(result);
  });

  // 缓存测试：连续调用返回相同值
  it("caches result after first call", async () => {
    const { resetPlatformCache, getPlatform } = await import("../../tmux/platform.js");
    resetPlatformCache();
    const first = getPlatform();
    const second = getPlatform();
    expect(first).toBe(second);
  });
});
