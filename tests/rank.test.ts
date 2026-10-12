import { describe, expect, it } from "vitest";
import { nextRank, ranked } from "@/lib/term/rank";

describe("market table ranking", () => {
  const rows = [{ id: "A", move: 1 }, { id: "B", move: -2 }, { id: "C", move: null }, { id: "D", move: 3 }, { id: "E", move: 1 }];
  const ids = (list: typeof rows) => list.map((row) => row.id).join("");
  it("cycles best first, worst first, as listed", () => {
    const first = nextRank(null, "move");
    expect(first).toEqual({ key: "move", direction: "desc" });
    const second = nextRank(first, "move");
    expect(second).toEqual({ key: "move", direction: "asc" });
    expect(nextRank(second, "move")).toBeNull();
    expect(nextRank(second, "d5")).toEqual({ key: "d5", direction: "desc" });
  });
  it("sorts by the figure, missing last, ties in listed order", () => {
    expect(ids(ranked(rows, { key: "move", direction: "desc" }, (row) => row.move))).toBe("DAEBC");
    expect(ids(ranked(rows, { key: "move", direction: "asc" }, (row) => row.move))).toBe("BAEDC");
    expect(ids(ranked(rows, null, (row) => row.move))).toBe("ABCDE");
  });
});
