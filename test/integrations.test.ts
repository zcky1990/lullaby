import { equal, rejects } from "node:assert/strict";
import {
  ConfluenceConfig,
  type DocmostConfig,
  type JiraConfig,
  NotionConfig,
  parseIntegrationConfig,
} from "../src/config/schema.ts";
import {
  getDocument as getConfluenceDocument,
  listDocuments as listConfluenceDocuments,
} from "../src/integrations/confluence.ts";
import { getDocument, listDocuments } from "../src/integrations/docmost.ts";
import {
  createTicket,
  getTicket,
  listTickets,
  transitionTicket,
} from "../src/integrations/jira.ts";
import {
  getDocument as getNotionDocument,
  listDocuments as listNotionDocuments,
} from "../src/integrations/notion.ts";

const TOKEN = "Bearer tok";

function startMock(handler: (req: Request) => Response | Promise<Response>) {
  let resolvePort!: (port: number) => void;
  const portPromise = new Promise<number>((resolve) => (resolvePort = resolve));
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen: ({ port }) => resolvePort(port) },
    handler,
  );
  return { server, port: portPromise };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

Deno.test("docmost: listDocuments follows nested tree and lazy children", async () => {
  const { server, port } = startMock((req) => {
    if (req.headers.get("authorization") !== TOKEN) return json({ error: "unauth" }, 401);
    const { pathname } = new URL(req.url);
    if (pathname === "/api/pages/sidebar-pages") {
      return json({
        data: {
          items: [
            {
              id: "p1",
              title: "Home",
              hasChildren: true,
              children: [{ id: "p2", title: "Child" }],
            },
            { id: "p3", title: "Standalone", hasChildren: false },
          ],
        },
      });
    }
    if (pathname === "/api/pages/info") return json({ data: { title: "Home", content: "# Hi" } });
    return new Response("nf", { status: 404 });
  });
  const cfg: DocmostConfig = {
    baseUrl: `http://127.0.0.1:${await port}`,
    apiToken: "tok",
    spaceId: "sp_1",
    workspace: undefined,
  };
  const { documents } = await listDocuments(cfg);
  equal(documents.length, 2);
  equal(documents[0].title, "Home");
  equal(documents[0].hasChildren, true);
  equal(documents[0].children?.[0].title, "Child");
  equal(documents[1].hasChildren, false);

  const doc = await getDocument(cfg, "p1");
  equal(doc.content, "# Hi");
  await server.shutdown();
});

Deno.test("jira: listTickets via GET search/jql, detail, transition", async () => {
  const { server, port } = startMock((req) => {
    if (req.headers.get("authorization") !== "Basic Ym90OnRr") return json({ e: 1 }, 401);
    const { pathname } = new URL(req.url);
    if (pathname.endsWith("/search/jql")) {
      return json({
        issues: [
          {
            key: "PROJ-1",
            fields: { summary: "Fix", status: { name: "To Do" }, priority: { name: "High" } },
          },
        ],
      });
    }
    if (pathname.endsWith("/issue/PROJ-1/transitions") && req.method === "GET") {
      return json({ transitions: [{ id: "31", name: "Finish", to: { name: "Done" } }] });
    }
    if (pathname.endsWith("/issue/PROJ-1/transitions") && req.method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (pathname.endsWith("/issue/PROJ-1")) {
      return json({
        key: "PROJ-1",
        fields: {
          summary: "Fix login",
          status: { name: "To Do" },
          priority: { name: "High" },
          assignee: { displayName: "Ana" },
          reporter: { displayName: "Bob" },
          issuetype: { name: "Bug" },
          labels: ["x"],
          description: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
          },
        },
      });
    }
    return new Response("nf", { status: 404 });
  });
  const cfg: JiraConfig = {
    baseUrl: `http://127.0.0.1:${await port}`,
    deployment: "cloud",
    cloudId: undefined,
    projectKey: "PROJ",
    email: "bot",
    apiToken: "tk",
  };

  const tickets = await listTickets(cfg);
  equal(tickets[0].key, "PROJ-1");
  equal(tickets[0].status, "To Do");

  const detail = await getTicket(cfg, "PROJ-1");
  equal(detail.type, "Bug");
  equal(detail.description.trim(), "Body");

  await transitionTicket(cfg, "PROJ-1", "Done");
  await rejects(() => transitionTicket(cfg, "PROJ-1", "Nonexistent"));
  await server.shutdown();
});

Deno.test("jira: createTicket posts issue and returns key", async () => {
  let body = "";
  const { server, port } = startMock(async (req) => {
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("Basic ") && auth !== TOKEN) {
      return json({ error: "unauth" }, 401);
    }
    const { pathname } = new URL(req.url);
    if (pathname.endsWith("/issue") && req.method === "POST") {
      body = await req.text();
      return json({ key: "PROJ-9", id: "10009" }, 201);
    }
    return new Response("nf", { status: 404 });
  });
  const cfg: JiraConfig = {
    baseUrl: `http://127.0.0.1:${await port}`,
    deployment: "cloud",
    cloudId: undefined,
    projectKey: "PROJ",
    email: "bot",
    apiToken: "tk",
  };
  const created = await createTicket(cfg, {
    summary: "New ticket",
    description: "<p>Hello</p>",
    type: "Task",
    priority: "High",
  });
  equal(created.key, "PROJ-9");
  equal(body.includes("New ticket"), true);
  await server.shutdown();
});

