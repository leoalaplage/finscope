import { describe, expect, it } from "vitest";
import { KEY_VERSION } from "../lib/data-version";
import { serveableWhileBuilding } from "../lib/dataset-cache";

describe("a version change never blanks the screeners", () => {
  it("serves the previous data version while the current one is rebuilt", () => {
    // Forgetting this on a version bump showed half the S&P 500 with no filing
    // columns in both screeners for the hours a rebuild takes.
    const previous = `v${Number(KEY_VERSION.slice(1)) - 1}`;
    expect(serveableWhileBuilding().map((entry) => entry.version)).toContain(previous);
  });
});
