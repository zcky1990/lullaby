import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  AutomationSettingsInput,
  TerminalSettingsInput,
  ChatInput,
  GenerateTicketsInput,
  JiraConfig,
  LlmProviderInput,
  LocalTicketInput,
  LocalTicketUpdateInput,
  McpSettingsInput,
  ProjectInput,
  RoleInput,
  TicketTransitionInput,
  UpdateFileInput,
} from "../src/config/schema.ts";
import {
  buildAutoBuildPrompt,
  canonicalTicketColumn,
  isTodoToInProgress,
} from "../src/tickets/status.ts";
import { htmlToAdf, htmlToPlainText, sanitizeHtml } from "../src/core/html.ts";
import {
  createLocalDocument,
  listLocalDocuments,
  readLocalDocument,
  slugifyDocumentTitle,
  updateLocalDocument,
} from "../src/fs/documents.ts";
import { resolveWithin } from "../src/fs/workspace.ts";
import {
  checkedPaths,
  normalizeWorkspacePath,
  showCommit,
} from "../src/integrations/git.ts";
import {
  decideAllChatChanges,
  decideChatChange,
  seedPendingWriteForTest,
} from "../src/server/chat.ts";
import { applyHunks, diffHunks, diffLines } from "../src/server/diff.ts";
import { handleRequest } from "../src/server/router.ts";
import { APP_TOKEN_HEADER, appToken } from "../src/server/session.ts";
import { activeSkillPrompt, systemPrompt } from "../src/server/chat/agent.ts";
import {
  buildSkillMarkdown,
  extractSkillEvidence,
  skillNameFromEvidence,
  writeProjectSkill,
} from "../src/server/chat/skill-learn.ts";
import {
  detectSlashQuery,
  isAutoskillCommand,
  parseSlashSkill,
} from "../src/server/chat/slash-skill.ts";
import type { Run } from "../src/server/chat/types.ts";
import { runAutoskills } from "../src/server/autoskills.ts";
import { defaultCodeReviewUserMessage } from "../src/server/code-review.ts";
import {
  builtinSkillsDir,
  listSkills,
  parseSkillFile,
  projectSkillsDir,
  projectSlug,
} from "../src/server/skills.ts";

Deno.test("ProjectInput trims and drops empty optional fields", () => {
  throws(() => ProjectInput.parse({ name: "" }));
  const parsed = ProjectInput.parse({ name: "  Checkout ", docmostSpaceId: "" });
  equal(parsed.name, "Checkout");
  equal(parsed.docmostSpaceId, undefined);
  const withDocs = ProjectInput.parse({ name: "Docs", documentPath: "/tmp/docs" });
  equal(withDocs.documentPath, "/tmp/docs");
});

Deno.test("JiraConfig applies defaults and validates input", () => {
  const cfg = JiraConfig.parse({ baseUrl: "https://acme.atlassian.net", projectKey: "PROJ" });
  equal(cfg.deployment, "cloud");
  throws(() => JiraConfig.parse({ baseUrl: "not-a-url", projectKey: "PROJ" }));
  const noKey = JiraConfig.parse({ baseUrl: "https://acme.atlassian.net" });
  equal(noKey.projectKey, "");
});

Deno.test("LlmProviderInput supports multiple providers and defaults", () => {
  const a = LlmProviderInput.parse({ name: "Anthropic", provider: "anthropic" });
  equal(a.name, "Anthropic");
  equal(a.provider, "anthropic");
  equal(a.mode, "api");
  equal(a.baseUrl, undefined);

  const b = LlmProviderInput.parse({ name: "Ollama", provider: "ollama", baseUrl: "" });
  equal(b.baseUrl, undefined);

  const c = LlmProviderInput.parse({
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  });
  equal(c.baseUrl, "https://api.openai.com/v1");

  throws(() => LlmProviderInput.parse({ name: "" }));
  throws(() => LlmProviderInput.parse({ name: "X", baseUrl: "not-a-url" }));
});

