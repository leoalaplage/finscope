import { describe, expect, it } from "vitest";
import { isStaleBuild, STALE_BUILD_BOOT } from "../lib/stale-build";

describe("a page open across a deploy", () => {
  it("knows a missing piece of an earlier build from any other failure", () => {
    expect(isStaleBuild(new TypeError("Failed to fetch dynamically imported module: https://x/_next/static/chunks/a-1.js"))).toBe(true);
    expect(isStaleBuild(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleBuild(new Error("Unable to preload CSS for /_next/static/css/io.css"))).toBe(true);
    expect(isStaleBuild(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("boots as a script that parses", () => {
    expect(() => new Function(STALE_BUILD_BOOT)).not.toThrow();
  });
});
