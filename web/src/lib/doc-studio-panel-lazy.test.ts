import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard PERF-9 untuk menu Doc Studio.
 *
 * Panel dipecah dua modul: wrapper tipis `components/DocStudioPanel.tsx`
 * (lazy + Suspense + Skeleton) dan implementasi di
 * `components/docstudio/DocStudioPanel.tsx`. `ActivityBar` hanya boleh
 * meng-import wrapper supaya panel tidak masuk chunk utama.
 */
const wrapper = readFileSync(
  new URL("../components/DocStudioPanel.tsx", import.meta.url),
  "utf8",
);
const impl = readFileSync(
  new URL("../components/docstudio/DocStudioPanel.tsx", import.meta.url),
  "utf8",
);
const activityBar = readFileSync(
  new URL("../components/ActivityBar.tsx", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../components/DocStudioSettings.tsx", import.meta.url),
  "utf8",
);

function staticValueImport(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^import\\s+(?!type\\b)[^;]*from\\s+["']${escaped}["']`, "m");
}

describe("Doc Studio: panel dimuat lazy", () => {
  it("wrapper tipis dengan lazy + Suspense + Skeleton", () => {
    expect(wrapper).toContain("export function DocStudioPanel(");
    expect(wrapper).toContain('import("@/components/docstudio/DocStudioPanel")');
    expect(wrapper).toContain("<Suspense");
    expect(wrapper).toContain("Skeleton");
    expect(wrapper).not.toMatch(staticValueImport("@/components/docstudio/DocStudioPanel"));
  });

  it("implementasi terpisah dan memang memakai API Doc Studio", () => {
    expect(impl).toContain("export function DocStudioPanel(");
    expect(impl).toContain("docStudioApi");
  });

  it("ActivityBar hanya meng-import wrapper", () => {
    expect(activityBar).toContain('from "@/components/DocStudioPanel"');
    expect(activityBar).not.toContain("@/components/docstudio/DocStudioPanel");
  });

  it("settings section Doc Studio memakai klien doc-studio, bukan api.ts", () => {
    expect(settings).toContain("docStudioApi");
    expect(settings).toContain("export function DocStudioSettings(");
  });
});