Deno.test("diffLines reports added and removed lines", () => {
  const result = diffLines("one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n");
  equal(result.added, 2);
  equal(result.removed, 1);
  equal(result.diff.includes("-two"), true);
  equal(result.diff.includes("+TWO"), true);
  equal(result.diff.includes("+four"), true);
});

Deno.test("diffLines handles new and empty files", () => {
  const created = diffLines("", "a\nb");
  equal(created.added, 2);
  equal(created.removed, 0);
  const same = diffLines("same", "same");
  equal(same.added, 0);
  equal(same.removed, 0);
});

Deno.test("parseSlashSkill extracts skill and remaining text", () => {
  deepEqual(parseSlashSkill("/form-login tighten styles"), {
    skillName: "form-login",
    text: "tighten styles",
    command: null,
  });
  deepEqual(parseSlashSkill("/form-login"), {
    skillName: "form-login",
    text: "",
    command: null,
  });
  deepEqual(parseSlashSkill("no slash here"), {
    skillName: null,
    text: "no slash here",
    command: null,
  });
  deepEqual(detectSlashQuery("hello /cre", 10), { active: true, query: "cre", start: 6 });
  equal(detectSlashQuery("hello world").active, false);
});

Deno.test("parseSlashSkill treats /autoskill as reserved command", () => {
  deepEqual(parseSlashSkill("/autoskill"), {
    skillName: null,
    text: "",
    command: "autoskill",
  });
  deepEqual(parseSlashSkill("/autoskill please"), {
    skillName: null,
    text: "please",
    command: "autoskill",
  });
  equal(isAutoskillCommand("/autoskill"), true);
  equal(isAutoskillCommand("/form-login"), false);
});

Deno.test("parseSlashSkill extracts /code-review as skill", () => {
  deepEqual(parseSlashSkill("/code-review"), {
    skillName: "code-review",
    text: "",
    command: null,
  });
  deepEqual(parseSlashSkill("/code-review focus security"), {
    skillName: "code-review",
    text: "focus security",
    command: null,
  });
});

Deno.test("defaultCodeReviewUserMessage strips default skill chatter", () => {
  const ctx = "Branch: main\n\nWorking tree clean.";
  const plain = defaultCodeReviewUserMessage("Ikuti skill /code-review.", ctx);
  equal(plain.includes("Additional request"), false);
  equal(plain.includes("Repository change context"), true);
  equal(plain.includes(ctx), true);
  equal(plain.includes("code review mindset"), true);

  const withExtra = defaultCodeReviewUserMessage("focus on auth", ctx);
  equal(withExtra.includes("Additional request:\nfocus on auth"), true);
});

Deno.test("listSkills includes builtin code-review", async () => {
  const skills = await listSkills(null, null);
  const review = skills.find((skill) => skill.name === "code-review");
  equal(Boolean(review), true);
  equal(review?.source, "builtin");
  equal(review?.path.startsWith(builtinSkillsDir()), true);
});


Deno.test("runAutoskills rejects missing workspace path", async () => {
  const missing = await runAutoskills("/tmp/rnd-workflow-no-such-workspace-dir");
  equal(missing.ok, false);
  equal(Boolean(missing.error), true);

  const empty = await runAutoskills("   ");
  equal(empty.ok, false);
  equal(empty.error?.includes("kosong"), true);
});

Deno.test("ChatInput accepts skillName", () => {
  const parsed = ChatInput.parse({
    skillName: "fix-login",
    messages: [{ role: "user", content: "Tighten styles" }],
  });
  equal(parsed.skillName, "fix-login");
  throws(() =>
    ChatInput.parse({
      skillName: "bad name",
      messages: [{ role: "user", content: "x" }],
    })
  );
});

Deno.test("systemPrompt injects active skill body", () => {
  const prompt = systemPrompt(
    "/tmp/ws",
    "build",
    [{ id: "project:demo", name: "demo", description: "d", source: "project", path: "/x" }],
    undefined,
    { name: "demo", body: "Always use tabs." },
  );
  equal(prompt.includes("Active skill: demo"), true);
  equal(prompt.includes("Always use tabs."), true);
  equal(prompt.includes(activeSkillPrompt("demo", "Always use tabs.")), true);
});

