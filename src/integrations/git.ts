import { join, resolve } from "node:path";
import { resolveWithin } from "../fs/workspace.ts";

const decoder = new TextDecoder();

const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
const GIT_CANDIDATES = [
  Deno.env.get("GIT_BINARY"),
  "git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
  "/opt/local/bin/git",
  "/usr/bin/git",
  "/run/current-system/sw/bin/git",
  "/nix/var/nix/profiles/default/bin/git",
  home ? join(home, ".asdf/shims/git") : undefined,
  home ? join(home, ".local/bin/git") : undefined,
].filter((value): value is string => Boolean(value));

async function gitFromLoginShell(): Promise<string | null> {
  if (Deno.build.os === "windows") return null;
  try {
    const shell = Deno.env.get("SHELL") || "/bin/zsh";
    const result = await new Deno.Command(shell, {
      args: ["-lc", "command -v git"],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (result.code !== 0) return null;
    const lines = decoder.decode(result.stdout).trim().split(/\r?\n/).filter(Boolean);
    return lines[lines.length - 1] ?? null;
  } catch {
    return null;
  }
}

export function normalizeWorkspacePath(path: string): string {
  const value = path.trim();
  if (!value) return value;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? Deno.cwd();
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return resolve(home, value.slice(2));
  }
  return resolve(value);
}

export interface GitFile {
  path: string;
  status: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  clean: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  refs: string;
}

async function execGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const run = async (command: string) => {
    const result = await new Deno.Command(command, {
      cwd,
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code: result.code,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    };
  };

  let last: { code: number; stdout: string; stderr: string } | null = null;
  let spawnError: Error | null = null;
  for (const command of GIT_CANDIDATES) {
    try {
      const result = await run(command);
      if (result.code === 0) return result;
      last = result;
    } catch (error) {
      spawnError = error as Error;
    }
  }
  if (last) return last;

  const shellGit = await gitFromLoginShell();
  if (shellGit) {
    try {
      const result = await run(shellGit);
      if (result.code === 0) return result;
      last = result;
    } catch {
      // ignore
    }
  }
  if (last) return last;
  throw new Error(
    `git tidak dapat dijalankan (${GIT_CANDIDATES.join(", ")}): ` +
      (spawnError?.message ?? "unknown error"),
  );
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execGit(cwd, args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git exited with code ${result.code}`);
  }
  return result.stdout;
}

export async function checkGitRepository(cwd: string): Promise<{
  ok: boolean;
  cwd: string;
  error?: string;
}> {
  const normalized = normalizeWorkspacePath(cwd);
  const stat = await Deno.stat(normalized).catch(() => null);
  if (!stat?.isDirectory) {
    return {
      ok: false,
      cwd: normalized,
      error: `Folder workspace tidak ditemukan: ${normalized}`,
    };
  }
  try {
    const result = await execGit(normalized, ["rev-parse", "--is-inside-work-tree"]);
    if (result.code === 0 && result.stdout.trim() === "true") {
      return { ok: true, cwd: normalized };
    }
    const message = result.stderr.trim();
    if (/not a git repository/i.test(message)) {
      return {
        ok: false,
        cwd: normalized,
        error: `Workspace bukan git repository: ${normalized}`,
      };
    }
    return {
      ok: false,
      cwd: normalized,
      error: message || `git rev-parse gagal (exit ${result.code}) untuk ${normalized}`,
    };
  } catch (error) {
    return {
      ok: false,
      cwd: normalized,
      error: `${(error as Error).message} (cwd: ${normalized})`,
    };
  }
}

export async function getStatus(cwd: string): Promise<GitStatus> {
  const output = await git(cwd, ["status", "--porcelain=v1", "-b"]);
  const staged: GitFile[] = [];
  const unstaged: GitFile[] = [];
  const untracked: GitFile[] = [];
  let branch = "";
  let ahead = 0;
  let behind = 0;

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      const header = line.slice(3);
      const tracking = header.split("...")[0];
      branch = (tracking.split(" ")[0] ?? "").trim();
      if (!branch) {
        const match = /^No commits yet on (.+)$/.exec(header);
        branch = match?.[1]?.trim() ?? "HEAD";
      }
      ahead = Number(/ahead (\d+)/.exec(header)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(header)?.[1] ?? 0);
      continue;
    }

    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ").pop() ?? path;
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    if (!path) continue;

    const isUntracked = code === "??";
    const index = code[0] ?? " ";
    const worktree = code[1] ?? " ";
    const isStaged = !isUntracked && index !== " " && index !== "?";
    const isUnstaged = !isUntracked && worktree !== " " && worktree !== "?";

    if (isStaged) staged.push({ path, status: code, staged: true, untracked: false });
    if (isUnstaged) unstaged.push({ path, status: code, staged: false, untracked: false });
    if (isUntracked) untracked.push({ path, status: code, staged: false, untracked: true });
  }

  return {
    branch: branch || "HEAD",
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
  };
}

export async function listBranches(cwd: string): Promise<GitBranch[]> {
  const output = await git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%09%(HEAD)",
    "refs/heads",
  ]);
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split("\t");
      return { name: name ?? line, current: (head ?? "").trim() === "*" };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
}

export async function listCommits(cwd: string, limit = 50): Promise<GitCommit[]> {
  const result = await execGit(cwd, [
    "log",
    `-n`,
    String(limit),
    "--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%D",
    "--date=iso-strict",
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash = "", author = "", date = "", subject = "", refs = ""] = line.split("\x1f");
      return {
        hash,
        short: hash.slice(0, 7),
        subject,
        author,
        date,
        refs: refs.trim(),
      };
    });
}

export async function getDiff(cwd: string, path: string, staged: boolean): Promise<string> {
  const abs = resolveWithin(cwd, path);
  if (!abs) throw new Error("Path di luar workspace.");
  const result = await execGit(cwd, [
    "diff",
    "--no-color",
    ...(staged ? ["--cached"] : []),
    "--",
    path,
  ]);
  if (result.code === 0 && result.stdout) return result.stdout;

  if (!staged) {
    try {
      const content = await Deno.readTextFile(abs);
      const lines = content.split(/\r?\n/).map((line) => `+${line}`).join("\n");
      return `--- /dev/null\n+++ b/${path}\n${lines}`;
    } catch {
      // fall through
    }
  }
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git exited with code ${result.code}`);
  }
  return "";
}

export function checkedPaths(cwd: string, paths: string[]): string[] {
  return paths.map((path) => {
    if (!resolveWithin(cwd, path)) throw new Error(`Path di luar workspace: ${path}`);
    return path;
  });
}

export async function stagePaths(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, ["add", "--", ...checkedPaths(cwd, paths)]);
}

export async function unstagePaths(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, ["reset", "HEAD", "--", ...checkedPaths(cwd, paths)]);
}

export async function commit(cwd: string, message: string): Promise<string> {
  return (await git(cwd, ["commit", "-m", message])).trim();
}

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  const branches = await listBranches(cwd);
  if (!branches.some((item) => item.name === branch)) {
    throw new Error("Branch tidak ditemukan.");
  }
  await git(cwd, ["checkout", branch]);
}
