import { z } from "zod";

/**
 * Schema payload menu Doc Studio (dokumen terpandu AI).
 *
 * File terpisah dari `src/config/schema.ts` supaya schema lama tetap stabil
 * (pola yang sama dengan `schema_prompts_patch.ts`).
 */

export const DocStudioLanguageInput = z.enum(["auto", "id", "en"]);
export type DocStudioLanguageInput = z.infer<typeof DocStudioLanguageInput>;

/** Override per tipe dokumen: role + prompt interview. */
export const DocStudioTypeConfigInput = z
  .object({
    roleId: z.string().trim().max(80).nullable().optional(),
    prompt: z.string().max(20_000).optional(),
  })
  .strict();
export type DocStudioTypeConfigInput = z.infer<typeof DocStudioTypeConfigInput>;

export const MAX_DOC_STUDIO_CUSTOM_TYPES = 20;

export const DocStudioTemplateInput = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i, { message: "id: huruf/angka/-/_ saja" }),
    label: z.string().trim().min(1).max(40),
    description: z.string().trim().max(200).default(""),
    outline: z.array(z.string().trim().min(1).max(120)).min(2).max(30),
    interviewTopics: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  })
  .strict();
export type DocStudioTemplateInput = z.infer<typeof DocStudioTemplateInput>;

/**
 * `PUT /api/settings/doc-studio`.
 * Semua field opsional: field yang tidak dikirim tidak menimpa nilai tersimpan.
 */
export const DocStudioConfigInput = z
  .object({
    defaultRoleId: z.string().trim().max(80).nullable().optional(),
    defaultProviderId: z.string().trim().max(80).nullable().optional(),
    language: DocStudioLanguageInput.optional(),
    types: z.record(z.string().trim().min(1).max(64), DocStudioTypeConfigInput).optional(),
    customTypes: z.array(DocStudioTemplateInput).max(MAX_DOC_STUDIO_CUSTOM_TYPES).optional(),
  })
  .strict();
export type DocStudioConfigInput = z.infer<typeof DocStudioConfigInput>;

export const DocStudioDraftInput = z
  .object({
    typeId: z.string().trim().min(1).max(64),
    roleId: z.string().trim().max(80).nullable().optional(),
  })
  .strict();
export type DocStudioDraftInput = z.infer<typeof DocStudioDraftInput>;

export const DocStudioTurnInput = z
  .object({
    message: z.string().trim().min(1).max(8_000),
  })
  .strict();
export type DocStudioTurnInput = z.infer<typeof DocStudioTurnInput>;

export const DocStudioFinalizeInput = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type DocStudioFinalizeInput = z.infer<typeof DocStudioFinalizeInput>;
