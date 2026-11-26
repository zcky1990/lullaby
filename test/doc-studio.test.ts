import { equal, ok } from "node:assert/strict";
import {
  DocStudioConfigInput,
  DocStudioFinalizeInput,
  DocStudioTurnInput,
} from "../src/config/schema_doc_studio.ts";
import {
  buildDocStudioFinalizePrompt,
  buildDocStudioSystemPrompt,
  DOC_STUDIO_READY_SENTINEL,
  stripMarkdownFence,
  stripReadySentinel,
  transcriptForPrompt,
} from "../src/server/docstudio/prompts.ts";
import {
  BUILTIN_DOC_TEMPLATES,
  type DocTemplate,
  listDocTemplates,
  resolveDocTemplate,
} from "../src/server/docstudio/templates.ts";
import {
  handleDocStudioRequest,
  matchDocStudioRoute,
} from "../src/server/routes/doc-studio.ts";

const PRD = BUILTIN_DOC_TEMPLATES.find((template) => template.id === "prd")!;

const CUSTOM: DocTemplate = {
  id: "onboarding",
  label: "Onboarding Guide",
  description: "Panduan onboarding tim.",
  outline: ["Tujuan", "Langkah"],
  interviewTopics: ["siapa pesertanya", "apa saja langkahnya"],
};

Deno.test("docstudio templates: tipe bawaan lengkap dan resolvable", () => {
  ok(BUILTIN_DOC_TEMPLATES.length >= 8);
  for (const template of BUILTIN_DOC_TEMPLATES) {
    ok(template.outline.length >= 2, `${template.id} butuh minimal 2 bagian`);
    ok(template.interviewTopics.length >= 1);
    equal(resolveDocTemplate(template.id)?.label, template.label);
  }
});

Deno.test("docstudio templates: id tidak dikenal → null", () => {
  equal(resolveDocTemplate("nope"), null);
  equal(resolveDocTemplate("  "), null);
});

Deno.test("docstudio templates: tipe kustom menimpa tipe bawaan dengan id sama", () => {
  const override: DocTemplate = { ...CUSTOM, id: "prd", label: "PRD v2" };
  equal(resolveDocTemplate("prd", [override])?.label, "PRD v2");

  const list = listDocTemplates([override, CUSTOM]);
  equal(list.filter((template) => template.id === "prd").length, 1);
  equal(list.find((template) => template.id === "prd")?.label, "PRD v2");
  ok(list.some((template) => template.id === "onboarding"));
});

Deno.test("docstudio prompt: persona → rules → bahasa → outline, override menimpa rules", () => {
  const prompt = buildDocStudioSystemPrompt({
    template: PRD,
    persona: "You are a senior product manager.",
    language: "id",
  });
  ok(prompt.startsWith("You are a senior product manager."));
  ok(prompt.includes("Ask exactly ONE question per reply"));
  ok(prompt.includes("Write in Bahasa Indonesia."));
  ok(prompt.includes("## Problem"));

  const override = buildDocStudioSystemPrompt({
    template: PRD,
    override: "Tanya maksimal 3 pertanyaan saja.",
    language: "en",
  });
  ok(override.includes("Tanya maksimal 3 pertanyaan saja."));
  equal(override.includes("Ask exactly ONE question per reply"), false);
  ok(override.includes("Write in English."));
});

Deno.test("docstudio prompt: bahasa auto mengikuti user", () => {
  const prompt = buildDocStudioSystemPrompt({ template: PRD, language: "auto" });
  ok(prompt.includes("same language the user writes in"));
});

Deno.test("docstudio prompt: finalize memakai outline tipe dokumen + override", () => {
  const prompt = buildDocStudioFinalizePrompt({
    template: PRD,
    language: "en",
    override: "Selalu sertakan tabel metrik.",
  });
  ok(prompt.includes("## Success Metrics"));
  ok(prompt.includes("Selalu sertakan tabel metrik."));
  ok(prompt.includes("Write in English."));
});

Deno.test("docstudio prompt: sentinel READY dibuang dari balasan", () => {
  const withSentinel = `Semua sudah lengkap.\n${DOC_STUDIO_READY_SENTINEL}`;
  const parsed = stripReadySentinel(withSentinel);
  equal(parsed.ready, true);
  equal(parsed.text, "Semua sudah lengkap.");

  const plain = stripReadySentinel("Siapa pengguna utamanya?");
  equal(plain.ready, false);
  equal(plain.text, "Siapa pengguna utamanya?");
});

Deno.test("docstudio prompt: fence markdown pembungkus dibuang", () => {
  equal(stripMarkdownFence("```markdown\n# Judul\n\nisi\n```"), "# Judul\n\nisi");
  equal(stripMarkdownFence("```\n# Judul\n```"), "# Judul");
  equal(stripMarkdownFence("# Judul\n\nisi"), "# Judul\n\nisi");
});

Deno.test("docstudio prompt: transkrip dibatasi jumlah giliran", () => {
  const turns = Array.from({ length: 10 }, (_, index) => ({
    role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `isi ${index}`,
  }));
  const text = transcriptForPrompt(turns, 4);
  ok(text.includes("isi 9"));
  equal(text.includes("isi 0"), false);
});