Deno.test("ChatInput accepts message attachments", () => {
  const parsed = ChatInput.parse({
    messages: [{
      role: "user",
      content: "lihat ini",
      attachments: [{
        type: "image",
        name: "screen.png",
        mime: "image/png",
        data: "data:image/png;base64,AAAA",
      }],
    }],
  });
  equal(parsed.variant, "medium");
  equal(parsed.messages[0].attachments?.length, 1);
  throws(() =>
    ChatInput.parse({
      messages: [{
        role: "user",
        content: "x",
        attachments: [{ type: "image", name: "a.png", data: "" }],
      }],
    })
  );
});

Deno.test("ChatInput accepts workspace path attachments", () => {
  const parsed = ChatInput.parse({
    messages: [{
      role: "user",
      content: "baca file",
      attachments: [{ type: "workspace", name: "note.md", path: "docs/note.md" }],
    }],
  });
  equal(parsed.messages[0].attachments?.[0].path, "docs/note.md");
  throws(() =>
    ChatInput.parse({
      messages: [{
        role: "user",
        content: "x",
        attachments: [{ type: "workspace", name: "note.md" }],
      }],
    })
  );
});

Deno.test("LocalTicketInput validates status and defaults", () => {
  const parsed = LocalTicketInput.parse({ title: " Bug dropdown " });
  equal(parsed.title, "Bug dropdown");
  equal(parsed.status, "Backlog");
  equal(parsed.type, "Task");
  throws(() => LocalTicketInput.parse({ title: "" }));
  throws(() => LocalTicketInput.parse({ title: "x", status: "Doing" }));
  const updated = LocalTicketUpdateInput.parse({ status: "Done" });
  equal(updated.status, "Done");
});

Deno.test("sanitizeHtml strips scripts, handlers, and unsafe links", () => {
  const html = sanitizeHtml(
    '<p onclick="x()">Hi <b>there</b><script>alert(1)</script>' +
      '<img src=x onerror=1><a href="javascript:alert(1)">x</a>' +
      '<a href="https://example.com">y</a></p>',
  );
  equal(html.includes("<script"), false);
  equal(html.includes("onclick"), false);
  equal(html.includes("onerror"), false);
  equal(html.includes("javascript:"), false);
  equal(html.includes('href="https://example.com"'), true);
  equal(html.startsWith("<p>"), true);
});

Deno.test("htmlToAdf converts headings, marks, and lists", () => {
  const doc = htmlToAdf(
    "<h2>Judul</h2><p>Halo <strong>dunia</strong></p><ul><li>Satu</li><li>Dua</li></ul>",
  ) as {
    type: string;
    content: Array<{
      type: string;
      attrs?: { level?: number };
      content?: Array<{ type: string; marks?: Array<{ type: string }> }>;
    }>;
  };
  equal(doc.type, "doc");
  equal(doc.content[0].type, "heading");
  equal(doc.content[0].attrs?.level, 2);
  equal(doc.content[1].type, "paragraph");
  equal(doc.content[1].content?.[1].marks?.[0].type, "strong");
  equal(doc.content[2].type, "bulletList");
  equal(doc.content[2].content?.length, 2);
});

Deno.test("htmlToPlainText keeps block content", () => {
  const text = htmlToPlainText("<p>Halo</p><ul><li>satu</li><li>dua</li></ul>");
  equal(text.includes("Halo"), true);
  equal(text.includes("• satu"), true);
  equal(text.includes("• dua"), true);
});

Deno.test("ChatInput supports plan and build modes", () => {
  const base = { messages: [{ role: "user", content: "halo" }] };
  equal(ChatInput.parse(base).mode, "build");
  equal(ChatInput.parse({ ...base, mode: "plan" }).mode, "plan");
  throws(() => ChatInput.parse({ ...base, mode: "design" }));
});

