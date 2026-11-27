import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Runs after `pretest` builds dist/. The published types must not import
// pkc-js or pkc-logger: both are devDependencies, and standalone users install
// neither. tsup inlines pkc-logger's Logger type (see tsup.config.ts).
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");
const dtsFiles = readdirSync(distDir).filter((f) => f.endsWith(".d.ts"));

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

describe("published .d.ts", () => {
  it("exists", () => {
    expect(dtsFiles).toContain("index.d.ts");
    expect(dtsFiles).toContain("browser.d.ts");
  });

  it.each(dtsFiles)("%s imports nothing from @pkcprotocol", (file) => {
    const specifiers = importSpecifiers(readFileSync(join(distDir, file), "utf8"));
    expect(specifiers.filter((s) => s.startsWith("@pkcprotocol/"))).toEqual([]);
  });

  it.each(dtsFiles)("%s has no dangling relative imports", (file) => {
    const specifiers = importSpecifiers(readFileSync(join(distDir, file), "utf8"));
    for (const specifier of specifiers.filter((s) => s.startsWith("."))) {
      const target = join(distDir, specifier.replace(/\.js$/, ".d.ts"));
      expect(existsSync(target), `${file} imports missing ${specifier}`).toBe(true);
    }
  });
});
