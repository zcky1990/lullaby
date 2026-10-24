import { McpServerInput, McpSettingsInput, SkillsSettingsInput } from "../../config/schema.ts";
import { log } from "../../core/logger.ts";
import { getAppSetting, getProject, setAppSetting } from "../../db/db.ts";
import { json, readJson, record } from "../http.ts";
import { listMcpTools } from "../mcp.ts";
import { globalSkillsDir, listSkills, readSkillsSettings, workspaceSkillsDir } from "../skills.ts";

const MCP_SETTINGS_KEY = "mcp_servers";

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (error) {
    log.debug("corrupt JSON array setting", { error: String(error) });
    return [];
  }
}

export async function getMcpSettingsHandler(): Promise<Response> {
  const raw = await getAppSetting(MCP_SETTINGS_KEY);
  let servers: unknown = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) servers = parsed;
    } catch (error) {
      log.debug("corrupt mcp_servers JSON", { error: String(error) });
      servers = [];
    }
  }
  const enabled = (await getAppSetting("mcp_enabled")) !== "false";
  const disabledTools = parseStringArray(await getAppSetting("mcp_disabled_tools"));
  return json({ servers, enabled, disabledTools });
}

export async function saveMcpSettingsHandler(req: Request): Promise<Response> {
  const parsed = McpSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const servers = parsed.data.servers.map((server) => ({
    ...server,
    id: server.id ?? crypto.randomUUID(),
  }));
  await setAppSetting(MCP_SETTINGS_KEY, JSON.stringify(servers));
  await setAppSetting("mcp_enabled", parsed.data.enabled ? "true" : "false");
  await setAppSetting("mcp_disabled_tools", JSON.stringify(parsed.data.disabledTools));
  await record("settings.mcp_updated", {
    count: servers.length,
    enabled: parsed.data.enabled,
  });
  return json({
    servers,
    enabled: parsed.data.enabled,
    disabledTools: parsed.data.disabledTools,
  });
}

export async function listMcpToolsHandler(req: Request): Promise<Response> {
  const body = (await readJson(req)) as { server?: unknown };
  const parsed = McpServerInput.safeParse(body?.server);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    return json({ tools: await listMcpTools(parsed.data) });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

export async function skillsHandler(projectId: string | null): Promise<Response> {
  const project = projectId ? await getProject(projectId) : null;
  const workspace = project?.workspace_path ?? null;
  const settings = await readSkillsSettings();
  const skills = await listSkills(workspace);
  return json({
    enabled: settings.enabled,
    disabled: settings.disabled,
    globalPath: globalSkillsDir(),
    workspacePath: workspace ? workspaceSkillsDir(workspace) : null,
    skills: skills.map((skill) => ({
      ...skill,
      enabled: !settings.disabled.includes(skill.id),
    })),
  });
}

export async function saveSkillsSettingsHandler(req: Request): Promise<Response> {
  const parsed = SkillsSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  await setAppSetting("skills_enabled", parsed.data.enabled ? "true" : "false");
  await setAppSetting("skills_disabled", JSON.stringify(parsed.data.disabled));
  await record("settings.skills_updated", {
    enabled: parsed.data.enabled,
    disabled: parsed.data.disabled.length,
  });
  return json({ ok: true });
}
