import { equal, rejects } from "node:assert/strict";
import {
  ClickUpConfig,
  ConfluenceConfig,
  type DocmostConfig,
  type JiraConfig,
  NotionConfig,
  parseIntegrationConfig,
} from "../src/config/schema.ts";
import {
  createTicket as createClickUpTicket,
  getTicket as getClickUpTicket,
  listTickets as listClickUpTickets,
  transitionTicket as transitionClickUpTicket,
} from "../src/integrations/clickup.ts";
import {
  createDocument as createConfluenceDocument,
  getDocument as getConfluenceDocument,
  listDocuments as listConfluenceDocuments,
  updateDocument as updateConfluenceDocument,
} from "../src/integrations/confluence.ts";
import { getDocument, listDocuments } from "../src/integrations/docmost.ts";
import {
  createTicket,
  getTicket,
  listTickets,
  transitionTicket,
} from "../src/integrations/jira.ts";
import { markdownToConfluenceStorage, markdownToNotionBlocks } from "../src/integrations/markdown.ts";
import {
  createDocument as createNotionDocument,
  getDocument as getNotionDocument,
  listDocuments as listNotionDocuments,
  updateDocument as updateNotionDocument,
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

Deno.test("markdown helpers convert headings and lists", () => {
  const blocks = markdownToNotionBlocks("# Title\n\n- a\n- b\n\n```ts\nconst x = 1\n```\n");
  equal(blocks.some((block) => block.type === "heading_1"), true);
  equal(blocks.some((block) => block.type === "bulleted_list_item"), true);
  equal(blocks.some((block) => block.type === "code"), true);
  const html = markdownToConfluenceStorage("## Hi\n\n1. one\n2. two\n");
  equal(html.includes("<h2>Hi</h2>"), true);
  equal(html.includes("<ol>"), true);
});

Deno.test("notion: createDocument and updateDocument", async () => {
  const deleted: string[] = [];
  const { server, port } = startMock(async (req) => {
    if (req.headers.get("authorization") !== "Bearer secret_tok") {
      return json({ error: "unauth" }, 401);
    }
    const { pathname } = new URL(req.url);
    if (pathname === "/v1/pages" && req.method === "POST") {
      const body = await req.json() as { parent?: { page_id?: string }; properties?: unknown };
      equal(body.parent?.page_id, "parent-1");
      return json({ object: "page", id: "new-page", properties: body.properties });
    }
    if (pathname === "/v1/pages/new-page" && req.method === "PATCH") {
      return json({ object: "page", id: "new-page" });
    }
    if (pathname === "/v1/pages/new-page" && req.method === "GET") {
      return json({
        object: "page",
        id: "new-page",
        properties: {
          title: { type: "title", title: [{ plain_text: "Updated" }] },
        },
      });
    }
    if (pathname === "/v1/blocks/new-page/children" && req.method === "GET") {
      return json({
        results: [
          { object: "block", id: "old-1", type: "paragraph", paragraph: {}, has_children: false },
        ],
        has_more: false,
      });
    }
    if (pathname === "/v1/blocks/old-1" && req.method === "DELETE") {
      deleted.push("old-1");
      return json({ id: "old-1", archived: true });
    }
    if (pathname === "/v1/blocks/new-page/children" && req.method === "PATCH") {
      return json({ results: [] });
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
    const created = await createNotionDocument(cfg, { title: "New", content: "Hello" });
    equal(created.id, "new-page");
    const updated = await updateNotionDocument(cfg, {
      pageId: "new-page",
      title: "Updated",
      content: "# Hi",
    });
    equal(updated.title, "Updated");
    equal(deleted.includes("old-1"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await server.shutdown();
  }
});

Deno.test("confluence: createDocument and updateDocument", async () => {
  const { server, port } = startMock(async (req) => {
    if (req.headers.get("authorization") !== "Basic Ym90QGUuY29tOnRr") {
      return json({ error: "unauth" }, 401);
    }
    const { pathname } = new URL(req.url);
    if (pathname === "/wiki/rest/api/content" && req.method === "POST") {
      const body = await req.json() as { title?: string; space?: { key?: string } };
      equal(body.space?.key, "ENG");
      return json({ id: "200", title: body.title, space: { key: "ENG" } });
    }
    if (pathname === "/wiki/rest/api/content/200" && req.method === "GET") {
      return json({
        id: "200",
        title: "Home",
        space: { key: "ENG" },
        version: { number: 3 },
        body: { storage: { value: "<p>Old</p>" }, view: { value: "<p>Old</p>" } },
      });
    }
    if (pathname === "/wiki/rest/api/content/200" && req.method === "PUT") {
      const body = await req.json() as { version?: { number?: number }; title?: string };
      equal(body.version?.number, 4);
      return json({ id: "200", title: body.title });
    }
    return new Response("nf", { status: 404 });
  });

  const cfg: ConfluenceConfig = {
    baseUrl: `http://127.0.0.1:${await port}/wiki`,
    email: "bot@e.com",
    apiToken: "tk",
    spaceKey: "ENG",
  };
  const created = await createConfluenceDocument(cfg, { title: "Home", content: "Hi" });
  equal(created.id, "200");
  const updated = await updateConfluenceDocument(cfg, {
    pageId: "200",
    title: "Home",
    content: "## New",
  });
  equal(updated.id, "200");
  await server.shutdown();
});

Deno.test("clickup: list/get/create/transition tasks", async () => {
  let createdBody = "";
  let transitionBody = "";
  const { server, port } = startMock(async (req) => {
    if (req.headers.get("authorization") !== "pk_test") return json({ error: "unauth" }, 401);
    const { pathname } = new URL(req.url);
    if (pathname === "/list/901/task" && req.method === "GET") {
      return json({
        tasks: [{
          id: "abc123",
          name: "Ship board",
          status: { status: "to do" },
          priority: { id: "2", priority: "high" },
          assignees: [{ username: "Ana" }],
          url: "https://app.clickup.com/t/abc123",
        }],
        last_page: true,
      });
    }
    if (pathname === "/task/abc123" && req.method === "GET") {
      return json({
        id: "abc123",
        name: "Ship board",
        status: { status: "to do" },
        description: "Detail body",
        tags: [{ name: "board" }],
        date_created: "1700000000000",
        date_updated: "1700000001000",
        url: "https://app.clickup.com/t/abc123",
      });
    }
    if (pathname === "/list/901/task" && req.method === "POST") {
      createdBody = await req.text();
      return json({ id: "new99", url: "https://app.clickup.com/t/new99" }, 200);
    }
    if (pathname === "/list/901" && req.method === "GET") {
      return json({
        statuses: [{ status: "to do" }, { status: "in progress" }, { status: "complete" }],
      });
    }
    if (pathname === "/task/abc123" && req.method === "PUT") {
      transitionBody = await req.text();
      return json({ id: "abc123" });
    }
    return new Response("nf", { status: 404 });
  });

  const cfg = ClickUpConfig.parse({
    apiToken: "pk_test",
    listId: "901",
    apiBase: `http://127.0.0.1:${await port}`,
  });

  const tickets = await listClickUpTickets(cfg);
  equal(tickets[0]?.key, "abc123");
  equal(tickets[0]?.status, "to do");
  equal(tickets[0]?.priority, "High");
  equal(tickets[0]?.source, "clickup");

  const detail = await getClickUpTicket(cfg, "abc123");
  equal(detail.description, "Detail body");
  equal(detail.labels[0], "board");

  const created = await createClickUpTicket(cfg, {
    summary: "New task",
    description: "<p>Hello</p>",
    priority: "High",
  });
  equal(created.key, "new99");
  const parsedCreate = JSON.parse(createdBody) as { name?: string; priority?: number };
  equal(parsedCreate.name, "New task");
  equal(parsedCreate.priority, 2);

  await transitionClickUpTicket(cfg, "abc123", "In Progress");
  const parsedTransition = JSON.parse(transitionBody) as { status?: string };
  equal(parsedTransition.status, "in progress");

  await rejects(() => transitionClickUpTicket(cfg, "abc123", "Nonexistent Status"));
  await server.shutdown();
});

Deno.test("parseIntegrationConfig accepts clickup", () => {
  const parsed = parseIntegrationConfig("clickup", {
    apiToken: "pk_x",
    listId: "123",
  });
  equal(parsed.success, true);
});
