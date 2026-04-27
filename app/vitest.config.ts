import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Default to node; component tests opt into jsdom via /** @vitest-environment jsdom */ pragma.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"],
    // Replaces global fetch with a guard that throws on unmocked calls.
    // Per-test vi.stubGlobal("fetch", …) overrides; the guard catches
    // tests that forgot to stub. See src/test-setup.ts for rationale.
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/app/api/approvals/**/*.ts",
        "src/app/approvals/**/*.tsx",
        "src/lib/tenant-sync.ts",
        "src/lib/kestra.ts",
        "src/lib/pulsar-auth.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.test.ts",
        "**/*.test.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
