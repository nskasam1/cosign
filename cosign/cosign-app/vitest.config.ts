import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom is the default for component tests; pure-logic tests opt into
    // the fast node environment with a `// @vitest-environment node` pragma.
    environment: "jsdom",
    // Vitest's default is 5 s, and two Phase 4 tests build a unanimous crowd
    // of fifty against a real SQLite file. They run in 1–3 s on an idle box
    // and time out when one is competing with a build and a running server —
    // which is exactly what `scripts/phase5b-evidence.sh` does, and it
    // reported a red suite for a machine-load artifact. Same lesson as the
    // Lighthouse medians in CLAUDE.md: a number that moves with load needs
    // headroom, not a quieter machine.
    testTimeout: 20_000,
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "server/**/*.{test,spec}.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
