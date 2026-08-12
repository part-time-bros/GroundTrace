import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Component tests need a DOM; the rest of the monorepo runs in node.
    environment: "jsdom",
    globals: false,
  },
});
