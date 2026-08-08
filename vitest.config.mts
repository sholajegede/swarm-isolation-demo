import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test runs functions in an environment that matches the Convex
    // runtime rather than Node.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
