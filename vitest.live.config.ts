import { defineConfig } from "vitest/config";

// Live tests read the real BSIP-13 registry through public RPC endpoints, so
// they are kept out of `npm test` and run with `npm run test:live`.
export default defineConfig({
  test: {
    globals: true,
    include: ["test/live/**/*.test.ts"],
    name: "live",
    // Public RPCs fail intermittently; each test also fails over between providers.
    retry: 2,
    testTimeout: 60_000,
  },
});
