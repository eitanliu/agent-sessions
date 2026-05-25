import { platform } from "node:os";

export type Platform = "windows" | "wsl" | "linux" | "macos";

let _cached: Platform | null = null;

export function getPlatform(): Platform {
  if (_cached !== null) return _cached;
  if (platform() === "win32") return (_cached = "windows");
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) return (_cached = "wsl");
  return (_cached = platform() === "darwin" ? "macos" : "linux");
}

export function resetPlatformCache(): void {
  _cached = null;
}
