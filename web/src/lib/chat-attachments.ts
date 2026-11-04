export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200 * 1024;

export const TEXT_FILE =
  /\.(txt|md|markdown|json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|scss|html|xml|yml|yaml|toml|ini|env|rb|py|go|rs|java|kt|swift|php|sh|bash|zsh|sql|csv|log|diff|patch)$/i;

export const SAFE_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

export const FILE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,text/*,.md,.markdown,.json,.jsonc,.ts,.tsx,.js,.jsx,.mjs,.cjs,.css,.scss,.html,.xml,.yml,.yaml,.toml,.ini,.env,.rb,.py,.go,.rs,.java,.kt,.swift,.php,.sh,.bash,.zsh,.sql,.csv,.log,.diff,.patch";

export type AttachmentDraft = {
  id: string;
  name: string;
  type: "image" | "text";
  mime: string;
  data: string;
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

export async function readAttachment(file: File): Promise<AttachmentDraft> {
  const mime = (file.type || "").toLowerCase();
  const isImage = SAFE_IMAGE_MIME.has(mime);
  const isText = mime.startsWith("text/") || TEXT_FILE.test(file.name);
  if (!isImage && !isText) {
    if (mime.startsWith("image/")) {
      throw new Error(`Tipe gambar tidak didukung (pakai PNG/JPEG/GIF/WebP): ${file.name}`);
    }
    throw new Error(`Tipe file tidak didukung: ${file.name}`);
  }
  if (isImage) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Gambar terlalu besar (maks 3 MB): ${file.name}`);
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      type: "image",
      mime,
      data: await readAsDataUrl(file),
    };
  }
  if (file.size > MAX_TEXT_BYTES) {
    throw new Error(`File teks terlalu besar (maks 200 KB): ${file.name}`);
  }
  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: "text",
    mime: file.type || "text/plain",
    data: await file.text(),
  };
}

/** Append text-file bodies into the prompt; images stay as separate attachments. */
export function mergeTextAttachments(prompt: string, attachments: AttachmentDraft[]): {
  text: string;
  images: AttachmentDraft[];
} {
  const texts = attachments.filter((item) => item.type === "text");
  const images = attachments.filter((item) => item.type === "image");
  const suffix = texts
    .map((item) => `\n\n--- ${item.name} ---\n${item.data.slice(0, MAX_TEXT_BYTES)}`)
    .join("");
  const base = prompt.trim();
  const text = base || texts.length
    ? `${base || "Lihat lampiran."}${suffix}`
    : "";
  return { text, images };
}
