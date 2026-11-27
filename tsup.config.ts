import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/browser.ts"],
  format: ["esm"],
  // Inline the pkc-logger `Logger` type so the published .d.ts does not
  // import @pkcprotocol/pkc-logger (a devDependency only).
  dts: { resolve: [/^@pkcprotocol\/pkc-logger$/, /^\.\/(ring-buffer|format)\.js$/] },
  clean: true,
  target: "es2022",
  external: ["better-sqlite3"],
});
