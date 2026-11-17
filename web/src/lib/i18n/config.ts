import type { LanguageOption, Locale } from "./types";

/** Bahasa default aplikasi (UI aslinya berbahasa Indonesia). */
export const DEFAULT_LOCALE: Locale = "id";

export const LOCALE_STORAGE_KEY = "rnd.language:v1";

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: "id", label: "Bahasa Indonesia", hint: "id" },
  { id: "en", label: "English", hint: "en" },
];

const LOCALES: Locale[] = LANGUAGE_OPTIONS.map((option) => option.id);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as string[]).includes(value);
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Dipakai sebelum React mount dan saat backend belum menjawab. */
export function readStoredLocale(): Locale {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // localStorage bisa diblokir; preferensi server tetap jadi sumber utama
  }
}

export function applyDocumentLocale(locale: Locale): void {
  try {
    document.documentElement.lang = locale;
  } catch {
    // environment tanpa DOM (test)
  }
}
