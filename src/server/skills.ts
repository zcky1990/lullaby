import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appDataDir } from "../core/paths.ts";
import { getAppSetting, setAppSetting } from "../db/db.ts";

export type SkillSource = "global" | "workspace" | "project" | "builtin";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
}

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

const MAX_SKILL_CHARS = 20_000;
const MAX_DESCRIPTION = 240;

const DEFAULT_INTEGRATION_SKILLS = [
  "docmost-api",
  "jira-api",
  "confluence-api",
  "clickup-api",
];

export function globalSkillsDir(): string {
  return join(appDataDir(), "skills");
}

export function builtinSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../skills/builtin");
}

export function workspaceSkillsDir(workspace: string): string {
  return join(workspace, ".agents", "skills");
}

export function projectSlug(name: string, projectId?: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (slug) return slug;
  return `project-${(projectId ?? "unknown").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "unknown"}`;
}

export function projectSkillsDir(slug: string): string {
  return join(appDataDir(), slug, "skills");
}

export async function installDefaultSkills(): Promise<string[]> {
  if ((await getAppSetting("skills_defaults_installed")) === "true") return [];

  const sourceRoot = builtinSkillsDir();
  const targetRoot = globalSkillsDir();
  const installed: string[] = [];
  let scanned = false;

  try {
    await Deno.mkdir(targetRoot, { recursive: true });
    for await (const entry of Deno.readDir(sourceRoot)) {
      scanned = true;
      if (!entry.isDirectory || !DEFAULT_INTEGRATION_SKILLS.includes(entry.name)) continue;
      const text = await Deno.readTextFile(join(sourceRoot, entry.name, "SKILL.md")).catch(
        () => null,
      );
      if (!text) continue;
      const targetDir = join(targetRoot, entry.name);
      const target = join(targetDir, "SKILL.md");
      const exists = await Deno.stat(target).then(() => true).catch(() => false);
      if (exists) continue;
      await Deno.mkdir(targetDir, { recursive: true });
      await Deno.writeTextFile(target, text);
      installed.push(entry.name);
    }
  } catch {
    return [];
  }

  if (!scanned) return [];
  await setAppSetting("skills_defaults_installed", "true");
  return installed;
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: text };
  const header = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const meta: Record<string, string> = {};
  let currentKey = "";
  let blockMode: "folded" | "literal" | null = null;
  for (const line of header.split(/\r?\n/)) {
    const block = /^([A-Za-z0-9_-]+)\s*:\s*([>|][+-]?)\s*$/.exec(line);
    if (block) {
      currentKey = block[1].toLowerCase();
      meta[currentKey] = "";
      blockMode = block[2].startsWith(">") ? "folded" : "literal";
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match) {
      currentKey = match[1].toLowerCase();
      blockMode = null;
      meta[currentKey] = match[2].replace(/^["']|["']$/g, "").trim();
      continue;
    }
    if (currentKey && /^\s+/.test(line)) {
      const value = line.trim();
      if (blockMode === "literal") {
        meta[currentKey] = meta[currentKey] ? `${meta[currentKey]}\n${value}` : value;
      } else {
        meta[currentKey] = `${meta[currentKey]} ${value}`.trim();
      }
    }
  }
  return { meta, body };
}

export function normalizeSkillName(raw: string, fallback: string): string {
  const value = (raw || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return value.slice(0, 64);
}

function fallbackDescription(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) return trimmed.slice(0, MAX_DESCRIPTION);
  }
  return "";
}

export function parseSkillFile(text: string, fallbackName: string): ParsedSkill {
  const { meta, body } = parseFrontmatter(text);
  const name = normalizeSkillName(meta.name ?? "", fallbackName);
  const description = (meta.description ?? fallbackDescription(body)).slice(0, MAX_DESCRIPTION);
  return { name, description, body };
}

async function scanSkills(
  dir: string,
  source: SkillSource,
  seen: Set<string>,
  out: SkillInfo[],
): Promise<void> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isDirectory || entry.name.startsWith(".")) continue;
      const file = join(dir, entry.name, "SKILL.md");
      const text = await Deno.readTextFile(file).catch(() => null);
      if (!text) continue;
      const parsed = parseSkillFile(text, entry.name);
      if (!parsed.name || seen.has(parsed.name)) continue;
      seen.add(parsed.name);
      out.push({
        id: `${source}:${parsed.name}`,
        name: parsed.name,
        description: parsed.description,
        source,
        path: file,
      });
    }
  } catch {
    // missing skills directory
  }
}

export async function listSkills(
  workspace: string | null,
  projectSlugName?: string | null,
): Promise<SkillInfo[]> {
  const out: SkillInfo[] = [];
  const seen = new Set<string>();
  if (workspace) await scanSkills(workspaceSkillsDir(workspace), "workspace", seen, out);
  if (projectSlugName) {
    await scanSkills(projectSkillsDir(projectSlugName), "project", seen, out);
  }
  await scanSkills(globalSkillsDir(), "global", seen, out);
  await scanSkills(builtinSkillsDir(), "builtin", seen, out);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function parseDisabled(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function readSkillsSettings(): Promise<{ enabled: boolean; disabled: string[] }> {
  const enabled = (await getAppSetting("skills_enabled")) !== "false";
  const disabled = parseDisabled(await getAppSetting("skills_disabled"));
  return { enabled, disabled };
}

export async function loadEnabledSkills(
  workspace: string | null,
  projectSlugName?: string | null,
): Promise<SkillInfo[]> {
  const settings = await readSkillsSettings();
  if (!settings.enabled) return [];
  const skills = await listSkills(workspace, projectSlugName);
  return skills.filter((skill) => !settings.disabled.includes(skill.id));
}

export async function readSkillBody(skill: SkillInfo): Promise<string> {
  const text = await Deno.readTextFile(skill.path);
  const { body } = parseFrontmatter(text);
  return body.slice(0, MAX_SKILL_CHARS);
}
