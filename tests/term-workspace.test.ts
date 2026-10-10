import { describe, expect, it } from "vitest";
import { cleanWorkspace, defaultWorkspace, readWorkspaceStore, saveLayout, withSymbol } from "@/lib/term/workspace";
import { parseCommand, hrefFor } from "@/lib/term/command";

describe("the chart workspace", () => {
  it("opens on one chart of the requested symbol, with three others ready", () => {
    const workspace = defaultWorkspace("TSLA");
    expect(workspace.layout).toBe(1);
    expect(workspace.cells.map((cell) => cell.symbol)).toEqual(["TSLA", "AAPL", "NVDA", "MSFT"]);
    expect(workspace.cells[0].studies).toContain("volume");
  });

  it("repairs whatever the browser hands back", () => {
    const repaired = cleanWorkspace({ layout: 3, cells: [{ symbol: "msft", interval: "1h", studies: ["rsi", "astrology"] }], active: 9 });
    expect(repaired.layout).toBe(1);
    expect(repaired.cells[0]).toEqual({ symbol: "MSFT", interval: "1d", studies: ["rsi"] });
    expect(repaired.cells).toHaveLength(4);
    expect(repaired.active).toBe(0);
    expect(readWorkspaceStore("not json").saved).toEqual([]);
  });

  it("keeps named layouts, newest first, replacing one of the same name", () => {
    let store = readWorkspaceStore(null);
    store = saveLayout(store, "Semis");
    store = saveLayout({ ...store, current: { ...store.current, layout: 4 } }, "Macro");
    store = saveLayout({ ...store, current: { ...store.current, layout: 2 } }, "semis");
    expect(store.saved.map((item) => [item.name, item.workspace.layout])).toEqual([["semis", 2], ["Macro", 4]]);
    expect(saveLayout(store, "   ")).toBe(store);
  });

  it("points the active chart at a symbol and refuses nonsense", () => {
    const workspace = { ...defaultWorkspace(), active: 2, layout: 4 as const };
    expect(withSymbol(workspace, "amd").cells[2].symbol).toBe("AMD");
    expect(withSymbol(workspace, "not a symbol")).toBe(workspace);
  });
});

describe("opening the chart workspace from the command line", () => {
  it("takes a security before or after CHART, or the one on screen", () => {
    expect(hrefFor(parseCommand("AAPL CHART"))).toBe("/t/chart?s=AAPL");
    expect(hrefFor(parseCommand("chart nvda"))).toBe("/t/chart?s=NVDA");
    expect(hrefFor(parseCommand("CHART", "MSFT"))).toBe("/t/chart?s=MSFT");
    expect(hrefFor(parseCommand("CHART"))).toBe("/t/chart");
  });
});
