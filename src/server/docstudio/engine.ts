/**
 * Mesin interview + finalize Doc Studio.
 *
 * Non-streaming (`complete()` di `src/server/chat/llm.ts`) dan tanpa tool: satu
 * panggilan LLM per giliran, jadi tidak menyentuh loop agent chat.
 */
import type { LlmProviderRow } from "../../db/db.ts";
import { complete } from "../chat/llm.ts";
import type { ChatTurn } from "../chat/types.ts";
import {
  buildDocStudioFinalizePrompt,
  buildDocStudioSystemPrompt,
  stripMarkdownFence,
  stripReadySentinel,
  transcriptForPrompt,
  type DocStudioLanguage,
} from "./prompts.ts";
import type { DocTemplate } from "./templates.ts";

export interface DocStudioTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DocStudioContext {
  provider: LlmProviderRow;
  template: DocTemplate;
  persona?: string | null;
  promptOverride?: string | null;
  language?: DocStudioLanguage;
}

/** Transkrip yang dikirim ke model dipangkas agar konteks tidak membengkak. */
const MAX_CONTEXT_TURNS = 24;

function contextTurns(transcript: DocStudioTurn[]): DocStudioTurn[] {
  return transcript.slice(-MAX_CONTEXT_TURNS).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, 8_000),
  }));
}

function toChatTurns(ctx: DocStudioContext, transcript: DocStudioTurn[]): ChatTurn[] {
  return [
    {
      role: "system",
      content: buildDocStudioSystemPrompt({
        template: ctx.template,
        persona: ctx.persona,
        override: ctx.promptOverride,
        language: ctx.language,
      }),
    },
    ...contextTurns(transcript),
  ];
}

/**
 * Satu giliran interview.
 *
 * `userMessage` kosong dipakai untuk pertanyaan pembuka (memory: transcript
 * kosong). Balasan dikembalikan tanpa sentinel + flag `ready`.
 */
export async function docStudioInterview(
  ctx: DocStudioContext,
  transcript: DocStudioTurn[],
  userMessage?: string,
): Promise<{ reply: string; ready: boolean; transcript: DocStudioTurn[] }> {
  const next: DocStudioTurn[] = [...transcript];
  if (userMessage?.trim()) {
    next.push({ role: "user", content: userMessage.trim().slice(0, 8_000) });
  }
  const turns = toChatTurns(ctx, next);
  if (!next.length) {
    turns.push({
      role: "user",
      content:
        `Start the interview for a ${ctx.template.label}. Ask your first question now.`,
    });
  }
  const result = await complete(ctx.provider, turns, [], 0.4, 1_024);
  const { text, ready } = stripReadySentinel(result.text);
  const reply = text || "Bisa ceritakan lebih detail?";
  return {
    reply,
    ready,
    transcript: [...next, { role: "assistant", content: reply }],
  };
}

export interface DocStudioFinalizeResult {
  title: string;
  markdown: string;
}

function deriveTitle(markdown: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  if (heading) return heading.slice(0, 200);
  return fallback.slice(0, 200) || "Dokumen";
}

/** Satu panggilan LLM: transkrip → markdown final sesuai outline tipe dokumen. */
export async function docStudioFinalize(
  ctx: DocStudioContext,
  transcript: DocStudioTurn[],
): Promise<DocStudioFinalizeResult> {
  const answered = transcript.filter((turn) => turn.role === "user");
  const body = transcriptForPrompt(transcript.length ? transcript : [], 40);
  const turns: ChatTurn[] = [
    {
      role: "system",
      content: buildDocStudioFinalizePrompt({
        template: ctx.template,
        persona: ctx.persona,
        override: ctx.promptOverride,
        language: ctx.language,
      }),
    },
    {
      role: "user",
      content: answered.length
        ? `Interview transcript:\n\n${body}\n\nWrite the final ${ctx.template.label} document now.`
        : `No interview answers were collected. Write a ${ctx.template.label} skeleton with ` +
          `_TBD_ in every section.`,
    },
  ];
  const result = await complete(ctx.provider, turns, [], 0.3, 8_192);
  const markdown = stripMarkdownFence(stripReadySentinel(result.text).text);
  const title = deriveTitle(markdown, `${ctx.template.label} document`);
  const body2 = /^#\s+/m.test(markdown) ? markdown : `# ${title}\n\n${markdown}`;
  return { title, markdown: body2 };
}
