import { listSkills, projectSlug, type SkillInfo } from "./skills.ts";

const TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT = 8_000;

export interface AutoskillsOptions {
  dryRun?: boolean;
  projectName?: string;
  projectId?: string;
}

export interface AutoskillsResult {
  ok: boolean;
  dryRun: boolean;
  output: string;
  skills: SkillInfo[];
  error?: string;
  code?: number;
}

function truncate(text: string, max = MAX_OUTPUT): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

async function runWithTimeout(
  cmd: Deno.Command,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const child = cmd.spawn();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }, timeoutMs);

  try {
    const output = await child.output();
    return {
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAutoskills(
  workspacePath: string,
  opts: AutoskillsOptions = {},
): Promise<AutoskillsResult> {
  const dryRun = Boolean(opts.dryRun);
  const root = workspacePath.trim();
  if (!root) {
    return { ok: false, dryRun, output: "", skills: [], error: "workspace_path kosong." };
  }

  try {
    const stat = await Deno.stat(root);
    if (!stat.isDirectory) {
      return {
        ok: false,
        dryRun,
        output: "",
        skills: [],
        error: "workspace_path bukan direktori.",
      };
    }
  } catch {
    return {
      ok: false,
      dryRun,
      output: "",
      skills: [],
      error: "workspace_path tidak ditemukan.",
    };
  }

  const args = ["--yes", "autoskills", "-y", "-a", "cursor"];
  if (dryRun) args.push("--dry-run");

  let result: { code: number; stdout: string; stderr: string; timedOut: boolean };
  try {
    const cmd = new Deno.Command("npx", {
      args,
      cwd: root,
      stdout: "piped",
      stderr: "piped",
      env: {
        ...Deno.env.toObject(),
        npm_config_yes: "true",
        CI: "1",
      },
    });
    result = await runWithTimeout(cmd, TIMEOUT_MS);
  } catch (error) {
    const message = (error as Error).message || String(error);
    return {
      ok: false,
      dryRun,
      output: "",
      skills: [],
      error:
        `Gagal menjalankan npx autoskills (${message}). Pastikan Node.js >= 22.6 dan npx ada di PATH.`,
    };
  }

  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const output = truncate(combined);

  if (result.timedOut) {
    return {
      ok: false,
      dryRun,
      output,
      skills: [],
      error: "autoskills timeout (lebih dari 5 menit).",
      code: result.code,
    };
  }

  if (result.code !== 0) {
    return {
      ok: false,
      dryRun,
      output,
      skills: [],
      error: `autoskills exit ${result.code}. Butuh Node.js >= 22.6 dan jaringan untuk unduh registry.`,
      code: result.code,
    };
  }

  const slug = projectSlug(opts.projectName ?? "", opts.projectId);
  const all = await listSkills(root, slug);
  const skills = all.filter((skill) => skill.source === "workspace");

  return { ok: true, dryRun, output, skills };
}