Deno.test("schema: NotionConfig and ConfluenceConfig parse", () => {
  const notion = NotionConfig.safeParse({ apiToken: "secret_x", parentPageId: "" });
  equal(notion.success, true);
  if (notion.success) equal(notion.data.parentPageId, undefined);

  const confluence = ConfluenceConfig.safeParse({
    baseUrl: "https://acme.atlassian.net/wiki",
    email: "bot@example.com",
    apiToken: "tok",
    spaceKey: "ENG",
  });
  equal(confluence.success, true);

  const notionKind = parseIntegrationConfig("notion", { apiToken: "ntn_1" });
  equal(notionKind.success, true);
  const confluenceKind = parseIntegrationConfig("confluence", {
    baseUrl: "https://acme.atlassian.net",
    email: "a@b.c",
    apiToken: "t",
  });
  equal(confluenceKind.success, true);
});

Deno.test("notion: listDocuments children + getDocument blocks", async () => {
  const { server, port } = startMock((req) => {
    if (req.headers.get("authorization") !== "Bearer secret_tok") {
      return json({ error: "unauth" }, 401);
    }
    if (req.headers.get("notion-version") !== "2022-06-28") {
      return json({ error: "version" }, 400);
    }
    const { pathname } = new URL(req.url);
    if (pathname === "/v1/blocks/parent-1/children") {
      return json({
        results: [
          {
            object: "block",
            id: "page-1",
            type: "child_page",
            child_page: { title: "Spec" },
            has_children: false,
          },
        ],
        has_more: false,
      });
    }
    if (pathname === "/v1/pages/page-1") {
      return json({
        object: "page",
        id: "page-1",
        properties: {
          title: { type: "title", title: [{ plain_text: "Spec" }] },
        },
      });
    }
    if (pathname === "/v1/blocks/page-1/children") {
      return json({
        results: [
          {
            object: "block",
            id: "b1",
            type: "heading_1",
            heading_1: { rich_text: [{ plain_text: "Hello" }] },
            has_children: false,
          },
          {
            object: "block",
            id: "b2",
            type: "paragraph",
            paragraph: { rich_text: [{ plain_text: "World" }] },
            has_children: false,
          },
        ],
        has_more: false,
      });
    }
    return new Response("nf", { status: 404 });
  });

  const base = `http://127.0.0.1:${await port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input).replace("https://api.notion.com", base);
    return originalFetch(url, init);
  };

  try {
    const cfg = { apiToken: "secret_tok", parentPageId: "parent-1" };
    const { documents } = await listNotionDocuments(cfg);
    equal(documents.length, 1);
    equal(documents[0].title, "Spec");
    equal(documents[0].hasChildren, true);

    const doc = await getNotionDocument(cfg, "page-1");
    equal(doc.title, "Spec");
    equal(doc.content.includes("# Hello"), true);
    equal(doc.content.includes("World"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await server.shutdown();
  }
});

Deno.test("confluence: list spaces/pages and getDocument", async () => {
  const { server, port } = startMock((req) => {
    if (req.headers.get("authorization") !== "Basic Ym90QGUuY29tOnRr") {
      return json({ error: "unauth" }, 401);
    }
    const { pathname, searchParams } = new URL(req.url);
    if (pathname === "/wiki/rest/api/space") {
      return json({
        results: [{ key: "ENG", name: "Engineering" }],
        size: 1,
        limit: 50,
      });
    }
    if (pathname === "/wiki/rest/api/content" && searchParams.get("spaceKey") === "ENG") {
      return json({
        results: [
          {
            id: "100",
            title: "Home",
            ancestors: [],
            children: { page: { size: 1 } },
          },
        ],
        size: 1,
        limit: 50,
      });
    }
    if (pathname === "/wiki/rest/api/content/100/child/page") {
      return json({
        results: [{ id: "101", title: "Child", children: { page: { size: 0 } } }],
        size: 1,
        limit: 50,
      });
    }
    if (pathname === "/wiki/rest/api/content/100") {
      return json({
        id: "100",
        title: "Home",
        space: { key: "ENG" },
        body: {
          storage: { value: "<h1>Welcome</h1><p>Body text</p>" },
        },
      });
    }
    return new Response("nf", { status: 404 });
  });

  const cfg: ConfluenceConfig = {
    baseUrl: `http://127.0.0.1:${await port}/wiki`,
    email: "bot@e.com",
    apiToken: "tk",
    spaceKey: undefined,
  };

  const spaces = await listConfluenceDocuments(cfg);
  equal(spaces.documents.length, 1);
  equal(spaces.documents[0].id, "space:ENG");
  equal(spaces.documents[0].title, "Engineering");

  const pages = await listConfluenceDocuments(cfg, "space:ENG");
  equal(pages.documents.length, 1);
  equal(pages.documents[0].title, "Home");

  const children = await listConfluenceDocuments(cfg, "100");
  equal(children.documents[0].title, "Child");

  const doc = await getConfluenceDocument(cfg, "100");
  equal(doc.title, "Home");
  equal(doc.content.includes("# Welcome"), true);
  equal(doc.content.includes("Body text"), true);
  await server.shutdown();
});

Deno.test("confluence: rejects getDocument on space id", async () => {
  const cfg: ConfluenceConfig = {
    baseUrl: "https://acme.atlassian.net/wiki",
    email: "bot@e.com",
    apiToken: "tk",
    spaceKey: undefined,
  };
  await rejects(() => getConfluenceDocument(cfg, "space:ENG"), /halaman/i);
});
