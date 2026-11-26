/** Helper murni Doc Studio (dipakai panel + test). */

export interface DocStudioTurn {
  role: "user" | "assistant";
  content: string;
}

/** Tambah balasan AI ke transkrip lokal (optimistic, sebelum server menjawab). */
export function appendTurn(transcript: DocStudioTurn[], turn: DocStudioTurn): DocStudioTurn[] {
  const last = transcript[transcript.length - 1];
  if (last && last.role === turn.role && last.content === turn.content) return transcript;
  return [...transcript, turn];
}

/** Boleh generate dokumen? AI menandai `ready`, tapi user selalu bisa memaksa. */
export function canFinalize(input: {
  status: string;
  transcript: DocStudioTurn[];
  busy?: boolean;
}): boolean {
  if (input.busy) return false;
  if (input.status === "saved") return false;
  if (input.status === "ready") return true;
  return input.transcript.some((turn) => turn.role === "user");
}

/** Buang baris kosong berlebih agar bubble balasan AI tetap ringkas. */
export function compactText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function transcriptLength(transcript: DocStudioTurn[]): number {
  return transcript.filter((turn) => turn.role === "user").length;
}

/**
 * Kode error API Doc Studio → key i18n.
 *
 * Kode mentah (`llm_not_configured`, …) tidak informatif bagi user, jadi panel
 * menampilkan pesan yang menyebut langkah perbaikannya. Kode yang tidak dipetakan
 * tetap ditampilkan apa adanya supaya bug baru tidak tersembunyi.
 */
const DOC_STUDIO_ERROR_KEYS: Record<string, string> = {
  llm_not_configured: "docStudio.error.llmNotConfigured",
  document_workspace_missing: "docStudio.error.workspaceMissing",
  project_not_found: "docStudio.error.projectNotFound",
  template_not_found: "docStudio.error.templateNotFound",
  draft_not_found: "docStudio.error.draftNotFound",
  draft_already_saved: "docStudio.error.draftAlreadySaved",
  unauthorized: "docStudio.error.unauthorized",
  invalid_input: "docStudio.error.invalidInput",
};

export function docStudioErrorKey(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  return DOC_STUDIO_ERROR_KEYS[trimmed] ?? null;
}
