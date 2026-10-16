import type { JiraConfig } from "../config/schema.ts";
import { request, type TestResult, truncate } from "./http.ts";

type ApiVersion = "2" | "3";

function statusMessage(status: number): string {
  if (status === 401) {
    return "Ditolak (401): kredensial salah. Jira Cloud butuh email + API token (Basic); Data Center butuh PAT (Bearer).";
  }
  if (status === 403) return "Ditolak (403): tidak punya izin.";
  if (status === 404) return "Endpoint tidak ditemukan (404): periksa baseUrl/deployment.";
  if (status === 410) return "Endpoint usang (410): endpoint pengganti juga gagal.";
  if (status === 429) return "Rate limit (429): hormati Retry-After.";
  return `Jira merespons HTTP ${status}.`;
}

function normalizeBase(baseUrl: string): string {
  return baseUrl
    .replace(/\/+$/, "")
    .replace(/\/rest\/api\/\d+$/, "");
}

function preferredVersion(cfg: JiraConfig): ApiVersion {
  return cfg.deployment === "data-center" ? "2" : "3";
}

function versionsInOrder(cfg: JiraConfig): ApiVersion[] {
  return preferredVersion(cfg) === "3" ? ["3", "2"] : ["2", "3"];
}

export function jiraApiBase(cfg: JiraConfig, version: ApiVersion = preferredVersion(cfg)): string {
  if (cfg.deployment === "cloud" && cfg.cloudId && version === "3") {
    return `https://api.atlassian.com/ex/jira/${cfg.cloudId}/rest/api/3`;
  }
  return `${normalizeBase(cfg.baseUrl)}/rest/api/${version}`;
}

function authHeader(cfg: JiraConfig): string | null {
  if (!cfg.apiToken) return null;
  if (cfg.email) return `Basic ${btoa(`${cfg.email}:${cfg.apiToken}`)}`;
  return `Bearer ${cfg.apiToken}`;
}

export interface TicketSummary {
  key: string;
  summary: string;
  status?: string;
  assignee?: string;
  priority?: string;
  url: string;
}

export interface TicketDetail {
  key: string;
  summary: string;
  status?: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  type?: string;
  created?: string;
  updated?: string;
  labels: string[];
  description: string;
  url: string;
}

export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const value = node as { type?: string; text?: string; content?: unknown[]; items?: unknown[] };
  if (value.type === "text") return value.text ?? "";
  if (value.type === "hardBreak") return "\n";
  const children = Array.isArray(value.content) ? value.content.map(adfToText).join("") : "";
  const blockTypes = ["paragraph", "heading", "listItem", "blockquote", "codeBlock"];
  if (value.type && blockTypes.includes(value.type)) return `${children}\n`;
  return children;
}

export async function testJira(cfg: JiraConfig): Promise<TestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  const auth = authHeader(cfg);
  if (!auth) {
    return {
      ok: false,
      message: "Kredensial Jira belum lengkap: butuh API token (dan email untuk Jira Cloud).",
      latencyMs: elapsed(),
    };
  }

  const headers = { Authorization: auth, Accept: "application/json" };
  try {
    let res = { ok: false, status: 0, text: "" };
    for (const version of versionsInOrder(cfg)) {
      res = await request(`${jiraApiBase(cfg, version)}/myself`, { method: "GET", headers });
      if (res.ok || (res.status !== 404 && res.status !== 410)) break;
    }

    if (res.ok) {
      let displayName = "";
      try {
        displayName = (JSON.parse(res.text) as { displayName?: string }).displayName ?? "";
      } catch {
        displayName = "";
      }
      return {
        ok: true,
        status: res.status,
        message: displayName ? `Terhubung sebagai ${displayName}.` : "Koneksi Jira berhasil.",
        latencyMs: elapsed(),
      };
    }
    return {
      ok: false,
      status: res.status,
      message: statusMessage(res.status),
      detail: truncate(res.text),
      latencyMs: elapsed(),
    };
  } catch (error) {
    return {
      ok: false,
      message: `Gagal menghubungi Jira: ${(error as Error).message}. Periksa baseUrl & jaringan.`,
      latencyMs: elapsed(),
    };
  }
}

function parseTickets(text: string, cfg: JiraConfig): TicketSummary[] {
  const json = JSON.parse(text || "{}") as { issues?: Array<Record<string, unknown>> };
  const browseBase = normalizeBase(cfg.baseUrl);
  return (json.issues ?? []).map((issue) => {
    const fields = (issue.fields as Record<string, unknown> | undefined) ?? {};
    const status = fields.status as { name?: string } | undefined;
    const assignee = fields.assignee as { displayName?: string } | undefined;
    const priority = fields.priority as { name?: string } | undefined;
    return {
      key: String(issue.key ?? ""),
      summary: String(fields.summary ?? ""),
      status: status?.name,
      assignee: assignee?.displayName,
      priority: priority?.name,
      url: `${browseBase}/browse/${issue.key}`,
    };
  });
}

export interface JiraTransition {
  id: string;
  name: string;
  to?: string;
}

