import { equal, notEqual, ok } from "node:assert/strict";

const dataDir = await Deno.makeTempDir();
Deno.env.set("RND_APP_DATA_DIR", dataDir);
Deno.env.set(
  "RND_SECRETS_KEY",
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
);

const { resetMasterKeyCache } = await import("../src/secrets/master-key.ts");
resetMasterKeyCache();

const { decryptString, encryptString, isEncryptedSecret } = await import(
  "../src/secrets/crypto.ts"
);
const {
  decryptConfigSecrets,
  encryptConfigSecrets,
  encryptSecretValue,
  decryptSecretValue,
} = await import("../src/secrets/fields.ts");
const { migratePlaintextSecrets, SECRETS_MIGRATED_KEY } = await import(
  "../src/secrets/migrate.ts"
);
const db = await import("../src/db/db.ts");
db.closeDb();

const {
  closeDb,
  createLlmProvider,
  createProject,
  getAppSetting,
  getDb,
  getIntegration,
  getLlmProvider,
  setAppSetting,
  upsertIntegration,
} = db;

Deno.test("secrets: aes-gcm roundtrip and prefix", async () => {
  const { getMasterKeyBytes } = await import("../src/secrets/master-key.ts");
  const key = await getMasterKeyBytes();
  const cipher = await encryptString("super-secret-token", key);
  ok(isEncryptedSecret(cipher));
  equal(await decryptString(cipher, key), "super-secret-token");
  equal(await encryptString(cipher, key), cipher);
});

Deno.test("secrets: integration config encrypted at rest, plaintext on read", async () => {
  const project = await createProject({
    id: crypto.randomUUID(),
    name: "Secrets Project",
  });
  await upsertIntegration({
    id: crypto.randomUUID(),
    projectId: project.id,
    kind: "jira",
    mode: "api",
    config: {
      baseUrl: "https://example.atlassian.net",
      email: "dev@example.com",
      apiToken: "plain-jira-token",
      projectKey: "ABC",
    },
  });

  const decoded = await getIntegration(project.id, "jira");
  const decodedConfig = JSON.parse(decoded!.config) as Record<string, unknown>;
  equal(decodedConfig.apiToken, "plain-jira-token");

  const raw = (await getDb()).prepare(
    "SELECT config FROM project_integrations WHERE project_id = ? AND kind = ?",
  ).get(project.id, "jira") as { config: string };
  const stored = JSON.parse(raw.config) as Record<string, unknown>;
  ok(typeof stored.apiToken === "string" && isEncryptedSecret(stored.apiToken as string));
  equal(stored.email, "dev@example.com");
});

Deno.test("secrets: llm api_key encrypted at rest", async () => {
  const provider = await createLlmProvider({
    id: crypto.randomUUID(),
    name: "Encrypted LLM",
    provider: "openai",
    model: "gpt-test",
    apiKey: "sk-test-plain",
    mode: "api",
  });
  const read = await getLlmProvider(provider.id);
  equal(read?.api_key, "sk-test-plain");

  const raw = (await getDb()).prepare(
    "SELECT api_key FROM llm_providers WHERE id = ?",
  ).get(provider.id) as { api_key: string };
  ok(isEncryptedSecret(raw.api_key));
  notEqual(raw.api_key, "sk-test-plain");
});

Deno.test("secrets: migrate plaintext rows once", async () => {
  await setAppSetting(SECRETS_MIGRATED_KEY, "false");
  const project = await createProject({
    id: crypto.randomUUID(),
    name: "Migrate Project",
  });
  const dbSync = await getDb();
  const integrationId = crypto.randomUUID();
  dbSync.prepare(
    `INSERT INTO project_integrations (id, project_id, kind, mode, config, updated_at)
     VALUES (?, ?, 'github', 'api', ?, datetime('now'))`,
  ).run(
    integrationId,
    project.id,
    JSON.stringify({
      baseUrl: "https://api.github.com",
      token: "ghp_plaintext",
      org: "acme",
      repo: "app",
    }),
  );
  const llmId = crypto.randomUUID();
  dbSync.prepare(
    `INSERT INTO llm_providers
       (id, name, provider, model, base_url, api_key, mode, config)
     VALUES (?, 'Mig', 'openai', 'm', null, 'plain-key', 'api', '{}')`,
  ).run(llmId);

  const first = await migratePlaintextSecrets();
  ok(first.updated >= 2);
  equal(await getAppSetting(SECRETS_MIGRATED_KEY), "true");

  const second = await migratePlaintextSecrets();
  equal(second.updated, 0);

  const integration = await getIntegration(project.id, "github");
  equal(JSON.parse(integration!.config).token, "ghp_plaintext");
  equal((await getLlmProvider(llmId))?.api_key, "plain-key");
});

Deno.test("secrets: encryptConfigSecrets is idempotent", async () => {
  const once = await encryptConfigSecrets({ apiToken: "abc", spaceId: "s1" });
  const twice = await encryptConfigSecrets(once);
  equal(twice.apiToken, once.apiToken);
  equal(twice.spaceId, "s1");
  const plain = await decryptConfigSecrets(twice);
  equal(plain.apiToken, "abc");
});

Deno.test("secrets: null/empty secret values stay empty", async () => {
  equal(await encryptSecretValue(null), null);
  equal(await encryptSecretValue(""), "");
  equal(await decryptSecretValue(null), null);
});

Deno.test({
  name: "secrets: cleanup",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    closeDb();
    resetMasterKeyCache();
    Deno.env.delete("RND_APP_DATA_DIR");
    Deno.env.delete("RND_SECRETS_KEY");
    await Deno.remove(dataDir, { recursive: true });
  },
});
