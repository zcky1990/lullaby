import {
  ClickUpConfig,
  JiraConfig,
  LocalTicketSyncInput,
  LocalTicketUpdateInput,
  type TicketProvider,
} from "../../config/schema.ts";
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
import {
  createTicket as createClickUpTicket,
  getTicket as getClickUpTicket,
  listTickets as listClickUpTickets,
  transitionTicket as transitionClickUpTicket,
} from "../../integrations/clickup.ts";
import {
  createTicket,
  getTicket,
  listTickets,
  transitionTicket,
} from "../../integrations/jira.ts";

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

function localTicketUrl(
  row: LocalTicketRow,
  bases?: { jira?: string; clickup?: string },
): string {
  if (!row.jira_key) return "";
  if (row.sync_provider === "clickup") {
    const base = (bases?.clickup ?? "https://app.clickup.com").replace(/\/+$/, "");
    return `${base}/t/${row.jira_key}`;
  }
  if (!bases?.jira) return "";
  return `${bases.jira.replace(/\/+$/, "")}/browse/${row.jira_key}`;
}

function localTicketSummary(
  row: LocalTicketRow,
  bases?: { jira?: string; clickup?: string },
) {
  return {
    key: localTicketKey(row),
    summary: row.title,
    status: row.status,
    assignee: row.assignee ?? undefined,
    priority: row.priority ?? undefined,
    url: localTicketUrl(row, bases),
    source: "local" as const,
    localId: row.id,
    syncStatus: row.sync_status,
    syncProvider: row.sync_provider ?? undefined,
    syncError: row.sync_error ?? undefined,
  };
}

function localTicketDetail(
  row: LocalTicketRow,
  bases?: { jira?: string; clickup?: string },
) {
  return {
    ...localTicketSummary(row, bases),
    type: row.type,
    created: row.created_at,
    updated: row.updated_at,
    labels: localLabels(row),
    description: row.description,
  };
}

