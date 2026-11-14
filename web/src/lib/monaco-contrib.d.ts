/**
 * Beberapa kontribusi editor Monaco 0.57 dikirim sebagai modul JS tanpa
 * deklarasi tipe (hanya `features/*` dan `languages/*` yang punya `.d.ts`).
 *
 * Import di `./monaco.ts` murni efek samping (registrasi fitur), jadi cukup
 * dideklarasikan sebagai modul tanpa tipe — jangan dipakai untuk mengambil nilai.
 */
declare module "monaco-editor/editor/browser/*";
declare module "monaco-editor/editor/common/*";
declare module "monaco-editor/editor/contrib/*";