Deno.test("local documents create, list, rename, and guard paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    equal(slugifyDocumentTitle("Hello World!"), "hello-world");
    equal(slugifyDocumentTitle("!!!"), "document");

    const created = await createLocalDocument(dir, "Hello World");
    equal(created.path, "hello-world.md");
    equal(created.title, "Hello World");

    const list = await listLocalDocuments(dir);
    equal(list.length, 1);
    equal(list[0].path, "hello-world.md");

    const updated = await updateLocalDocument(dir, created.path, {
      title: "Judul Baru",
      content: "# Judul Baru\n\nisi dokumen",
    });
    equal(updated.path, "judul-baru.md");
    equal(updated.content.includes("isi dokumen"), true);

    const after = await listLocalDocuments(dir);
    equal(after[0].path, "judul-baru.md");
    equal(after[0].title, "Judul Baru");

    const read = await readLocalDocument(dir, "judul-baru.md");
    equal(read.title, "Judul Baru");

    const second = await createLocalDocument(dir, "Hello World");
    equal(second.path, "hello-world.md");

    await rejects(readLocalDocument(dir, "../escape.md"), /di luar/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("McpSettingsInput validates stdio and http servers", () => {
  const parsed = McpSettingsInput.parse({
    servers: [
      { name: "fs", transport: "stdio", command: "npx", args: ["-y", "server"] },
      { name: "remote", transport: "http", url: "https://example.com/mcp" },
    ],
  });
  equal(parsed.servers[0].transport, "stdio");
  equal(parsed.servers[0].enabled, true);
  equal(parsed.servers[1].enabled, true);

  throws(() => McpSettingsInput.parse({ servers: [{ name: "x", transport: "stdio" }] }));
  throws(() =>
    McpSettingsInput.parse({
      servers: [{ name: "x", transport: "http", url: "not-a-url" }],
    })
  );
});

Deno.test("parseSkillFile reads frontmatter and normalizes name", () => {
  const parsed = parseSkillFile(
    "---\nname: Demo Skill\ndescription: Does demo things\n---\n\n# Title\n\nBody text.",
    "fallback",
  );
  equal(parsed.name, "demo-skill");
  equal(parsed.description, "Does demo things");
  equal(parsed.body.includes("Body text."), true);
  equal(parsed.body.includes("description:"), false);
});

Deno.test("parseSkillFile falls back to folder name and first paragraph", () => {
  const parsed = parseSkillFile("# Heading\n\nUse this for X.", "my-skill");
  equal(parsed.name, "my-skill");
  equal(parsed.description, "Use this for X.");
});

Deno.test("McpSettingsInput carries global state defaults", () => {
  const parsed = McpSettingsInput.parse({
    servers: [{ name: "fs", transport: "stdio", command: "npx" }],
  });
  equal(parsed.enabled, true);
  equal(parsed.disabledTools.length, 0);
  const withState = McpSettingsInput.parse({
    servers: [],
    enabled: false,
    disabledTools: ["s1:read"],
  });
  equal(withState.enabled, false);
  equal(withState.disabledTools[0], "s1:read");
});

Deno.test("GenerateTicketsInput requires title and defaults variant", () => {
  const parsed = GenerateTicketsInput.parse({ title: " PRD ", content: "isi" });
  equal(parsed.title, "PRD");
  equal(parsed.variant, "medium");
  throws(() => GenerateTicketsInput.parse({ title: "", content: "x" }));
});

Deno.test("UpdateFileInput validates editor writes", () => {
  const parsed = UpdateFileInput.parse({ path: " src/a.ts ", content: "x" });
  equal(parsed.path, "src/a.ts");
  throws(() => UpdateFileInput.parse({ path: "", content: "x" }));
});

Deno.test("LocalTicketUpdateInput allows clearing priority", () => {
  const parsed = LocalTicketUpdateInput.parse({ priority: null });
  equal(parsed.priority, null);
});

Deno.test("diffHunks splits distant changes and applyHunks accepts a subset", () => {
  const before = Array.from({ length: 20 }, (_, index) => `line${index + 1}`).join("\n") + "\n";
  const changed = before.replace("line1", "LINE1").replace("line20", "LINE20");
  const result = diffHunks(before, changed);
  equal(result.hunks.length, 2);

  const onlyFirst = applyHunks(before, result.hunks, new Set([0]), true);
  equal(onlyFirst.includes("LINE1"), true);
  equal(onlyFirst.includes("line20"), true);
  equal(onlyFirst.includes("LINE20"), false);

  const all = applyHunks(before, result.hunks, new Set([0, 1]), true);
  equal(all, changed);

  const none = applyHunks(before, result.hunks, new Set(), true);
  equal(none, before);
});

Deno.test("diffHunks handles new files", () => {
  const result = diffHunks("", "alpha\nbeta\n");
  equal(result.hunks.length, 1);
  equal(result.added, 2);
  const applied = applyHunks("", result.hunks, new Set([0]), true);
  equal(applied, "alpha\nbeta\n");
});

Deno.test("RoleInput validates persona and provider id", () => {
  const parsed = RoleInput.parse({ name: "Backend", persona: "Senior backend" });
  equal(parsed.name, "Backend");
  throws(() => RoleInput.parse({ name: "X", persona: "" }));
  const withProvider = RoleInput.parse({
    name: "X",
    persona: "p",
    providerId: "prov-1",
  });
  equal(withProvider.providerId, "prov-1");
});

Deno.test("TicketTransitionInput validates status", () => {
  equal(TicketTransitionInput.parse({ status: " Done " }).status, "Done");
  throws(() => TicketTransitionInput.parse({ status: "" }));
  throws(() => TicketTransitionInput.parse({}));
});

Deno.test("resolveWithin rejects path traversal", async () => {
  const root = await Deno.makeTempDir();
  try {
    equal(resolveWithin(root, "src/app.ts"), resolve(root, "src/app.ts"));
    equal(resolveWithin(root, "../escape"), null);
    equal(resolveWithin(root, "foo/../../escape"), null);
    equal(resolveWithin(root, "."), resolve(root));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolveWithin rejects symlink escape", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(outside, "secret.txt"), "nope");
    await Deno.symlink(outside, join(root, "link"));
    equal(resolveWithin(root, "link/secret.txt"), null);
    equal(resolveWithin(root, "link"), null);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("API requires auth except health", async () => {
  const health = await handleRequest(new Request("http://127.0.0.1/api/health"));
  equal(health.status, 200);
  const body = await health.json() as { ok?: boolean; dataDir?: string };
  equal(body.ok, true);
  equal(body.dataDir, undefined);

  const projects = await handleRequest(new Request("http://127.0.0.1/api/projects"));
  equal(projects.status, 401);

  const mcp = await handleRequest(
    new Request("http://127.0.0.1/api/settings/mcp/tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  equal(mcp.status, 401);

  const skills = await handleRequest(new Request("http://127.0.0.1/api/skills"));
  equal(skills.status, 401);

  const withToken = await handleRequest(
    new Request("http://127.0.0.1/api/settings/mcp", {
      headers: { [APP_TOKEN_HEADER]: appToken() },
    }),
  );
  equal(withToken.status === 401, false);
});

Deno.test("decideChatChange accepts and rejects hunks against workspace", async () => {
  const root = await Deno.makeTempDir();
  try {
    const seeded = await seedPendingWriteForTest({
      workspace: root,
      path: "note.txt",
      before: "alpha\nbeta\n",
      after: "alpha\ngamma\n",
    });
    equal(seeded.hunkCount >= 1, true);

    const rejected = await decideAllChatChanges(seeded.runId, false);
    if (rejected.status === "error") throw new Error(rejected.error);
    equal(await Deno.readTextFile(join(root, "note.txt")), "alpha\nbeta\n");

    const seeded2 = await seedPendingWriteForTest({
      workspace: root,
      path: "note.txt",
      before: "alpha\nbeta\n",
      after: "alpha\ngamma\n",
    });
    const accepted = await decideAllChatChanges(seeded2.runId, true);
    if (accepted.status === "error") throw new Error(accepted.error);
    equal(await Deno.readTextFile(join(root, "note.txt")), "alpha\ngamma\n");

    const seeded3 = await seedPendingWriteForTest({
      workspace: root,
      path: "note.txt",
      before: "one\n",
      after: "two\n",
    });
    const one = await decideChatChange(seeded3.runId, seeded3.callId, 0, true);
    if (one.status === "error") throw new Error(one.error);
    equal(await Deno.readTextFile(join(root, "note.txt")), "two\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("showCommit rejects invalid hash", async () => {
  await rejects(() => showCommit("/tmp", "not-a-hash"));
  await rejects(() => showCommit("/tmp", "zzzzzzz"));
  await rejects(() => showCommit("/tmp", "../foo"));
});

Deno.test("GitStashApplyInput validates index", async () => {
  const { GitStashApplyInput } = await import("../src/config/schema.ts");
  equal(GitStashApplyInput.parse({ index: 0 }).pop, false);
  equal(GitStashApplyInput.parse({ index: 2, pop: true }).pop, true);
  throws(() => GitStashApplyInput.parse({ index: -1 }));
});

Deno.test("git checkedPaths rejects escapes and normalizes ~", async () => {
  equal(normalizeWorkspacePath("~").length > 1, true);
  const root = await Deno.makeTempDir();
  try {
    throws(() => checkedPaths(root, ["../escape"]));
    equal(checkedPaths(root, ["src/a.ts"])[0], "src/a.ts");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("terminal route requires auth", async () => {
  const res = await handleRequest(
    new Request("http://127.0.0.1/api/projects/demo/terminal"),
  );
  equal(res.status, 401);
});

Deno.test("parseTerminalSize clamps cols/rows from query", async () => {
  const { clampTerminalSize, parseTerminalSize, parseTerminalShell, resolveShellPath } =
    await import("../src/server/terminal.ts");
  deepEqual(parseTerminalSize("http://127.0.0.1/t?cols=120&rows=40"), { cols: 120, rows: 40 });
  deepEqual(clampTerminalSize(0, -1), { cols: 80, rows: 24 });
  deepEqual(clampTerminalSize(9999, 9999), { cols: 500, rows: 200 });
  equal(parseTerminalShell("http://127.0.0.1/t?shell=zsh"), "zsh");
  equal(parseTerminalShell("http://127.0.0.1/t?shell=bash"), "bash");
  equal(parseTerminalShell("http://127.0.0.1/t?shell=fish"), null);
  equal(parseTerminalShell("http://127.0.0.1/t"), null);
  const zsh = await resolveShellPath("zsh");
  const bash = await resolveShellPath("bash");
  equal(zsh.includes("zsh"), true);
  equal(bash.includes("bash"), true);
});

Deno.test("TerminalSettingsInput accepts zsh and bash", () => {
  equal(TerminalSettingsInput.parse({ shell: "zsh" }).shell, "zsh");
  equal(TerminalSettingsInput.parse({ shell: "bash" }).shell, "bash");
  throws(() => TerminalSettingsInput.parse({ shell: "fish" }));
});

Deno.test("projectSlug normalizes names and falls back to id", () => {
  equal(projectSlug("My Cool App"), "my-cool-app");
  equal(projectSlug("  "), "project-unknown");
  equal(projectSlug("", "abcdef12-9999"), "project-abcdef12");
});

Deno.test("skill-learn extracts evidence and builds markdown", () => {
  const run = {
    id: "run-1",
    provider: { id: "p" } as Run["provider"],
    workspace: "/tmp/ws",
    sessionId: "sess-abc12345",
    turns: [
      { role: "user", content: "Fix login button styles" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "1", name: "read_file", arguments: JSON.stringify({ path: "src/Login.tsx" }) },
          { id: "2", name: "write_file", arguments: JSON.stringify({ path: "src/Login.tsx" }) },
        ],
      },
    ],
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [{
      path: "src/Login.tsx",
      action: "update",
      diff: "",
      added: 1,
      removed: 0,
    }],
    projectId: "proj-1",
    mode: "build" as const,
    skills: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
  } satisfies Run;

  const evidence = extractSkillEvidence(run);
  equal(evidence !== null, true);
  equal(evidence!.goal.includes("Fix login"), true);
  equal(evidence!.files.includes("src/Login.tsx"), true);
  equal(evidence!.steps.some((step) => step.name === "write_file"), true);

  const name = skillNameFromEvidence(evidence!, run.sessionId);
  equal(name.includes("fix-login"), true);

  const md = buildSkillMarkdown(name, evidence!);
  equal(md.includes("name: "), true);
  equal(md.includes("## Goal"), true);
  equal(md.includes("src/Login.tsx"), true);
  equal(md.includes("Auto-generated"), true);
});

Deno.test("listSkills prefers workspace over project over global", async () => {
  const root = await Deno.makeTempDir();
  const previous = Deno.env.get("RND_APP_DATA_DIR");
  Deno.env.set("RND_APP_DATA_DIR", root);
  try {
    const slug = "demo-app";
    const workspace = await Deno.makeTempDir();
    const writeSkill = async (dir: string, name: string, description: string) => {
      const skillDir = join(dir, name);
      await Deno.mkdir(skillDir, { recursive: true });
      await Deno.writeTextFile(
        join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
      );
    };

    await writeSkill(join(root, "skills"), "shared-skill", "from global");
    await writeSkill(projectSkillsDir(slug), "shared-skill", "from project");
    await writeSkill(projectSkillsDir(slug), "project-only", "project only");
    await writeSkill(join(workspace, ".agents", "skills"), "shared-skill", "from workspace");

    const skills = await listSkills(workspace, slug);
    const shared = skills.find((skill) => skill.name === "shared-skill");
    const projectOnly = skills.find((skill) => skill.name === "project-only");
    equal(shared?.source, "workspace");
    equal(shared?.description, "from workspace");
    equal(projectOnly?.source, "project");

    const written = await writeProjectSkill(
      slug,
      "learned-task",
      buildSkillMarkdown("learned-task", {
        goal: "Add logging",
        steps: [{ name: "write_file", path: "src/log.ts" }],
        files: ["src/log.ts"],
        tickets: [],
      }),
    );
    equal(written.endsWith("SKILL.md"), true);
    const after = await listSkills(workspace, slug);
    equal(after.some((skill) => skill.name === "learned-task" && skill.source === "project"), true);
  } finally {
    if (previous === undefined) Deno.env.delete("RND_APP_DATA_DIR");
    else Deno.env.set("RND_APP_DATA_DIR", previous);
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("AutomationSettingsInput defaults autoBuildOnInProgress to false", () => {
  equal(AutomationSettingsInput.parse({}).autoBuildOnInProgress, false);
  equal(AutomationSettingsInput.parse({ autoBuildOnInProgress: true }).autoBuildOnInProgress, true);
});

Deno.test("ticket status helpers detect To Do to In Progress", () => {
  equal(canonicalTicketColumn("To Do"), "To Do");
  equal(canonicalTicketColumn("Doing"), "In Progress");
  equal(canonicalTicketColumn("In Development"), "In Progress");
  equal(isTodoToInProgress("To Do", "In Progress"), true);
  equal(isTodoToInProgress("Open", "Doing"), true);
  equal(isTodoToInProgress("Backlog", "In Progress"), false);
  equal(isTodoToInProgress("To Do", "Done"), false);
});

Deno.test("buildAutoBuildPrompt includes key summary and description", () => {
  const withDesc = buildAutoBuildPrompt({
    key: "PROJ-1",
    summary: "Fix login",
    description: "Users cannot sign in",
  });
  equal(withDesc.includes("PROJ-1"), true);
  equal(withDesc.includes("Fix login"), true);
  equal(withDesc.includes("Users cannot sign in"), true);

  const bare = buildAutoBuildPrompt({ key: "L-1", summary: "Tiny" });
  equal(bare.includes("Tiny"), true);
  equal(bare.includes("Implementasikan"), true);
});
