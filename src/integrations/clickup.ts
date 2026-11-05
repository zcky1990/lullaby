import type { ClickUpConfig } from "../config/schema.ts";
import { htmlToPlainText } from "../core/html.ts";
import type { TicketDetail, TicketSummary } from "./jira.ts";
import { request, type TestResult, truncate } from "./http.ts";

const API_BASE = "https://api.clickup.com/api/v2";

function apiRoot(cfg: ClickUpConfig): string {
  return (cfg.apiBase ?? API_BASE).replace(/\/+$/, "");
}

function statusMessage(status: number): string {
  if (status === 401) return "Ditolak (401): token ClickUp tidak valid.";
  if (status === 403) return "Ditolak (403): token tidak punya akses ke resource.";
  if (status === 404) return "Tidak ditemukan (404): periksa team/space/list/task id.";
  if (status === 429) return "Rate limit (429): hormati Retry-After.";
  return `ClickUp merespons HTTP ${status}.`;
}

function authHeaders(cfg: ClickUpConfig): Record<string, string> | null {
  const token = cfg.apiToken?.trim();
  if (!token) return null;
  return {
    Authorization: token,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function appBase(cfg: ClickUpConfig): string {
  return (cfg.baseUrl ?? "https://app.clickup.com").replace(/\/+$/, "");
}

function taskUrl(cfg: ClickUpConfig, taskId: string, apiUrl?: string): string {
  if (apiUrl) return apiUrl;
  return `${appBase(cfg)}/t/${taskId}`;
}

function priorityName(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number") {
    const id = String(value);
    if (id === "1") return "Urgent";
    if (id === "2") return "High";
    if (id === "3") return "Medium";
    if (id === "4") return "Low";
    return undefined;
  }
  if (typeof value === "object") {
    const obj = value as { id?: unknown; priority?: unknown };
    if (obj.priority != null) {
      const name = String(obj.priority);
      if (/urgent/i.test(name)) return "Urgent";
      if (/high/i.test(name)) return "High";
      if (/normal|medium/i.test(name)) return "Medium";
      if (/low/i.test(name)) return "Low";
    }
    return priorityName(obj.id);
  }
  return undefined;
}

function priorityToClickUp(name?: string): number | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (lower === "urgent") return 1;
  if (lower === "high") return 2;
  if (lower === "medium" || lower === "normal") return 3;
  if (lower === "low") return 4;
  return undefined;
}

function statusName(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value || undefined;
  if (typeof value === "object" && "status" in value) {
    const status = (value as { status?: unknown }).status;
    return typeof status === "string" ? status : undefined;
  }
  return undefined;
}

function assigneeName(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const first = value[0] as { username?: string; email?: string };
  return first.username || first.email || undefined;
}

function mapTask(
  cfg: ClickUpConfig,
  task: Record<string, unknown>,
): TicketSummary & { source: "clickup" } {
  const id = String(task.id ?? "");
  return {
    key: id,
    summary: String(task.name ?? ""),
    status: statusName(task.status),
    assignee: assigneeName(task.assignees),
    priority: priorityName(task.priority),
    url: taskUrl(cfg, id, typeof task.url === "string" ? task.url : undefined),
    source: "clickup",
  };
}

function mapTaskDetail(cfg: ClickUpConfig, task: Record<string, unknown>): TicketDetail & {
  source: "clickup";
} {
  const summary = mapTask(cfg, task);
  const description = typeof task.description === "string"
    ? task.description
    : typeof task.text_content === "string"
    ? task.text_content
    : "";
  const tags = Array.isArray(task.tags)
    ? task.tags.map((tag) => {
      if (typeof tag === "string") return tag;
      if (tag && typeof tag === "object" && "name" in tag) {
        return String((tag as { name?: unknown }).name ?? "");
      }
      return "";
    }).filter(Boolean)
    : [];
  return {
    ...summary,
    reporter: undefined,
    type: "Task",
    created: task.date_created ? new Date(Number(task.date_created)).toISOString() : undefined,
    updated: task.date_updated ? new Date(Number(task.date_updated)).toISOString() : undefined,
    labels: tags,
    description,
  };
}

export async function testClickUp(cfg: ClickUpConfig): Promise<TestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const headers = authHeaders(cfg);
  if (!headers) {
    return { ok: false, message: "API token ClickUp belum diisi.", latencyMs: elapsed() };
  }

  try {
    const res = await request(`${apiRoot(cfg)}/team`, { method: "GET", headers });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: statusMessage(res.status),
        detail: truncate(res.text),
        latencyMs: elapsed(),
      };
    }
    let teamHint = "";
    try {
      const data = JSON.parse(res.text) as { teams?: Array<{ id?: string; name?: string }> };
      const teams = data.teams ?? [];
      if (cfg.teamId) {
        const match = teams.find((team) => String(team.id) === cfg.teamId);
        teamHint = match?.name ? ` (team ${match.name})` : ` (team ${cfg.teamId})`;
      } else if (teams[0]?.name) {
        teamHint = ` (${teams.length} team: ${teams[0].name}${teams.length > 1 ? "…" : ""})`;
      }
    } catch {
      teamHint = "";
    }
    return {
      ok: true,
      status: res.status,
      message: `Koneksi ClickUp berhasil${teamHint}.`,
      latencyMs: elapsed(),
    };
  } catch (error) {
    return {
      ok: false,
      message: `Gagal menghubungi ClickUp: ${(error as Error).message}`,
      latencyMs: elapsed(),
    };
  }
}