Deno.test("docstudio schema: config partial (field absen) tetap valid", () => {
  const parsed = DocStudioConfigInput.safeParse({ language: "id" });
  equal(parsed.success, true);
  equal(DocStudioConfigInput.safeParse({ unknownField: true }).success, false);
});

Deno.test("docstudio schema: prompt per tipe maksimal 20.000 karakter", () => {
  equal(
    DocStudioConfigInput.safeParse({ types: { prd: { prompt: "x".repeat(20_000) } } }).success,
    true,
  );
  equal(
    DocStudioConfigInput.safeParse({ types: { prd: { prompt: "x".repeat(20_001) } } }).success,
    false,
  );
});

Deno.test("docstudio schema: tipe kustom wajib punya id valid + outline ≥ 2", () => {
  equal(
    DocStudioConfigInput.safeParse({
      customTypes: [{
        id: "onboarding",
        label: "Onboarding",
        outline: ["Tujuan", "Langkah"],
        interviewTopics: ["siapa pesertanya"],
      }],
    }).success,
    true,
  );
  equal(
    DocStudioConfigInput.safeParse({
      customTypes: [{ id: "on boarding", label: "X", outline: ["A", "B"], interviewTopics: ["a"] }],
    }).success,
    false,
  );
  equal(
    DocStudioConfigInput.safeParse({
      customTypes: [{ id: "x", label: "X", outline: ["A"], interviewTopics: ["a"] }],
    }).success,
    false,
  );
});

Deno.test("docstudio schema: pesan interview 1..8000 karakter", () => {
  equal(DocStudioTurnInput.safeParse({ message: "halo" }).success, true);
  equal(DocStudioTurnInput.safeParse({ message: "   " }).success, false);
  equal(DocStudioTurnInput.safeParse({ message: "x".repeat(8_001) }).success, false);
});

Deno.test("docstudio schema: judul finalize opsional", () => {
  equal(DocStudioFinalizeInput.safeParse({}).success, true);
  equal(DocStudioFinalizeInput.safeParse({ title: "" }).success, false);
  equal(DocStudioFinalizeInput.safeParse({ title: "PRD Checkout" }).success, true);
});

Deno.test("docstudio route: path lain bukan milik modul ini", async () => {
  equal(await handleDocStudioRequest(new Request("http://127.0.0.1:1/api/health")), null);
  equal(
    await handleDocStudioRequest(new Request("http://127.0.0.1:1/api/projects/x/documents")),
    null,
  );
  equal(matchDocStudioRoute("/api/health", "GET"), null);
  equal(matchDocStudioRoute("/api/projects/x/documents", "GET"), null);
});

/**
 * Regresi: koleksi `drafts` melayani `GET` (daftar) dan `POST` (buat draft +
 * interview pertama). Dulu `POST` ikut dirutekan ke handler daftar sehingga
 * semua percobaan memulai interview berakhir `405 method_not_allowed`.
 */
Deno.test("docstudio route: POST koleksi drafts = create, GET = list", () => {
  const create = matchDocStudioRoute("/api/projects/p1/doc-studio/drafts", "POST");
  equal(create?.kind, "drafts");
  equal(create?.kind === "drafts" ? create.mode : null, "create");
  equal(create?.kind === "drafts" ? create.projectId : null, "p1");

  const list = matchDocStudioRoute("/api/projects/p1/doc-studio/drafts", "GET");
  equal(list?.kind === "drafts" ? list.mode : null, "list");

  // method huruf kecil tetap dikenali
  const lowercase = matchDocStudioRoute("/api/projects/p1/doc-studio/drafts", "post");
  equal(lowercase?.kind === "drafts" ? lowercase.mode : null, "create");
});

Deno.test("docstudio route: sub-route draft/turns/finalize dipetakan terpisah", () => {
  const draft = matchDocStudioRoute("/api/projects/p1/doc-studio/drafts/d1", "GET");
  equal(draft?.kind, "draft");
  equal(draft?.kind === "draft" ? draft.draftId : null, "d1");

  const turns = matchDocStudioRoute("/api/projects/p1/doc-studio/drafts/d1/turns", "POST");
  equal(turns?.kind, "turns");
  equal(turns?.kind === "turns" ? turns.draftId : null, "d1");

  const finalize = matchDocStudioRoute("/api/projects/p1/doc-studio/drafts/d1/finalize", "POST");
  equal(finalize?.kind, "finalize");
  equal(finalize?.kind === "finalize" ? finalize.draftId : null, "d1");

  equal(matchDocStudioRoute("/api/doc-studio/templates", "GET")?.kind, "templates");
  equal(matchDocStudioRoute("/api/settings/doc-studio", "PUT")?.kind, "settings");
});

Deno.test("docstudio route: tanpa token → 401", async () => {
  const paths = [
    "/api/doc-studio/templates",
    "/api/settings/doc-studio",
    "/api/projects/p1/doc-studio/drafts",
    "/api/projects/p1/doc-studio/drafts/d1/turns",
    "/api/projects/p1/doc-studio/drafts/d1/finalize",
    "/api/projects/p1/doc-studio/drafts/d1",
  ];
  for (const path of paths) {
    const res = await handleDocStudioRequest(new Request(`http://127.0.0.1:1${path}`));
    equal(res?.status, 401, path);
  }
});
