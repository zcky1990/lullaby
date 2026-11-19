import {
  AutomationSettingsInput,
  ChatToolsSettingsInput,
  WorkflowSettingsInput,
  LspProbeInput,
  LspSettingsInput,
  McpServerInput,
  McpSettingsInput,
  NotificationSettingsInput,
  NotificationTestInput,
  SkillsSettingsInput,
  TerminalSettingsInput,
  UiPreferencesInput,
} from "../../config/schema.ts";
import { PromptsSettingsPatchInput } from "../../config/schema_prompts_patch.ts";
import { log } from "../../core/logger.ts";
import { getAppSetting, getProject, setAppSetting } from "../../db/db.ts";
import {
  decryptMcpServers,
  encryptMcpServers,
  maskMcpServers,
  maskNotificationChannels,
  type McpServerSecrets,
  mergeMcpServerSecrets,
  mergeNotificationChannelSecrets,
  type NotificationChannelSecrets,
} from "../../secrets/fields.ts";
import {
  AUTO_APPROVE_WRITES_KEY,
  CHAT_AUTO_APPROVE_TOOLS_KEY,
  CHAT_DISABLED_TOOLS_KEY,
  CHAT_MAX_STEPS_KEY,
  CHAT_REVIEW_KEEP_HOURS_KEY,
  CHAT_WRITE_REVIEW_MODE_KEY,
  normalizeReviewKeepHours,
  normalizeWriteReviewMode,
  readChatToolsSettings,
} from "../chat/settings.ts";
import { normalizeMaxSteps } from "../chat/max-steps.ts";
import { CHAT_TOOL_CATALOG } from "../chat/tools.ts";
import { json, readJson, record } from "../http.ts";
import { lspPresets, probeLspCommand, readLspSettings, writeLspSettings } from "../lsp.ts";
import { clearMcpToolsCache, listMcpTools } from "../mcp.ts";
import { testNotificationChannels } from "../notifications/send.ts";
import { readNotificationSettings, writeNotificationSettings } from "../notifications/settings.ts";
import {
  builtinSkillsDir,
  globalSkillsDir,
  listSkills,
  projectSkillsDir,
  projectSlug,
  readSkillsSettings,
  workspaceSkillsDir,
} from "../skills.ts";
import { readTerminalShellSetting, TERMINAL_SHELL_KEY } from "../terminal.ts";
import {
  DEFAULT_PLAN_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TICKET_PROMPT,
  readPromptSettings,
  readTicketPrompt,
} from "../prompts.ts";
import {
  normalizeWorkflowCacheKeepHours,
  readWorkflowCacheKeepHours,
  writeWorkflowCacheKeepHours,
} from "../workflow/cache.ts";

const MCP_SETTINGS_KEY = "mcp_servers";
const AUTO_BUILD_KEY = "auto_build_on_in_progress";
const UI_PREFERENCES_KEY = "ui_preferences";

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

async function readStoredMcpServers(): Promise<McpServerSecrets[]> {
  const raw = await getAppSetting(MCP_SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return await decryptMcpServers(parsed as McpServerSecrets[]);
  } catch (error) {
    log.debug("corrupt mcp_servers JSON", { error: String(error) });
    return [];
  }
}

export async function getMcpSettingsHandler(): Promise<Response> {
  const servers = maskMcpServers(await readStoredMcpServers());
  const enabled = (await getAppSetting("mcp_enabled")) !== "false";
  const injectIntoChat = (await getAppSetting("mcp_inject_chat")) === "true";
  const disabledTools = parseStringArray(await getAppSetting("mcp_disabled_tools"));
  return json({ servers, enabled, injectIntoChat, disabledTools });
}

export async function saveMcpSettingsHandler(req: Request): Promise<Response> {
  const body = await readJson(req);
  const existing = await readStoredMcpServers();
  const incoming = (body as { servers?: McpServerSecrets[] } | null)?.servers;
  const mergedBody = {
    ...(body as Record<string, unknown>),
    servers: Array.isArray(incoming) ? mergeMcpServerSecrets(incoming, existing) : incoming,
  };
  const parsed = McpSettingsInput.safeParse(mergedBody);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const servers = parsed.data.servers.map((server) => ({
    ...server,
    id: server.id ?? crypto.randomUUID(),
  }));
  const encrypted = await encryptMcpServers(servers);
  await setAppSetting(MCP_SETTINGS_KEY, JSON.stringify(encrypted));
  await setAppSetting("mcp_enabled", parsed.data.enabled ? "true" : "false");
  await setAppSetting("mcp_inject_chat", parsed.data.injectIntoChat ? "true" : "false");
  await setAppSetting("mcp_disabled_tools", JSON.stringify(parsed.data.disabledTools));
  clearMcpToolsCache();
  await record("settings.mcp_updated", {
    count: servers.length,
    enabled: parsed.data.enabled,
    injectIntoChat: parsed.data.injectIntoChat,
  });
  return json({
    servers: maskMcpServers(servers),
    enabled: parsed.data.enabled,
    injectIntoChat: parsed.data.injectIntoChat,
    disabledTools: parsed.data.disabledTools,
  });
}

