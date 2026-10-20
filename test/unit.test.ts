import { equal, throws } from "node:assert/strict";
import {
  ChatInput,
  JiraConfig,
  LlmProviderInput,
  LocalTicketInput,
  LocalTicketUpdateInput,
  ProjectInput,
} from "../src/config/schema.ts";
import { htmlToAdf, htmlToPlainText, sanitizeHtml } from "../src/core/html.ts";
import { diffLines } from "../src/server/diff.ts";

Deno.test("ProjectInput trims and drops empty optional fields", () => {
  throws(() => ProjectInput.parse({ name: "" }));
  const parsed = ProjectInput.parse({ name: "  Checkout ", docmostSpaceId: "" });
  equal(parsed.name, "Checkout");
  equal(parsed.docmostSpaceId, undefined);
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
