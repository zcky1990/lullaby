import { dirname, join } from "node:path";

/**
 * Cursor SDK local agents need a `ripgrep` binary for their `grep`/`glob` tools.
 * The SDK does not bundle one for Deno, so the app has to tell it where `rg`
 * lives (`configureRipgrepPath()` / `configureCursorSdk({ local })`).
 *
 * Resolution order: env override → `PATH` → common install dirs → binaries
 * shipped next to the SDK package.
 */

const ENV_KEYS = ["CURSOR_RIPGREP_PATH", "RIPGREP_PATH"];
const BINARY = Deno.build.os === "windows" ? "rg.exe" : "rg";

function isFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

function pathEntries(): string[] {
  const raw = Deno.env.get("PATH") ?? Deno.env.get("Path") ?? "";
  const separator = Deno.build.os === "windows" ? ";" : ":";
  return raw.split(separator).map((item) => item.trim()).filter(Boolean);
}

function homeDir(): string | null {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  return home?.trim() || null;
}

/** Absolute paths tried in order; env vars win so users can point at their own build. */
export function ripgrepCandidates(): string[] {
  const candidates: string[] = [];
  for (const key of ENV_KEYS) {
    const value = Deno.env.get(key)?.trim();
    if (value) candidates.push(value);
  }
  for (const dir of pathEntries()) candidates.push(join(dir, BINARY));
  const home = homeDir();
  if (home) {
    candidates.push(join(home, ".cargo", "bin", BINARY));
    candidates.push(join(home, ".local", "bin", BINARY));
    candidates.push(join(home, "bin", BINARY));
  }
  if (Deno.build.os === "darwin") {
    candidates.push("/opt/homebrew/bin/rg");
    candidates.push("/usr/local/bin/rg");
    candidates.push("/opt/local/bin/rg");
    candidates.push("/usr/bin/rg");
  } else if (Deno.build.os === "linux") {
    candidates.push("/usr/bin/rg");
    candidates.push("/usr/local/bin/rg");
    candidates.push("/snap/bin/rg");
    candidates.push("/bin/rg");
  }
  return candidates;
}

/** Triple-style folder names used by prebuilt ripgrep distributions. */
function platformTargets(): string[] {
  const os = Deno.build.os === "windows" ? "windows" : Deno.build.os;
  const arch = Deno.build.arch;
  const arches = arch === "aarch64"
    ? ["aarch64", "arm64"]
    : arch === "x86_64"
    ? ["x86_64", "x64"]
    : [arch];
  const targets: string[] = [];
  for (const item of arches) {
    targets.push(`${os}-${item}`, `${item}-${os}`);
    if (Deno.build.os === "darwin") targets.push(`${item}-apple-darwin`);
    if (Deno.build.os === "linux") {
      targets.push(`${item}-unknown-linux-gnu`, `${item}-unknown-linux-musl`);
    }
    if (Deno.build.os === "windows") targets.push(`${item}-pc-windows-msvc`);
  }
  return targets;
}

/** Binaries that ship next to the SDK package (npm layout), when present. */
export function sdkRipgrepCandidates(): string[] {
  let entry: string;
  try {
    const url = import.meta.resolve("@cursor/sdk");
    if (!url.startsWith("file:")) return [];
    entry = decodeURIComponent(new URL(url).pathname);
  } catch {
    return [];
  }
  const dist = dirname(entry);
  const pkg = dirname(dist);
  const roots = [pkg, dist, dirname(pkg)];
  const layouts = [
    join("vendor", "ripgrep"),
    join("vendor", "rg"),
    "ripgrep",
    "bin",
    join("dist", "bin"),
    join("resources", "ripgrep"),
    join("node_modules", "@vscode", "ripgrep", "bin"),
    join("..", "@vscode", "ripgrep", "bin"),
  ];
  const targets = platformTargets();
  const candidates: string[] = [];
  for (const root of roots) {
    for (const layout of layouts) {
      candidates.push(join(root, layout, BINARY));
      for (const target of targets) candidates.push(join(root, layout, target, BINARY));
    }
  }
  return candidates;
}

/** First existing ripgrep binary, or `null` when the machine has none. */
export function resolveRipgrepPath(): string | null {
  for (const candidate of [...ripgrepCandidates(), ...sdkRipgrepCandidates()]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

type RipgrepConfigurator = (path: string) => void;

/**
 * The SDK exports the setter as `configureRipgrepPath()`; accept any exported
 * function whose name mentions ripgrep so SDK renames do not break the app.
 */
export function findRipgrepConfigurator(sdk: Record<string, unknown>): RipgrepConfigurator | null {
  for (const [name, value] of Object.entries(sdk)) {
    if (typeof value !== "function") continue;
    if (!/ripgrep/i.test(name)) continue;
    if (!/config|path|register|set/i.test(name)) continue;
    return value as RipgrepConfigurator;
  }
  return null;
}

export interface RipgrepSetup {
  /** Resolved binary path (`null` when ripgrep is not installed). */
  path: string | null;
  /** `true` when the SDK setter was found and called. */
  configured: boolean;
}

/** Point the SDK at `path` (or resolve one) and report what happened. */
export function configureSdkRipgrep(
  sdk: Record<string, unknown>,
  path: string | null = resolveRipgrepPath(),
): RipgrepSetup {
  if (!path) return { path: null, configured: false };
  const configure = findRipgrepConfigurator(sdk);
  if (!configure) return { path, configured: false };
  configure(path);
  return { path, configured: true };
}

export const RIPGREP_INSTALL_HINT =
  "Install ripgrep (`brew install ripgrep` / `apt install ripgrep`) atau set " +
  "CURSOR_RIPGREP_PATH ke binary `rg`, lalu restart aplikasi.";