export async function listMcpToolsHandler(req: Request): Promise<Response> {
  const body = (await readJson(req)) as { server?: unknown };
  const existing = await readStoredMcpServers();
  const incoming = body?.server as McpServerSecrets | undefined;
  const merged = incoming ? mergeMcpServerSecrets([incoming], existing)[0] : undefined;
  const parsed = McpServerInput.safeParse(merged);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  try {
    clearMcpToolsCache();
    return json({ tools: await listMcpTools(parsed.data) });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}

export async function skillsHandler(projectId: string | null): Promise<Response> {
  const project = projectId ? await getProject(projectId) : null;
  const workspace = project?.workspace_path ?? null;
  const slug = project ? projectSlug(project.name, project.id) : null;
  const settings = await readSkillsSettings();
  const skills = await listSkills(workspace, slug);
  return json({
    enabled: settings.enabled,
    disabled: settings.disabled,
    globalPath: globalSkillsDir(),
    builtinPath: builtinSkillsDir(),
    workspacePath: workspace ? workspaceSkillsDir(workspace) : null,
    projectPath: slug ? projectSkillsDir(slug) : null,
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

export async function getChatToolsSettingsHandler(): Promise<Response> {
  const settings = await readChatToolsSettings();
  return json({
    autoApproveWrites: settings.autoApproveWrites,
    disabledTools: settings.disabledTools,
    autoApproveTools: settings.autoApproveTools,
    maxSteps: settings.maxSteps,
    writeReviewMode: settings.writeReviewMode,
    reviewKeepHours: settings.reviewKeepHours,
    tools: CHAT_TOOL_CATALOG,
  });
}

export async function saveChatToolsSettingsHandler(req: Request): Promise<Response> {
  const parsed = ChatToolsSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const allowed = new Set(CHAT_TOOL_CATALOG.map((tool) => tool.name));
  const disabledTools = [
    ...new Set(parsed.data.disabledTools.filter((name) => allowed.has(name))),
  ];
  const current = await readChatToolsSettings();
  const autoApproveTools = parsed.data.autoApproveTools === undefined
    ? current.autoApproveTools
    : [...new Set(parsed.data.autoApproveTools)];
  const maxSteps = parsed.data.maxSteps === undefined
    ? current.maxSteps
    : normalizeMaxSteps(parsed.data.maxSteps);
  const writeReviewMode = parsed.data.writeReviewMode === undefined
    ? current.writeReviewMode
    : normalizeWriteReviewMode(parsed.data.writeReviewMode);
  const reviewKeepHours = parsed.data.reviewKeepHours === undefined
    ? current.reviewKeepHours
    : normalizeReviewKeepHours(parsed.data.reviewKeepHours);
  await setAppSetting(
    AUTO_APPROVE_WRITES_KEY,
    parsed.data.autoApproveWrites ? "true" : "false",
  );
  await setAppSetting(CHAT_DISABLED_TOOLS_KEY, JSON.stringify(disabledTools));
  await setAppSetting(CHAT_AUTO_APPROVE_TOOLS_KEY, JSON.stringify(autoApproveTools));
  await setAppSetting(CHAT_MAX_STEPS_KEY, maxSteps == null ? "" : String(maxSteps));
  await setAppSetting(CHAT_WRITE_REVIEW_MODE_KEY, writeReviewMode);
  await setAppSetting(CHAT_REVIEW_KEEP_HOURS_KEY, String(reviewKeepHours));
  await record("settings.chat_tools_updated", {
    autoApproveWrites: parsed.data.autoApproveWrites,
    disabled: disabledTools.length,
    autoApproveTools: autoApproveTools.length,
    maxSteps,
    writeReviewMode,
    reviewKeepHours,
  });
  return await getChatToolsSettingsHandler();
}

export async function getAutomationSettingsHandler(): Promise<Response> {
  const autoBuildOnInProgress = (await getAppSetting(AUTO_BUILD_KEY)) === "true";
  return json({ autoBuildOnInProgress });
}

export async function saveAutomationSettingsHandler(req: Request): Promise<Response> {
  const parsed = AutomationSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  await setAppSetting(
    AUTO_BUILD_KEY,
    parsed.data.autoBuildOnInProgress ? "true" : "false",
  );
  await record("settings.automation_updated", {
    autoBuildOnInProgress: parsed.data.autoBuildOnInProgress,
  });
  return json({ autoBuildOnInProgress: parsed.data.autoBuildOnInProgress });
}

export async function getWorkflowSettingsHandler(): Promise<Response> {
  const cacheKeepHours = await readWorkflowCacheKeepHours();
  return json({ cacheKeepHours });
}

export async function saveWorkflowSettingsHandler(req: Request): Promise<Response> {
  const parsed = WorkflowSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const current = await readWorkflowCacheKeepHours();
  const cacheKeepHours = parsed.data.cacheKeepHours === undefined
    ? current
    : normalizeWorkflowCacheKeepHours(parsed.data.cacheKeepHours);
  await writeWorkflowCacheKeepHours(cacheKeepHours);
  await record("settings.workflow_updated", { cacheKeepHours });
  return json({ cacheKeepHours });
}

export async function getNotificationSettingsHandler(): Promise<Response> {
  const settings = await readNotificationSettings();
  return json({
    settings: {
      channels: maskNotificationChannels(settings.channels),
    },
  });
}

export async function saveNotificationSettingsHandler(req: Request): Promise<Response> {
  const body = await readJson(req);
  const existing = await readNotificationSettings();
  const incoming = (body as { channels?: unknown } | null)?.channels;
  const mergedBody = {
    ...(body as Record<string, unknown>),
    channels: Array.isArray(incoming)
      ? mergeNotificationChannelSecrets(
        incoming as NotificationChannelSecrets[],
        existing.channels,
      )
      : incoming,
  };
  const parsed = NotificationSettingsInput.safeParse(mergedBody);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const settings = await writeNotificationSettings(parsed.data);
  await record("settings.notifications_updated", {
    channels: settings.channels.length,
  });
  return json({
    settings: {
      channels: maskNotificationChannels(settings.channels),
    },
  });
}

export async function testNotificationSettingsHandler(req: Request): Promise<Response> {
  const parsed = NotificationTestInput.safeParse(await readJson(req).catch(() => ({})));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const results = await testNotificationChannels(parsed.data.channelId);
  if (!results.length) {
    return json({
      error: "no_channels",
      message: parsed.data.channelId
        ? "Channel tidak ditemukan atau nonaktif."
        : "Belum ada channel notifikasi yang aktif.",
    }, 400);
  }
  const failed = results.filter((result) => !result.ok);
  return json({
    ok: failed.length === 0,
    results,
  }, failed.length ? 502 : 200);
}

export async function getTerminalSettingsHandler(): Promise<Response> {
  const shell = await readTerminalShellSetting();
  return json({ shell });
}

export async function saveTerminalSettingsHandler(req: Request): Promise<Response> {
  const parsed = TerminalSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  await setAppSetting(TERMINAL_SHELL_KEY, parsed.data.shell);
  await record("settings.terminal_updated", { shell: parsed.data.shell });
  return json({ shell: parsed.data.shell });
}

export async function getUiPreferencesHandler(): Promise<Response> {
  const raw = await getAppSetting(UI_PREFERENCES_KEY);
  let preferences: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = UiPreferencesInput.safeParse(JSON.parse(raw));
      if (parsed.success) preferences = parsed.data;
    } catch {
      preferences = {};
    }
  }
  return json({ preferences });
}

export async function saveUiPreferencesHandler(req: Request): Promise<Response> {
  const parsed = UiPreferencesInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const raw = await getAppSetting(UI_PREFERENCES_KEY);
  let existing: Record<string, unknown> = {};
  if (raw) {
    try {
      const stored = JSON.parse(raw);
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        existing = stored as Record<string, unknown>;
      }
    } catch {
      existing = {};
    }
  }
  const preferences = { ...existing, ...parsed.data };
  await setAppSetting(UI_PREFERENCES_KEY, JSON.stringify(preferences));
  return json({ preferences });
}

export async function getLspSettingsHandler(): Promise<Response> {
  const settings = await readLspSettings();
  return json({ settings, presets: lspPresets() });
}

export async function saveLspSettingsHandler(req: Request): Promise<Response> {
  const parsed = LspSettingsInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  const settings = await writeLspSettings(parsed.data);
  await record("settings.lsp_updated", {
    enabled: settings.enabled,
    servers: settings.servers.length,
  });
  return json({ settings });
}

export async function probeLspHandler(req: Request): Promise<Response> {
  const parsed = LspProbeInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  return json(await probeLspCommand(parsed.data.command));
}

export async function getPromptsHandler(): Promise<Response> {
  const settings = await readPromptSettings();
  const storedSystem = await getAppSetting("system_prompt");
  const storedPlan = await getAppSetting("plan_prompt");
  const storedTicket = await getAppSetting("ticket_prompt");
  return json({
    systemPrompt: settings.systemPrompt,
    planPrompt: settings.planPrompt,
    ticketPrompt: await readTicketPrompt(),
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    defaultPlanPrompt: DEFAULT_PLAN_PROMPT,
    defaultTicketPrompt: DEFAULT_TICKET_PROMPT,
    customized: {
      systemPrompt: Boolean(storedSystem?.trim()),
      planPrompt: Boolean(storedPlan?.trim()),
      ticketPrompt: Boolean(storedTicket?.trim()),
    },
  });
}

export async function savePromptsHandler(req: Request): Promise<Response> {
  const parsed = PromptsSettingsPatchInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  await setAppSetting("system_prompt", parsed.data.systemPrompt);
  await setAppSetting("plan_prompt", parsed.data.planPrompt);
  // Field baru: payload lama (tanpa ticketPrompt) tidak menimpa nilai tersimpan.
  if (parsed.data.ticketPrompt !== undefined) {
    await setAppSetting("ticket_prompt", parsed.data.ticketPrompt);
  }
  await record("settings.prompts_updated", {});
  return json({ ok: true });
}
