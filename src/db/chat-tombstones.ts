/**
 * Tombstone untuk chat history Cursor.
 *
 * Sesi Cursor bukan data milik aplikasi: `GET /api/projects/:id/chat/sessions`
 * me-mirror agent dari SDK Cursor ke tabel `chat_sessions` setiap kali daftar
 * sesi diminta (lihat `importCursorAgentsIntoSessions` di
 * `src/server/router.ts`). Jadi menghapus sesi hanya menghapus baris lokal dan
 * agent yang sama di-import ulang pada refresh berikutnya — inilah sebab "hapus
 * chat history Cursor" terlihat gagal.
 *
 * Solusi: tabel `hidden_cursor_agents` + tiga trigger SQLite (dipasang di
 * bootstrap lewat `ensureChatSessionTombstones`, idempotent).
 *
 * - `chat_sessions_hide_cursor_agent` (AFTER DELETE): catat `cursor_agent_id`
 *   sesi yang dihapus.
 * - `chat_sessions_skip_hidden_cursor_agent` (BEFORE INSERT): insert sesi hasil
 *   mirroring untuk agent yang sudah dihapus diabaikan (`RAISE(IGNORE)`), jadi
 *   `upsertImportedCursorSession` tidak membuat ulang sesi tersebut.
 * - `chat_sessions_unhide_cursor_agent` (AFTER UPDATE OF cursor_agent_id):
 *   hapus tombstone saat sebuah sesi memakai agent tersebut lagi (resume), agar
 *   agent yang dipakai ulang tidak tersembunyi selamanya.
 *
 * Catatan/limitasi:
 * - Trigger tidak bisa membedakan insert dari mirror dengan insert dari restore
 *   backup, jadi sesi Cursor hasil restore untuk agent yang pernah dihapus ikut
 *   diabaikan. Pakai `unhideCursorAgent()` untuk memunculkannya lagi (agent
 *   yang dipakai ulang otomatis di-unhide lewat trigger ketiga).
 * - Tabel tombstone sengaja tanpa FK ke `projects`: baris yatim (project sudah
 *   dihapus) dibersihkan saat `ensureChatSessionTombstones` dijalankan.
 */
import { getDb } from "./db.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hidden_cursor_agents (
  project_id      TEXT NOT NULL,
  cursor_agent_id TEXT NOT NULL,
  hidden_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, cursor_agent_id)
);

CREATE TRIGGER IF NOT EXISTS chat_sessions_hide_cursor_agent
AFTER DELETE ON chat_sessions
WHEN IFNULL(OLD.cursor_agent_id, '') <> ''
BEGIN
  INSERT OR REPLACE INTO hidden_cursor_agents (project_id, cursor_agent_id, hidden_at)
  VALUES (OLD.project_id, OLD.cursor_agent_id, datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS chat_sessions_skip_hidden_cursor_agent
BEFORE INSERT ON chat_sessions
WHEN IFNULL(NEW.cursor_agent_id, '') <> ''
 AND EXISTS (
   SELECT 1 FROM hidden_cursor_agents
   WHERE project_id = NEW.project_id AND cursor_agent_id = NEW.cursor_agent_id
 )
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS chat_sessions_unhide_cursor_agent
AFTER UPDATE OF cursor_agent_id ON chat_sessions
WHEN IFNULL(NEW.cursor_agent_id, '') <> ''
BEGIN
  DELETE FROM hidden_cursor_agents
  WHERE project_id = NEW.project_id AND cursor_agent_id = NEW.cursor_agent_id;
END;
`;

const PRUNE_SQL = "DELETE FROM hidden_cursor_agents " +
  "WHERE project_id NOT IN (SELECT id FROM projects)";
const LIST_SQL = "SELECT cursor_agent_id FROM hidden_cursor_agents WHERE project_id = ?";
const UNHIDE_SQL = "DELETE FROM hidden_cursor_agents WHERE project_id = ? AND cursor_agent_id = ?";

/** Pasang tabel tombstone + trigger (idempotent). Dipanggil saat bootstrap. */
export async function ensureChatSessionTombstones(): Promise<void> {
  const db = await getDb();
  db.exec(SCHEMA);
  db.prepare(PRUNE_SQL).run();
}

/** `cursor_agent_id` yang sudah dihapus user untuk project ini. */
export async function listHiddenCursorAgents(projectId: string): Promise<string[]> {
  const db = await getDb();
  const rows = db.prepare(LIST_SQL).all(projectId);
  return rows.map((row) => String(row.cursor_agent_id));
}

/** Tampilkan lagi satu agent Cursor di riwayat chat (batalkan tombstone). */
export async function unhideCursorAgent(
  projectId: string,
  cursorAgentId: string,
): Promise<void> {
  const db = await getDb();
  db.prepare(UNHIDE_SQL).run(projectId, cursorAgentId);
}