export async function getTransitions(cfg: JiraConfig, key: string): Promise<JiraTransition[]> {
  const auth = authHeader(cfg);
  if (!auth) throw new Error("Kredensial Jira belum lengkap: butuh API token.");
  const headers = { Authorization: auth, Accept: "application/json" };
  const res = await request(
    `${jiraApiBase(cfg)}/issue/${key}/transitions?expand=transitions.fields`,
    { method: "GET", headers },
  );
  if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 200)}`);
  const data = JSON.parse(res.text || "{}") as {
    transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
  };
  return (data.transitions ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    to: t.to?.name,
  }));
}

export async function transitionTicket(
  cfg: JiraConfig,
  key: string,
  targetStatus: string,
): Promise<void> {
  const transitions = await getTransitions(cfg, key);
  const target = targetStatus.trim().toLowerCase();
  const nameOf = (t: JiraTransition) => (t.to ?? t.name).toLowerCase();
  const match = transitions.find((t) => nameOf(t) === target) ??
    transitions.find((t) => nameOf(t).includes(target) || target.includes(nameOf(t)));
  if (!match) {
    const available = transitions.map((t) => t.to ?? t.name).join(", ") || "(tidak ada)";
    throw new Error(
      `Transisi ke "${targetStatus}" tidak tersedia untuk ${key}. Tersedia: ${available}`,
    );
  }

  const auth = authHeader(cfg);
  const res = await request(`${jiraApiBase(cfg)}/issue/${key}/transitions`, {
    method: "POST",
    headers: {
      Authorization: auth ?? "",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transition: { id: match.id } }),
  });
  if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 200)}`);
}

export async function getTicket(cfg: JiraConfig, key: string): Promise<TicketDetail> {
  const auth = authHeader(cfg);
  if (!auth) throw new Error("Kredensial Jira belum lengkap: butuh API token.");

  const fields = [
    "summary",
    "description",
    "status",
    "assignee",
    "reporter",
    "priority",
    "issuetype",
    "created",
    "updated",
    "labels",
  ];
  const res = await request(
    `${jiraApiBase(cfg)}/issue/${key}?fields=${fields.join(",")}`,
    { method: "GET", headers: { Authorization: auth, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 200)}`);

  const json = JSON.parse(res.text || "{}") as {
    key?: string;
    fields?: Record<string, unknown>;
  };
  const f = (json.fields ?? {}) as Record<string, unknown>;
  const named = (value: unknown): string | undefined => {
    if (value && typeof value === "object" && "name" in value) {
      return String((value as { name?: unknown }).name ?? "") || undefined;
    }
    return undefined;
  };
  const display = (value: unknown): string | undefined => {
    if (value && typeof value === "object" && "displayName" in value) {
      return String((value as { displayName?: unknown }).displayName ?? "") || undefined;
    }
    return undefined;
  };
  const description = typeof f.description === "string"
    ? f.description
    : adfToText(f.description).replace(/\n{3,}/g, "\n\n").trim();

  return {
    key: String(json.key ?? key),
    summary: String(f.summary ?? ""),
    status: named(f.status),
    priority: named(f.priority),
    assignee: display(f.assignee),
    reporter: display(f.reporter),
    type: named(f.issuetype),
    created: f.created ? String(f.created) : undefined,
    updated: f.updated ? String(f.updated) : undefined,
    labels: Array.isArray(f.labels) ? f.labels.map(String) : [],
    description,
    url: `${normalizeBase(cfg.baseUrl)}/browse/${json.key ?? key}`,
  };
}

export async function listTickets(cfg: JiraConfig): Promise<TicketSummary[]> {
  const auth = authHeader(cfg);
  if (!auth) throw new Error("Kredensial Jira belum lengkap: butuh API token.");
  if (!cfg.projectKey) throw new Error("Project Key Jira belum diisi.");

  const jql = `project = "${cfg.projectKey}" ORDER BY updated DESC`;
  const fieldList = ["summary", "status", "assignee", "priority"];
  const query = `?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${
    encodeURIComponent(
      fieldList.join(","),
    )
  }`;
  const body = JSON.stringify({ jql, fields: fieldList, maxResults: 50 });

  const getHeaders = { Authorization: auth, Accept: "application/json" };
  const postHeaders = { ...getHeaders, "Content-Type": "application/json" };

  const attempts: { url: string; init: RequestInit }[] = [];
  for (const version of versionsInOrder(cfg)) {
    const base = jiraApiBase(cfg, version);
    attempts.push({
      url: `${base}/search/jql${query}`,
      init: { method: "GET", headers: getHeaders },
    });
    attempts.push({
      url: `${base}/search/jql`,
      init: { method: "POST", headers: postHeaders, body },
    });
    attempts.push({ url: `${base}/search`, init: { method: "POST", headers: postHeaders, body } });
  }

  let last = { status: 0, text: "" };
  for (const attempt of attempts) {
    const res = await request(attempt.url, attempt.init);
    if (res.ok) return parseTickets(res.text, cfg);
    last = { status: res.status, text: res.text };
    if (res.status !== 404 && res.status !== 405 && res.status !== 410) {
      throw new Error(`${statusMessage(res.status)} ${truncate(res.text, 200)}`);
    }
  }
  throw new Error(`Gagal memuat tiket. ${statusMessage(last.status)} ${truncate(last.text, 200)}`);
}
