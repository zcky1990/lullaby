import { dirname, join, resolve } from "node:path";
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

export interface GitRemoteBranch {
  name: string;
  remote: string;
  shortName: string;
}

export interface GitStash {
  index: number;
  label: string;
  message: string;
}

function isSafeRefName(name: string): boolean {
  const value = name.trim();
  if (!value || value.length > 200) return false;
  if (value.includes("..") || value.startsWith("-") || value.includes("\0")) return false;
  return /^[A-Za-z0-9._/\-@{}]+$/.test(value);
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  refs: string;
}

export interface GitCommitDetail {
  hash: string;
  short: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  refs: string;
  diff: string;
}

const MAX_SHOW_DIFF_CHARS = 60_000;

function truncateDiff(text: string, max = MAX_SHOW_DIFF_CHARS): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n\n…(diff truncated)`;
}

function isSafeGitHash(hash: string): boolean {
  return /^[0-9a-fA-F]{7,40}$/.test(hash.trim());
}

export async function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await execGit(cwd, args);
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

export async function listRemoteBranches(cwd: string): Promise<GitRemoteBranch[]> {
  const result = await execGit(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes",
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => !name.endsWith("/HEAD") && name !== "HEAD")
    .map((name) => {
      const slash = name.indexOf("/");
      const remote = slash > 0 ? name.slice(0, slash) : name;
      const shortName = slash > 0 ? name.slice(slash + 1) : name;
      return { name, remote, shortName };
    })
    .sort((a, b) => a.remote.localeCompare(b.remote) || a.shortName.localeCompare(b.shortName));
}

export async function listStashes(cwd: string): Promise<GitStash[]> {
  const result = await execGit(cwd, [
    "stash",
    "list",
    "--format=%gd%x1f%s",
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [label = "", message = ""] = line.split("\x1f");
      const match = /stash@\{(\d+)\}/.exec(label);
      const index = match ? Number(match[1]) : 0;
      return {
        index: Number.isFinite(index) ? index : 0,
        label: label.trim() || `stash@{${index}}`,
        message: message.trim() || "(tanpa pesan)",
      };
    });
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

export async function showCommit(cwd: string, hash: string): Promise<GitCommitDetail> {
  const id = hash.trim();
  if (!isSafeGitHash(id)) throw new Error("Hash commit tidak valid.");

  const meta = await execGit(cwd, [
    "show",
    "-s",
    "--no-color",
    "--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%D",
    "--date=iso-strict",
    id,
  ]);
  if (meta.code !== 0) {
    throw new Error(meta.stderr.trim() || `Commit tidak ditemukan: ${id}`);
  }

  const [full = "", author = "", date = "", subject = "", refs = ""] = meta.stdout.split("\x1f");

  const bodyResult = await execGit(cwd, [
    "show",
    "-s",
    "--no-color",
    "--pretty=format:%b",
    id,
  ]);
  const body = bodyResult.code === 0 ? bodyResult.stdout.trim() : "";

  const patch = await execGit(cwd, ["show", "--no-color", "--pretty=format:", id]);
  if (patch.code !== 0) {
    throw new Error(patch.stderr.trim() || `Gagal memuat diff commit: ${id}`);
  }

  return {
    hash: full || id,
    short: (full || id).slice(0, 7),
    subject: subject.trim(),
    body,
    author: author.trim(),
    date: date.trim(),
    refs: refs.trim(),
    diff: truncateDiff(patch.stdout),
  };
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
  const name = branch.trim();
  if (!isSafeRefName(name)) throw new Error("Nama branch tidak valid.");

  const locals = await listBranches(cwd);
  if (locals.some((item) => item.name === name)) {
    await git(cwd, ["checkout", name]);
    return;
  }

  const remotes = await listRemoteBranches(cwd);
  const remote = remotes.find((item) => item.name === name);
  if (!remote) throw new Error("Branch tidak ditemukan.");

  if (locals.some((item) => item.name === remote.shortName)) {
    await git(cwd, ["checkout", remote.shortName]);
    return;
  }

  await git(cwd, ["checkout", "-b", remote.shortName, "--track", remote.name]);
}

export async function applyStash(cwd: string, index: number, pop = false): Promise<void> {
  if (!Number.isInteger(index) || index < 0 || index > 100) {
    throw new Error("Index stash tidak valid.");
  }
  const ref = `stash@{${index}}`;
  await git(cwd, ["stash", pop ? "pop" : "apply", ref]);
}

export async function fetchRemote(cwd: string): Promise<string> {
  const result = await execGit(cwd, ["fetch", "--all", "--prune"]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git fetch gagal");
  }
  return (result.stdout || result.stderr).trim() || "Fetch selesai.";
}

export async function pull(cwd: string): Promise<string> {
  const result = await execGit(cwd, ["pull", "--no-edit"]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git pull gagal");
  }
  return (result.stdout || result.stderr).trim() || "Pull selesai.";
}

export async function push(cwd: string): Promise<string> {
  const result = await execGit(cwd, ["push"]);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    if (/no upstream|has no upstream/i.test(detail)) {
      const status = await getStatus(cwd);
      const branch = status.branch;
      if (!isSafeRefName(branch) || branch === "HEAD") {
        throw new Error(detail || "Branch tidak punya upstream.");
      }
      const retry = await execGit(cwd, ["push", "-u", "origin", branch]);
      if (retry.code !== 0) {
        throw new Error(retry.stderr.trim() || retry.stdout.trim() || "git push gagal");
      }
      return (retry.stdout || retry.stderr).trim() || `Push + set upstream origin/${branch}.`;
    }
    throw new Error(detail || "git push gagal");
  }
  return (result.stdout || result.stderr).trim() || "Push selesai.";
}

export async function createBranch(
  cwd: string,
  name: string,
  checkout = true,
): Promise<void> {
  const branch = name.trim();
  if (!isSafeRefName(branch) || branch.includes("..")) {
    throw new Error("Nama branch tidak valid.");
  }
  const locals = await listBranches(cwd);
  if (locals.some((item) => item.name === branch)) {
    throw new Error(`Branch sudah ada: ${branch}`);
  }
  if (checkout) await git(cwd, ["checkout", "-b", branch]);
  else await git(cwd, ["branch", branch]);
}

export async function mergeBranch(cwd: string, branch: string): Promise<string> {
  const name = branch.trim();
  if (!isSafeRefName(name)) throw new Error("Nama branch tidak valid.");
  const locals = await listBranches(cwd);
  if (!locals.some((item) => item.name === name)) {
    throw new Error("Branch lokal tidak ditemukan.");
  }
  if (locals.some((item) => item.current && item.name === name)) {
    throw new Error("Tidak bisa merge branch yang sedang aktif.");
  }
  const result = await execGit(cwd, ["merge", "--no-edit", name]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git merge gagal");
  }
  return (result.stdout || result.stderr).trim() || `Merged ${name}.`;
}

export async function createStash(
  cwd: string,
  message?: string,
  includeUntracked = true,
): Promise<string> {
  const args = ["stash", "push"];
  if (includeUntracked) args.push("-u");
  const note = message?.trim();
  if (note) {
    if (note.length > 200) throw new Error("Pesan stash terlalu panjang.");
    args.push("-m", note);
  }
  const result = await execGit(cwd, args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git stash gagal");
  }
  return (result.stdout || result.stderr).trim() || "Stash dibuat.";
}

export type CloneProtocol = "https" | "ssh";

export function isSafeGitUrl(url: string): boolean {
  const value = url.trim();
  if (!value || value.length > 2000) return false;
  if (/[\0\s;$`|"'<>]/.test(value)) return false;
  if (value.includes("\\")) return false;
  if (/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i.test(value)) return true;
  return /^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(\.git)?$/.test(value);
}

