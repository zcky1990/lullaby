import { DEFAULT_LOCALE } from "./config";
import type { Locale, MessageDict, Messages, TranslateVars, Translator } from "./types";

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Urutan fallback: dict bahasa aktif → dict bahasa default → key mentah.
 * Key mentah sengaja ditampilkan agar teks yang belum diterjemahkan terlihat
 * saat pengembangan, bukan hilang tanpa jejak.
 */
export function lookupMessage(
  messages: Partial<Messages>,
  locale: Locale,
  key: string,
): string | undefined {
  return messages[locale]?.[key] ?? messages[DEFAULT_LOCALE]?.[key];
}

export function createTranslator(
  messages: Partial<Messages>,
  locale: Locale,
): Translator {
  return (key, vars) => interpolate(lookupMessage(messages, locale, key) ?? key, vars);
}

/** Untuk kode non-komponen (helper/lib) yang butuh teks sekali pakai. */
export function getTranslator(messages: Partial<Messages>, locale: Locale): Translator {
  return createTranslator(messages, locale);
}

/**
 * Bentuk jamak sederhana: `key.one` untuk 1, `key.other` untuk sisanya,
 * dan fallback ke `key` bila variannya belum ada.
 */
export function pluralKey(
  messages: Partial<Messages>,
  locale: Locale,
  key: string,
  count: number,
): string {
  const variant = `${key}.${count === 1 ? "one" : "other"}`;
  return lookupMessage(messages, locale, variant) ? variant : key;
}

export function dictKeys(dict: MessageDict): string[] {
  return Object.keys(dict).sort();
}
