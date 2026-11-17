/**
 * Tipe dasar i18n. Semua teks UI disimpan sebagai dict datar `key -> teks`
 * supaya mudah digabung per domain (`messages/<locale>/<domain>.ts`).
 */

export type Locale = "id" | "en";

export type TranslateVars = Record<string, string | number>;

export type MessageDict = Record<string, string>;

export type Messages = Record<Locale, MessageDict>;

/** `{name}` pada template diganti dengan nilai dari `vars`. */
export type Translator = (key: string, vars?: TranslateVars) => string;

export interface LanguageOption {
  id: Locale;
  label: string;
  hint: string;
}
