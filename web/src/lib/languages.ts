/**
 * Daftar bahasa untuk editor.
 *
 * Implementasi + daftar id tinggal di `./monaco-languages` supaya pemetaan
 * ekstensi, daftar id yang diregistrasi, dan import di `./monaco` tidak drift.
 * Modul ini dipertahankan sebagai entry point yang sudah dipakai komponen.
 */
export {
  LANGUAGE_BY_EXTENSION,
  LANGUAGE_IDS_WITHOUT_DEFINITION,
  MONACO_LANGUAGE_IDS,
  PLAINTEXT_LANGUAGE,
  languageForPath,
  type MonacoLanguageId,
} from "./monaco-languages";
