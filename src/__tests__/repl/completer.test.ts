import { describe, it, expect } from "vitest";
import { getMatches, completeLine, COMMAND_DEFS } from "../../repl/completer.js";

describe("COMMAND_DEFS", () => {
  it("has 14 entries, each with name/description/usage", () => {
    expect(COMMAND_DEFS.length).toBe(14);
    for (const def of COMMAND_DEFS) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.usage).toBeTruthy();
    }
  });
});

describe("getMatches", () => {
  it("returns all commands (max 6) for empty input", () => {
    const m = getMatches("");
    expect(m.length).toBeGreaterThan(0);
    expect(m.length).toBeLessThanOrEqual(6);
  });

  it("returns prefix matches", () => {
    const m = getMatches("ne");
    expect(m.map(d => d.name)).toContain("new");
  });

  it("returns substring matches", () => {
    const m = getMatches("ro");
    const names = m.map(d => d.name);
    expect(names).toContain("route");
    expect(names).toContain("routes");
    expect(names).toContain("unroute");
  });

  it("prefix match ranks before substring match", () => {
    const m = getMatches("r");
    // "read" starts with "r", should appear before "unroute" which only contains "r"
    const names = m.map(d => d.name);
    const readIdx = names.indexOf("read");
    const unrouteIdx = names.indexOf("unroute");
    if (readIdx !== -1 && unrouteIdx !== -1) {
      expect(readIdx).toBeLessThan(unrouteIdx);
    }
  });

  it("returns empty for no match", () => {
    expect(getMatches("zzz")).toEqual([]);
  });

  it("limits results to max 6", () => {
    expect(getMatches("").length).toBeLessThanOrEqual(6);
  });
});

describe("completeLine", () => {
  it("returns no completions for non-command input", () => {
    const [completions, line] = completeLine("hello");
    expect(completions).toEqual([]);
    expect(line).toBe("hello");
  });

  it("returns completions for / prefix", () => {
    const [completions, line] = completeLine("/");
    expect(completions.length).toBeGreaterThan(0);
    expect(line).toBe("/");
  });

  it("returns filtered completions for partial command", () => {
    const [completions, line] = completeLine("/ne");
    expect(completions).toContain("/new");
    expect(line).toBe("/ne");
  });

  it("returns empty when command already complete and has trailing space", () => {
    const [completions] = completeLine("/new ");
    expect(completions).toEqual([]);
  });
});
