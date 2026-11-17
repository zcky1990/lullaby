import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import {
  applyDocumentLocale,
  DEFAULT_LOCALE,
  normalizeLocale,
  readStoredLocale,
  writeStoredLocale,
} from "./config";
import { messages } from "./messages";
import { createTranslator } from "./translate";
import type { Locale, Translator } from "./types";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
}

const fallbackTranslator = createTranslator(messages, DEFAULT_LOCALE);

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: fallbackTranslator,
});

/**
 * Bahasa UI disimpan sebagai preferensi global (`app_settings.ui_preferences`
 * → `language`). localStorage dipakai sebagai cache supaya teks pertama yang
 * tampil sudah memakai bahasa pilihan pengguna, bukan default.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setLocale = useCallback((next: Locale) => {
    const value = normalizeLocale(next);
    setLocaleState(value);
    writeStoredLocale(value);
    if (pendingSave.current) clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => {
      void api.saveUiPreferences({ language: value }).catch(() => {
        // localStorage tetap menyimpan pilihan terakhir
      });
    }, 150);
  }, []);

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    api
      .getUiPreferences()
      .then(({ preferences }) => {
        if (cancelled) return;
        if (preferences.language) {
          const stored = normalizeLocale(preferences.language);
          setLocaleState(stored);
          writeStoredLocale(stored);
          return;
        }
        void api.saveUiPreferences({ language: readStoredLocale() }).catch(() => {});
      })
      .catch(() => {
        // backend belum siap; pakai cache localStorage
      });
    return () => {
      cancelled = true;
      if (pendingSave.current) clearTimeout(pendingSave.current);
    };
  }, []);

  const t = useMemo(() => createTranslator(messages, locale), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
