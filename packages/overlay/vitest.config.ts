import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The overlay is DOM code end to end; there is nothing to test outside one.
    environment: "jsdom",
    globals: false,
  },
});
