import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Auto-tagging is DOM work end to end.
    environment: "jsdom",
    globals: false,
  },
});
