import type { Messages } from "./types";
import { en } from "./en";
import { id } from "./id";

/** Semua kamus yang tersedia, digabung dari domain di `messages/<locale>/`. */
export const messages: Messages = { en, id };

/** Union key yang sudah diterjemahkan (dipakai untuk autocomplete + test). */
export type MessageKey = keyof typeof en;
