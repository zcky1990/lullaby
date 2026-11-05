import { join } from "node:path";
import { appDataDir, ensureAppDataDir } from "../core/paths.ts";
import { log } from "../core/logger.ts";

const KEY_BYTES = 32;
const ENV_KEY = "RND_SECRETS_KEY";
const KEY_FILE = ".master.key";
const KEYCHAIN_SERVICE = "Lullaby Master Key";
const KEYCHAIN_ACCOUNT = "lullaby";

let cached: Uint8Array | null = null;

function decodeKeyMaterial(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const binary = atob(trimmed);
    if (binary.length === KEY_BYTES) {
      const out = new Uint8Array(KEY_BYTES);
      for (let i = 0; i < KEY_BYTES; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
  } catch {
    // not base64
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    const out = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) {
      out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return null;
}

function encodeKeyBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function keyFilePath(): string {
  return join(appDataDir(), KEY_FILE);
}

async function readKeyFile(): Promise<Uint8Array | null> {
  try {
    const text = await Deno.readTextFile(keyFilePath());
    return decodeKeyMaterial(text);
  } catch {
    return null;
  }
}

async function writeKeyFile(bytes: Uint8Array): Promise<void> {
  await ensureAppDataDir();
  const path = keyFilePath();
  await Deno.writeTextFile(path, encodeKeyBase64(bytes) + "\n", { mode: 0o600 });
  try {
    await Deno.chmod(path, 0o600);
  } catch {
    // Windows / some FS ignore chmod
  }
}

async function runSecurity(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const cmd = new Deno.Command("security", {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    const stdout = new TextDecoder().decode(result.stdout).trim();
    return { ok: result.success, stdout };
  } catch (error) {
    log.debug("keychain security CLI unavailable", { error: String(error) });
    return { ok: false, stdout: "" };
  }
}

async function readKeychain(): Promise<Uint8Array | null> {
  if (Deno.build.os !== "darwin") return null;
  const found = await runSecurity([
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    KEYCHAIN_ACCOUNT,
    "-w",
  ]);
  if (!found.ok || !found.stdout) return null;
  return decodeKeyMaterial(found.stdout);
}

async function writeKeychain(bytes: Uint8Array): Promise<boolean> {
  if (Deno.build.os !== "darwin") return false;
  const encoded = encodeKeyBase64(bytes);
  const added = await runSecurity([
    "add-generic-password",
    "-U",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    KEYCHAIN_ACCOUNT,
    "-w",
    encoded,
  ]);
  return added.ok;
}

function generateKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/** Test helper — clear in-memory cache between suites. */
export function resetMasterKeyCache(): void {
  cached = null;
}

export async function getMasterKeyBytes(): Promise<Uint8Array> {
  if (cached) return cached;

  const fromEnv = Deno.env.get(ENV_KEY)?.trim();
  if (fromEnv) {
    const decoded = decodeKeyMaterial(fromEnv);
    if (!decoded) {
      throw new Error(`${ENV_KEY} must be 32-byte key as base64 or hex`);
    }
    cached = decoded;
    return cached;
  }

  // Prefer the local file — spawning `security` on every launch is slow and can
  // block on Keychain UI. Keychain remains a backup / initial source.
  const fromFile = await readKeyFile();
  if (fromFile) {
    cached = fromFile;
    return cached;
  }

  const fromKeychain = await readKeychain();
  if (fromKeychain) {
    cached = fromKeychain;
    try {
      await writeKeyFile(fromKeychain);
    } catch (error) {
      log.debug("could not mirror master key to file", { error: String(error) });
    }
    return cached;
  }

  const created = generateKey();
  await writeKeyFile(created);
  const storedInKeychain = await writeKeychain(created);
  cached = created;
  log.info("created secrets master key", {
    storage: storedInKeychain ? "file+keychain" : "file",
  });
  return cached;
}