async function readIntegrationConfig(
  projectId: string,
  kind: "jira" | "clickup",
): Promise<Record<string, unknown> | null> {
  const row = await getIntegration(projectId, kind);
  if (!row) return null;
  try {
    return JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function ticketUrlBases(
  projectId: string,
): Promise<{ jira?: string; clickup?: string }> {
  const bases: { jira?: string; clickup?: string } = {};
  const jiraRaw = await readIntegrationConfig(projectId, "jira");
  if (jiraRaw) {
    const parsed = JiraConfig.safeParse(jiraRaw);
    if (parsed.success) bases.jira = parsed.data.baseUrl;
  }
  const clickupRaw = await readIntegrationConfig(projectId, "clickup");
  if (clickupRaw) {
    const parsed = ClickUpConfig.safeParse(clickupRaw);
    if (parsed.success) bases.clickup = parsed.data.baseUrl ?? "https://app.clickup.com";
  }
  return bases;
}

function looksLikeJiraKey(key: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(key);
}

async function resolveTicketProvider(
  projectId: string,
  preferred?: TicketProvider,
  keyHint?: string,
): Promise<TicketProvider | null> {
  if (preferred) return preferred;
  const jira = await readIntegrationConfig(projectId, "jira");
  const clickup = await readIntegrationConfig(projectId, "clickup");
  if (keyHint) {
    if (looksLikeJiraKey(keyHint) && jira) return "jira";
    if (!looksLikeJiraKey(keyHint) && clickup) return "clickup";
  }
  if (jira) return "jira";
  if (clickup) return "clickup";
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listTicketsTool(projectId: string): Promise<string> {
  const locals = await listLocalTickets(projectId);
  const bases = await ticketUrlBases(projectId);
  const providers: TicketProvider[] = [];
  const errors: Record<string, string> = {};
  const remote: Array<Record<string, unknown>> = [];

  const jiraRaw = await readIntegrationConfig(projectId, "jira");
  if (jiraRaw) {
    providers.push("jira");
    const parsed = JiraConfig.safeParse(jiraRaw);
    if (!parsed.success) {
      errors.jira = "Konfigurasi Jira tidak valid.";
    } else {
      try {
        const tickets = await listTickets(parsed.data);
        remote.push(...tickets.map((ticket) => ({ ...ticket, source: "jira" as const })));
      } catch (error) {
        errors.jira = (error as Error).message;
      }
    }
  }

  const clickupRaw = await readIntegrationConfig(projectId, "clickup");
  if (clickupRaw) {
    providers.push("clickup");
    const parsed = ClickUpConfig.safeParse(clickupRaw);
    if (!parsed.success) {
      errors.clickup = "Konfigurasi ClickUp tidak valid.";
    } else {
      try {
        remote.push(
          ...await listClickUpTickets(parsed.data) as unknown as Array<Record<string, unknown>>,
        );
      } catch (error) {
        errors.clickup = (error as Error).message;
      }
    }
  }

  const remoteKeys = new Set(remote.map((ticket) => String(ticket.key ?? "")));
  const pending = locals
    .filter((row) => !row.jira_key || !remoteKeys.has(row.jira_key))
    .map((row) => localTicketSummary(row, bases));

  return clip({
    configured: providers.length > 0,
    providers,
    errors: Object.keys(errors).length ? errors : undefined,
    tickets: [...pending, ...remote],
    note: providers.length === 0 ? "Integrasi Jira/ClickUp belum dikonfigurasi." : undefined,
  });
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
  if (!idOrKey) return "Error: id (local UUID) atau key (Jira/ClickUp) wajib.";

  const bases = await ticketUrlBases(projectId);
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
    return clip({ ticket: localTicketDetail(ticket, bases) });
  }

  const preferred = args.source === "clickup" || args.source === "jira"
    ? args.source
    : undefined;
  const provider = await resolveTicketProvider(projectId, preferred, idOrKey);
  if (!provider) return "Error: Integrasi Jira/ClickUp belum dikonfigurasi.";

  try {
    if (provider === "clickup") {
      const raw = await readIntegrationConfig(projectId, "clickup");
      const parsed = ClickUpConfig.safeParse(raw ?? {});
      if (!parsed.success) return "Error: Konfigurasi ClickUp tidak valid.";
      return clip({ ticket: await getClickUpTicket(parsed.data, idOrKey) });
    }
    const raw = await readIntegrationConfig(projectId, "jira");
    const parsed = JiraConfig.safeParse(raw ?? {});
    if (!parsed.success) return "Error: Konfigurasi Jira tidak valid.";
    return clip({ ticket: { ...await getTicket(parsed.data, idOrKey), source: "jira" } });
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
  return clip({
    ticket: updated ? localTicketDetail(updated, await ticketUrlBases(projectId)) : null,
  });
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
    return "Error: tiket sudah synced ke board remote; hapus lewat Jira/ClickUp.";
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
  const bases = await ticketUrlBases(projectId);
  if (ticket.jira_key) {
    return clip({ ticket: localTicketDetail(ticket, bases), note: "Sudah tersinkron." });
  }

  const syncParsed = LocalTicketSyncInput.safeParse({
    provider: args.provider === "jira" || args.provider === "clickup" ? args.provider : undefined,
  });
  if (!syncParsed.success) {
    return `Error: ${syncParsed.error.issues[0]?.message ?? "input tidak valid"}`;
  }
  const provider = await resolveTicketProvider(projectId, syncParsed.data.provider);
  if (!provider) return "Error: Integrasi Jira/ClickUp belum dikonfigurasi.";

  try {
    if (provider === "clickup") {
      const raw = await readIntegrationConfig(projectId, "clickup");
      const parsed = ClickUpConfig.safeParse(raw ?? {});
      if (!parsed.success) return "Error: Konfigurasi ClickUp tidak valid.";
      const created = await createClickUpTicket(parsed.data, {
        summary: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority ?? undefined,
        labels: localLabels(ticket),
      });
      await markLocalTicketSynced(ticket.id, created.key, "clickup");
    } else {
      const raw = await readIntegrationConfig(projectId, "jira");
      const parsed = JiraConfig.safeParse(raw ?? {});
      if (!parsed.success) return "Error: Konfigurasi Jira tidak valid.";
      const created = await createTicket(parsed.data, {
        summary: ticket.title,
        description: ticket.description,
        type: ticket.type,
        priority: ticket.priority ?? undefined,
        labels: localLabels(ticket),
      });
      await markLocalTicketSynced(ticket.id, created.key, "jira");
    }
    const updated = (await getLocalTicket(ticket.id))!;
    return clip({ ticket: localTicketDetail(updated, await ticketUrlBases(projectId)) });
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
  if (!key) return "Error: key tiket remote wajib.";
  if (!status) return "Error: status wajib.";
  const preferred = args.source === "clickup" || args.source === "jira"
    ? args.source
    : undefined;
  const provider = await resolveTicketProvider(projectId, preferred, key);
  if (!provider) return "Error: Integrasi Jira/ClickUp belum dikonfigurasi.";

  try {
    if (provider === "clickup") {
      const raw = await readIntegrationConfig(projectId, "clickup");
      const parsed = ClickUpConfig.safeParse(raw ?? {});
      if (!parsed.success) return "Error: Konfigurasi ClickUp tidak valid.";
      await transitionClickUpTicket(parsed.data, key, status);
    } else {
      const raw = await readIntegrationConfig(projectId, "jira");
      const parsed = JiraConfig.safeParse(raw ?? {});
      if (!parsed.success) return "Error: Konfigurasi Jira tidak valid.";
      await transitionTicket(parsed.data, key, status);
    }
    return clip({ ok: true, key, status, provider });
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