function parseGitRemote(url: string): { host: string; path: string } | null {
  const value = url.trim().replace(/\.git$/i, "");
  if (!value) return null;

  if (/^git@/i.test(value)) {
    const colon = value.indexOf(":");
    if (colon <= 4) return null;
    const host = value.slice(4, colon);
    const path = value.slice(colon + 1).replace(/^\/+/, "");
    if (!host || !path) return null;
    return { host, path };
  }

  if (/^ssh:\/\//i.test(value)) {
    const without = value.replace(/^ssh:\/\//i, "").replace(/^git@/i, "");
    const slash = without.indexOf("/");
    if (slash <= 0) return null;
    return {
      host: without.slice(0, slash),
      path: without.slice(slash + 1).replace(/^\/+/, ""),
    };
  }

  if (/^https?:\/\//i.test(value) || /^git:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const path = parsed.pathname.replace(/^\/+/, "");
      if (!parsed.hostname || !path) return null;
      return { host: parsed.hostname, path };
    } catch {
      return null;
    }
  }

  if (/^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/.test(value)) {
    return { host: "github.com", path: value };
  }

  return null;
}

export function normalizeCloneUrl(url: string, protocol: CloneProtocol): string {
  const remote = parseGitRemote(url);
  if (!remote) throw new Error("URL git tidak valid.");
  const path = remote.path.replace(/\.git$/i, "");
  if (!path || /[\0\s;$`|"'<>\\]/.test(path) || path.includes("..")) {
    throw new Error("URL git tidak valid.");
  }
  if (protocol === "ssh") return `git@${remote.host}:${path}.git`;
  return `https://${remote.host}/${path}.git`;
}

async function assertCloneTargetEmpty(target: string): Promise<void> {
  const existing = await Deno.stat(target).catch(() => null);
  if (!existing) return;
  if (!existing.isDirectory) {
    throw new Error(`Path workspace bukan folder: ${target}`);
  }
  const entries = [];
  for await (const entry of Deno.readDir(target)) {
    if (entry.name === "." || entry.name === "..") continue;
    if (entry.name === ".DS_Store") continue;
    entries.push(entry.name);
  }
  if (entries.length > 0) {
    throw new Error(
      `Folder workspace tidak kosong (${
        entries.slice(0, 5).join(", ")
      }). Kosongkan dulu atau pilih path lain.`,
    );
  }
}

export async function cloneRepository(
  url: string,
  targetPath: string,
  protocol: CloneProtocol = "https",
): Promise<{ path: string; output: string; url: string }> {
  const resolvedUrl = normalizeCloneUrl(url, protocol);
  if (!isSafeGitUrl(resolvedUrl)) throw new Error("URL git tidak valid.");

  const target = normalizeWorkspacePath(targetPath);
  const parent = dirname(target);
  const parentStat = await Deno.stat(parent).catch(() => null);
  if (!parentStat?.isDirectory) {
    throw new Error(`Folder parent workspace tidak ditemukan: ${parent}`);
  }

  await assertCloneTargetEmpty(target);

  const targetStat = await Deno.stat(target).catch(() => null);
  let result: { code: number; stdout: string; stderr: string };
  if (targetStat?.isDirectory) {
    result = await execGit(target, ["clone", "--", resolvedUrl, "."]);
  } else {
    result = await execGit(parent, ["clone", "--", resolvedUrl, target]);
  }

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git clone gagal");
  }

  const check = await checkGitRepository(target);
  if (!check.ok) {
    throw new Error(check.error ?? `Clone selesai tapi bukan git repository: ${target}`);
  }

  return {
    path: check.cwd,
    url: resolvedUrl,
    output: (result.stdout || result.stderr).trim() || `Cloned ke ${check.cwd}`,
  };
}
