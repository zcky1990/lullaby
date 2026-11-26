/**
 * Draft Doc Studio (interview AI sebelum dokumen ditulis).
 *
 * Tabel dibuat lazy di modul ini (pola `chat-tombstones.ts`) supaya `SCHEMA` di
 * `src/db/db.ts` tidak perlu disentuh dan tidak ada migrasi untuk DB lama.
 */
import { getDb } from "./db.ts";

export type DocDraftStatus = "interviewing" | "ready" | "saved";

export interface DocDraftRow {
  id: string;
  project_id: string;
  type_id: string;
  role_id: string | null;
  title: string;
  transcript: string;
  status: string;
  document_path: string | null;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS doc_drafts (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type_id       TEXT NOT NULL,
  role_id       TEXT,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  transcript    TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'interviewing',
  document_path TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_doc_drafts_project ON doc_drafts(project_id, updated_at DESC);
`;

let ready: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      db.exec(SCHEMA);
    })();
  }
  return await ready;
}

export interface CreateDocDraftInput {
  projectId: string;
  typeId: string;
  roleId?: string | null;
  title: string;
  transcript: unknown[];
}

export async function createDocDraft(input: CreateDocDraftInput): Promise<DocDraftRow> {
  await ensureSchema();
  const db = await getDb();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO doc_drafts (id, project_id, type_id, role_id, title, transcript) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    input.projectId,
    input.typeId,
    input.roleId ?? null,
    input.title,
    JSON.stringify(input.transcript ?? []),
  );
  return (await getDocDraft(id))!;
}

export async function getDocDraft(id: string): Promise<DocDraftRow | null> {
  await ensureSchema();
  const db = await getDb();
  const row = db.prepare("SELECT * FROM doc_drafts WHERE id = ?").get(id);
  return (row as DocDraftRow | undefined) ?? null;
}

export async function listDocDrafts(projectId: string): Promise<DocDraftRow[]> {
  await ensureSchema();
  const db = await getDb();
  const rows = db
    .prepare("SELECT * FROM doc_drafts WHERE project_id = ? ORDER BY updated_at DESC")
    .all(projectId);
  return (rows as unknown as DocDraftRow[]) ?? [];
}

export interface UpdateDocDraftInput {
  title?: string;
  transcript?: unknown[];
  status?: DocDraftStatus;
  roleId?: string | null;
  documentPath?: string | null;
}

export async function updateDocDraft(
  id: string,
  patch: UpdateDocDraftInput,
): Promise<DocDraftRow | null> {
  await ensureSchema();
  const existing = await getDocDraft(id);
  if (!existing) return null;
  const db = await getDb();
  db.prepare(
    "UPDATE doc_drafts SET title = ?, transcript = ?, status = ?, role_id = ?, " +
      "document_path = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(
    patch.title ?? existing.title,
    patch.transcript ? JSON.stringify(patch.transcript) : existing.transcript,
    patch.status ?? existing.status,
    patch.roleId === undefined ? existing.role_id : patch.roleId,
    patch.documentPath === undefined ? existing.document_path : patch.documentPath,
    id,
  );
  return await getDocDraft(id);
}

export async function deleteDocDraft(id: string): Promise<void> {
  await ensureSchema();
  const db = await getDb();
  db.prepare("DELETE FROM doc_drafts WHERE id = ?").run(id);
}
