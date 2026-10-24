import { equal, rejects } from "node:assert/strict";
import { getDocument, listDocuments } from "../src/integrations/docmost.ts";
import type { DocmostConfig } from "../src/config/schema.ts";
import {
  createTicket,
  getTicket,
  listTickets,
  transitionTicket,
} from "../src/integrations/jira.ts";
import type { JiraConfig } from "../src/config/schema.ts";

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