export async function listTickets(
  cfg: ClickUpConfig,
): Promise<Array<TicketSummary & { source: "clickup" }>> {
  const headers = authHeaders(cfg);
  if (!headers) throw new Error("API token ClickUp belum diisi.");
  if (!cfg.listId) throw new Error("List ID ClickUp belum diisi.");

  const tasks: Array<Record<string, unknown>> = [];
  let page = 0;
  for (;;) {
    const res = await request(
      `${apiRoot(cfg)}/list/${
        encodeURIComponent(cfg.listId)
      }/task?archived=false&page=${page}&subtasks=true`,
      { method: "GET", headers },
    );
    if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 200)}`);
    const data = JSON.parse(res.text || "{}") as {
      tasks?: Array<Record<string, unknown>>;
      last_page?: boolean;
    };
    const batch = data.tasks ?? [];
    tasks.push(...batch);
    if (data.last_page || batch.length === 0 || page >= 4) break;
    page += 1;
  }
  return tasks.map((task) => mapTask(cfg, task));
}

export async function getTicket(
  cfg: ClickUpConfig,
  taskId: string,
): Promise<TicketDetail & { source: "clickup" }> {
  const headers = authHeaders(cfg);
  if (!headers) throw new Error("API token ClickUp belum diisi.");
  const res = await request(
    `${apiRoot(cfg)}/task/${encodeURIComponent(taskId)}?include_subtasks=true`,
    { method: "GET", headers },
  );
  if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 200)}`);
  const task = JSON.parse(res.text || "{}") as Record<string, unknown>;
  return mapTaskDetail(cfg, task);
}

export interface CreateTicketInput {
  summary: string;
  description?: string;
  status?: string;
  priority?: string;
  labels?: string[];
}

export async function createTicket(
  cfg: ClickUpConfig,
  input: CreateTicketInput,
): Promise<{ key: string; url: string }> {
  const headers = authHeaders(cfg);
  if (!headers) throw new Error("API token ClickUp belum diisi.");
  if (!cfg.listId) throw new Error("List ID ClickUp belum diisi.");

  const body: Record<string, unknown> = {
    name: input.summary,
  };
  if (input.description) body.description = htmlToPlainText(input.description);
  if (input.status) body.status = input.status;
  const priority = priorityToClickUp(input.priority);
  if (priority != null) body.priority = priority;
  if (input.labels?.length) {
    body.tags = input.labels;
  }

  const res = await request(`${apiRoot(cfg)}/list/${encodeURIComponent(cfg.listId)}/task`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 200)}`);
  const json = JSON.parse(res.text || "{}") as { id?: string; url?: string };
  const key = String(json.id ?? "");
  if (!key) throw new Error("ClickUp tidak mengembalikan id task.");
  return { key, url: taskUrl(cfg, key, json.url) };
}

async function listStatuses(cfg: ClickUpConfig): Promise<string[]> {
  if (!cfg.listId) return [];
  const headers = authHeaders(cfg);
  if (!headers) return [];
  const res = await request(`${apiRoot(cfg)}/list/${encodeURIComponent(cfg.listId)}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) return [];
  const data = JSON.parse(res.text || "{}") as {
    statuses?: Array<{ status?: string }>;
  };
  return (data.statuses ?? [])
    .map((item) => item.status?.trim())
    .filter((value): value is string => Boolean(value));
}

export async function transitionTicket(
  cfg: ClickUpConfig,
  taskId: string,
  targetStatus: string,
): Promise<void> {
  const headers = authHeaders(cfg);
  if (!headers) throw new Error("API token ClickUp belum diisi.");

  const statuses = await listStatuses(cfg);
  const target = targetStatus.trim().toLowerCase();
  const match = statuses.find((status) => status.toLowerCase() === target) ??
    statuses.find((status) =>
      status.toLowerCase().includes(target) || target.includes(status.toLowerCase())
    );
  if (!match) {
    if (statuses.length > 0) {
      throw new Error(
        `Status "${targetStatus}" tidak tersedia untuk task ${taskId}. Tersedia: ${
          statuses.join(", ")
        }`,
      );
    }
  }

  const res = await request(`${apiRoot(cfg)}/task/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ status: match ?? targetStatus.trim() }),
  });
  if (!res.ok) {
    const available = statuses.join(", ") || "(tidak diketahui)";
    throw new Error(
      `${statusMessage(res.status)} ${truncate(res.text, 200)}. Status list: ${available}`,
    );
  }
}
