export {
  applyDocumentLocale,
  DEFAULT_LOCALE,
  isLocale,
  LANGUAGE_OPTIONS,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  readStoredLocale,
  writeStoredLocale,
} from "./config";
export { I18nProvider, useI18n, type I18nContextValue } from "./I18nProvider";
export { messages, type MessageKey } from "./messages";
export {
  createTranslator,
  dictKeys,
  getTranslator,
  interpolate,
  lookupMessage,
  pluralKey,
} from "./translate";
export type {
  LanguageOption,
  Locale,
  MessageDict,
  Messages,
  TranslateVars,
  Translator,
} from "./types";
