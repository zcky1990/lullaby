import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard untuk komponen `src/components/ui`.
 *
 * Komponen dari registry shadcn sempat masuk dengan dua kesalahan:
 * - `import { cn } from "cn"` — itu nama paket npm (`cn`, ikut terpasang di
 *   package.json), bukan util project. Akibatnya `tailwind-merge` tidak dipakai
 *   (class override bertabrakan) dan tipenya tidak cocok → error `tsc`.
 * - `React.ComponentProps` tanpa `import * as React` → error TS2686 ("React"
 *   refers to a UMD global).
 *
 * Test ini menjaga keduanya tidak muncul lagi saat komponen di-generate ulang.
 */
const UI_DIR = new URL("../components/ui/", import.meta.url);

function uiSources(): Array<[string, string]> {
  return readdirSync(UI_DIR)
    .filter((name) => name.endsWith(".tsx"))
    .map((name): [string, string] => [
      name,
      readFileSync(new URL(name, UI_DIR), "utf8"),
    ]);
}

describe("komponen ui", () => {
  it("mengimpor cn dari @/lib/utils", () => {
    const offenders = uiSources()
      .filter(([, source]) => /from\s+"cn"/.test(source))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });

  it("mengimpor React sebelum memakai namespace React", () => {
    const offenders = uiSources()
      .filter(([, source]) => /\bReact\./.test(source) && !/from\s+"react"/.test(source))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });
});
