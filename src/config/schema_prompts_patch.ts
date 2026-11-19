import { z } from "zod";
import { PromptsSettingsInput } from "./schema.ts";

/**
 * Payload `PUT /api/settings/prompts`.
 *
 * Extends {@link PromptsSettingsInput} with the prompt used by
 * "generate ticket from document" (tab Document → Generate ticket), so the
 * prompt can be overridden from Global Settings → Prompts (`ticket_prompt`).
 */
export const PromptsSettingsPatchInput = PromptsSettingsInput.extend({
  ticketPrompt: z.string().max(20_000).optional(),
});
export type PromptsSettingsPatchInput = z.infer<typeof PromptsSettingsPatchInput>;
