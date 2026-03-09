import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          exclude: ["test/**/*.browser.test.ts"],
          globals: true,
          include: ["test/**/*.test.ts"],
          name: "node",
          testTimeout: 30_000,
        },
      },
      {
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [
              { browser: "chromium" },
              { browser: "firefox" },
            ],
            provider: playwright(),
          },
          globals: true,
          include: ["test/**/*.browser.test.ts"],
          name: "browser",
          testTimeout: 30_000,
        },
      },
    ],
  },
});
