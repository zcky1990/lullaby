import { JiraConfig, LocalTicketUpdateInput } from "../../config/schema.ts";
import {
  deleteLocalTicket,
  getIntegration,
  getLocalTicket,
  listLocalTickets,
  markLocalTicketSynced,
  markLocalTicketSyncError,
  type LocalTicketRow,
  updateLocalTicket,
} from "../../db/db.ts";
import { createTicket, getTicket, listTickets, transitionTicket } from "../../integrations/jira.ts";

const MAX_RESULT = 60_000;

function clip(value: unknown): string {
  return JSON.stringify(value).slice(0, MAX_RESULT);
}

function localLabels(row: LocalTicketRow): string[] {
  try {
    const parsed = JSON.parse(row.labels);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function localTicketKey(row: LocalTicketRow): string {
  return row.jira_key ?? `LOCAL-${row.id.slice(0, 6).toUpperCase()}`;
}

function localTicketUrl(row: LocalTicketRow, baseUrl?: string): string {
  if (!row.jira_key || !baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/browse/${row.jira_key}`;
}

function localTicketSummary(row: LocalTicketRow, baseUrl?: string) {
  return {
    key: localTicketKey(row),
    summary: row.title,
    status: row.status,
    assignee: row.assignee ?? undefined,
    priority: row.priority ?? undefined,
    url: localTicketUrl(row, baseUrl),
    source: "local" as const,
    localId: row.id,
    syncStatus: row.sync_status,
    syncError: row.sync_error ?? undefined,
  };
}

function localTicketDetail(row: LocalTicketRow, baseUrl?: string) {
  return {
    ...localTicketSummary(row, baseUrl),
    type: row.type,
    created: row.created_at,
    updated: row.updated_at,
    labels: localLabels(row),
    description: row.description,
  };
}

async function jiraConfig(
  projectId: string,
): Promise<{ ok: true; config: ReturnType<typeof JiraConfig.parse> } | { ok: false; error: string }> {
  const row = await getIntegration(projectId, "jira");
  if (!row) return { ok: false, error: "Integrasi Jira belum dikonfigurasi." };
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const parsed = JiraConfig.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Konfigurasi Jira tidak valid." };
  return { ok: true, config: parsed.data };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listTicketsTool(projectId: string): Promise<string> {
  const locals = await listLocalTickets(projectId);
  const jira = await jiraConfig(projectId);
  if (!jira.ok) {
    return clip({
      configured: false,
      tickets: locals.map((row) => localTicketSummary(row)),
      note: jira.error,
    });
  }
  try {
    const remote = await listTickets(jira.config);
    const remoteKeys = new Set(remote.map((ticket) => ticket.key));
    const pending = locals
      .filter((row) => !row.jira_key || !remoteKeys.has(row.jira_key))
      .map((row) => localTicketSummary(row, jira.config.baseUrl));
    return clip({ configured: true, tickets: [...pending, ...remote] });
  } catch (error) {
    return clip({
      configured: true,
      error: (error as Error).message,
      tickets: locals.map((row) => localTicketSummary(row, jira.config.baseUrl)),
    });
  }
}

export async function getTicketTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const idOrKey = typeof args.id === "string" && args.id.trim()
    ? args.id.trim()
    : typeof args.key === "string"
    ? args.key.trim()
    : "";
  if (!idOrKey) return "Error: id (local UUID) atau key (Jira) wajib.";

  if (UUID_RE.test(idOrKey) || idOrKey.toUpperCase().startsWith("LOCAL-")) {
    let ticket = UUID_RE.test(idOrKey) ? await getLocalTicket(idOrKey) : null;
    if (!ticket && idOrKey.toUpperCase().startsWith("LOCAL-")) {
      const prefix = idOrKey.slice(6).toLowerCase();
      const locals = await listLocalTickets(projectId);
      ticket = locals.find((row) => row.id.toLowerCase().startsWith(prefix)) ?? null;
    }
    if (!ticket || ticket.project_id !== projectId) {
      return "Error: tiket lokal tidak ditemukan.";
    }
    const jira = await jiraConfig(projectId);
    return clip({
      ticket: localTicketDetail(ticket, jira.ok ? jira.config.baseUrl : undefined),
    });
  }

  const jira = await jiraConfig(projectId);
  if (!jira.ok) return jira.error;
  try {
    return clip({ ticket: await getTicket(jira.config, idOrKey) });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

export async function updateTicketTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return "Error: id tiket lokal wajib.";
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return "Error: tiket lokal tidak ditemukan.";
  }
  const patch: Record<string, unknown> = {};
  if (typeof args.title === "string") patch.title = args.title;
  if (typeof args.description === "string") patch.description = args.description;
  if (typeof args.status === "string") patch.status = args.status;
  if (args.priority === null || args.priority === "") patch.priority = null;
  else if (typeof args.priority === "string") patch.priority = args.priority;
  if (typeof args.type === "string") patch.type = args.type;
  if (typeof args.assignee === "string") patch.assignee = args.assignee;
  if (Array.isArray(args.labels)) patch.labels = args.labels;
  const parsed = LocalTicketUpdateInput.safeParse(patch);
  if (!parsed.success) {
    return `Error: ${parsed.error.issues[0]?.message ?? "input tidak valid"}`;
  }
  const updated = await updateLocalTicket(id, parsed.data);
  return clip({ ticket: updated ? localTicketDetail(updated) : null });
}

export async function deleteTicketTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return "Error: id tiket lokal wajib.";
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return "Error: tiket lokal tidak ditemukan.";
  }
  if (ticket.jira_key) {
    return "Error: tiket sudah synced ke Jira; hapus lewat Jira.";
  }
  await deleteLocalTicket(id);
  return clip({ ok: true, deleted: id });
}

export async function syncTicketTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return "Error: id tiket lokal wajib.";
  const ticket = await getLocalTicket(id);
  if (!ticket || ticket.project_id !== projectId) {
    return "Error: tiket lokal tidak ditemukan.";
  }
  if (ticket.jira_key) {
    return clip({ ticket: localTicketDetail(ticket), note: "Sudah tersinkron." });
  }
  const jira = await jiraConfig(projectId);
  if (!jira.ok) return jira.error;
  try {
    const created = await createTicket(jira.config, {
      summary: ticket.title,
      description: ticket.description,
      type: ticket.type,
      priority: ticket.priority ?? undefined,
      labels: localLabels(ticket),
    });
    await markLocalTicketSynced(ticket.id, created.key);
    const updated = (await getLocalTicket(ticket.id))!;
    return clip({ ticket: localTicketDetail(updated, jira.config.baseUrl) });
  } catch (error) {
    const message = (error as Error).message;
    await markLocalTicketSyncError(ticket.id, message);
    return `Error: ${message}`;
  }
}

export async function transitionTicketTool(
  projectId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const key = typeof args.key === "string" ? args.key.trim() : "";
  const status = typeof args.status === "string" ? args.status.trim() : "";
  if (!key) return "Error: key Jira wajib.";
  if (!status) return "Error: status wajib.";
  const jira = await jiraConfig(projectId);
  if (!jira.ok) return jira.error;
  try {
    await transitionTicket(jira.config, key, status);
    return clip({ ok: true, key, status });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
