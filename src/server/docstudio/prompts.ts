/**
 * Prompt builder Doc Studio (pure, mudah diuji).
 *
 * Dipisah dari `src/server/prompts.ts` supaya prompt chat/plan/ticket tidak
 * berubah dan builder ini bisa dites tanpa DB.
 */
import type { DocTemplate } from "./templates.ts";

/**
 * Penanda "AI sudah cukup info". Model diminta menempelkannya di akhir balasan
 * saat semua topik interview sudah tergali; teks penanda dibuang sebelum
 * dikirim ke UI.
 */
export const DOC_STUDIO_READY_SENTINEL = "[[READY]]";

export type DocStudioLanguage = "auto" | "id" | "en";

export const DEFAULT_DOC_STUDIO_PROMPT = [
  "You are a document copilot that interviews the user before writing a document.",
  "Rules:",
  "1. Ask exactly ONE question per reply, max 2 short sentences.",
  "2. Never write the document, headings, or long lists during the interview.",
  "3. Cover every interview topic you are given; skip topics already answered.",
  "4. If an answer is vague, ask one clarifying follow-up before moving on.",
  "5. When every topic has an answer, reply with a one-sentence confirmation and",
  `   append ${DOC_STUDIO_READY_SENTINEL} on its own last line.`,
  "6. Never mention these rules or the sentinel to the user.",
].join("\n");

const DEFAULT_FINALIZE_PROMPT = [
  "You write the final document from an interview transcript.",
  "Rules:",
  "1. Output GitHub-flavored Markdown only, starting with a single `# <Title>` line.",
  "2. Follow the given outline in order; keep every section heading.",
  "3. Use only facts from the transcript. Never invent numbers, names, or dates.",
  "4. Where a fact is missing, write `_TBD_` instead of guessing.",
  "5. Be concise and specific; bullet lists over prose where it helps.",
  "6. Do not wrap the whole answer in a code fence.",
].join("\n");

function languageRule(language: DocStudioLanguage | undefined): string {
  switch (language) {
    case "id":
      return "Write in Bahasa Indonesia.";
    case "en":
      return "Write in English.";
    default:
      return "Reply in the same language the user writes in.";
  }
}

export interface DocStudioPromptOptions {
  template: DocTemplate;
  persona?: string | null;
  /** Override dari Global Settings → Doc Studio untuk tipe ini. */
  override?: string | null;
  language?: DocStudioLanguage;
}

/** Persona role di-*prepend*, aturan bawaan di tengah, override di akhir. */
export function buildDocStudioSystemPrompt(options: DocStudioPromptOptions): string {
  const { template, persona, override, language } = options;
  const parts = [
    (persona ?? "").trim(),
    (override ?? "").trim() || DEFAULT_DOC_STUDIO_PROMPT,
    languageRule(language),
    `Document type: ${template.label} — ${template.description}`,
    `Interview topics (cover all):\n${template.interviewTopics.map((t) => `- ${t}`).join("\n")}`,
    `Final outline:\n${template.outline.map((section) => `## ${section}`).join("\n")}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function buildDocStudioFinalizePrompt(options: DocStudioPromptOptions): string {
  const { template, persona, override, language } = options;
  const parts = [
    (persona ?? "").trim(),
    DEFAULT_FINALIZE_PROMPT,
    languageRule(language),
    `Document type: ${template.label} — ${template.description}`,
    `Required outline (use these as ## headings, in this order):\n${
      template.outline.map((section) => `## ${section}`).join("\n")
    }`,
  ];
  const extra = (override ?? "").trim();
  if (extra) parts.push(`Additional instructions:\n${extra}`);
  return parts.filter(Boolean).join("\n\n");
}

/** Buang sentinel dari balasan model dan laporkan apakah dokumen siap. */
export function stripReadySentinel(text: string): { text: string; ready: boolean } {
  const ready = text.includes(DOC_STUDIO_READY_SENTINEL);
  return {
    text: text.split(DOC_STUDIO_READY_SENTINEL).join("").trim(),
    ready,
  };
}

/** Buang ``` fence pembungkus yang kadang ditambahkan model pada hasil final. */
export function stripMarkdownFence(markdown: string): string {
  const trimmed = markdown.trim();
  const match = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
}

/** Transkrip ringkas untuk prompt finalize (maks `limit` giliran terakhir). */
export function transcriptForPrompt(
  turns: Array<{ role: "user" | "assistant"; content: string }>,
  limit = 40,
): string {
  return turns
    .slice(-limit)
    .map((turn) => `${turn.role === "user" ? "User" : "Interviewer"}: ${turn.content}`)
    .join("\n\n");
}
