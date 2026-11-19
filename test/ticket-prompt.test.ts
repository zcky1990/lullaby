import { equal } from "node:assert/strict";
import { PromptsSettingsPatchInput } from "../src/config/schema_prompts_patch.ts";

Deno.test("prompts: payload lama tanpa ticketPrompt tetap valid", () => {
  const parsed = PromptsSettingsPatchInput.parse({
    systemPrompt: "build prompt",
    planPrompt: "plan prompt",
  });
  equal(parsed.ticketPrompt, undefined);
});

Deno.test("prompts: ticketPrompt diterima dan tidak di-trim paksa", () => {
  const parsed = PromptsSettingsPatchInput.parse({
    systemPrompt: "build prompt",
    planPrompt: "plan prompt",
    ticketPrompt: "Buat tiket dalam bahasa Indonesia dengan acceptance criteria.",
  });
  equal(parsed.ticketPrompt, "Buat tiket dalam bahasa Indonesia dengan acceptance criteria.");
});

Deno.test("prompts: ticketPrompt melebihi 20.000 karakter ditolak", () => {
  const parsed = PromptsSettingsPatchInput.safeParse({
    systemPrompt: "build prompt",
    planPrompt: "plan prompt",
    ticketPrompt: "x".repeat(20_001),
  });
  equal(parsed.success, false);
});
