import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same `@` the application imports by. A test that pulls in a component
  // pulls in whatever that component imports, and until this was here a value
  // import — as opposed to a type-only one, which is erased — failed to
  // resolve at run time even though the build was fine.
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
