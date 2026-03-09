import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/browser.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["better-sqlite3"],
});
