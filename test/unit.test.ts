import { equal, rejects, throws } from "node:assert/strict";
import {
  ChatInput,
  GenerateTicketsInput,
  JiraConfig,
  LlmProviderInput,
  LocalTicketInput,
  LocalTicketUpdateInput,
  McpSettingsInput,
  ProjectInput,
  UpdateFileInput,
} from "../src/config/schema.ts";
import { htmlToAdf, htmlToPlainText, sanitizeHtml } from "../src/core/html.ts";
import {
  createLocalDocument,
  listLocalDocuments,
  readLocalDocument,
  slugifyDocumentTitle,
  updateLocalDocument,
} from "../src/fs/documents.ts";
import { applyHunks, diffHunks, diffLines } from "../src/server/diff.ts";
import { parseSkillFile } from "../src/server/skills.ts";

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
