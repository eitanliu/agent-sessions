import { describe, it, expect } from "vitest";
import { parseCommand } from "../../repl/commands.js";

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
  });

  it("parses /new with no args", () => {
    expect(parseCommand("/new")).toEqual({ name: "new", args: [], raw: "/new" });
  });

  it("parses /send with session and prompt words", () => {
    const cmd = parseCommand("/send claude-0 hello world");
    expect(cmd?.name).toBe("send");
    expect(cmd?.args).toEqual(["claude-0", "hello", "world"]);
  });

  it("parses /route add with from and to", () => {
    const cmd = parseCommand("/route add claude-0 claude-1");
    expect(cmd?.name).toBe("route");
    expect(cmd?.args).toEqual(["add", "claude-0", "claude-1"]);
  });

  it("trims input before parsing", () => {
    const cmd = parseCommand("  /list  ");
    expect(cmd?.name).toBe("list");
    expect(cmd?.args).toEqual([]);
  });

  it("returns null for empty string", () => {
    expect(parseCommand("")).toBeNull();
  });

  it("parses /exit", () => {
    expect(parseCommand("/exit")).toEqual({ name: "exit", args: [], raw: "/exit" });
  });
});
