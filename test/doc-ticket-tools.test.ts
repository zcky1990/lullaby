import { equal } from "node:assert/strict";

const dataDir = await Deno.makeTempDir();
Deno.env.set("RND_APP_DATA_DIR", dataDir);

const db = await import("../src/db/db.ts");
db.closeDb();

const { closeDb, createLocalTicket, createProject, listLocalTickets } = db;
const { createLocalDocument } = await import("../src/fs/documents.ts");
const {
  createDocumentTool,
  getDocumentTool,
  listDocumentsTool,
  updateDocumentTool,
} = await import("../src/server/chat/document-tools.ts");
const {
  getTicketTool,
  listTicketsTool,
  updateTicketTool,
} = await import("../src/server/chat/ticket-tools.ts");
const { CHAT_TOOL_CATALOG, toolsFor } = await import("../src/server/chat/tools.ts");

Deno.test("CHAT_TOOL_CATALOG includes document and ticket tools", () => {
  const names = new Set(CHAT_TOOL_CATALOG.map((tool) => tool.name));
  for (
    const name of [
      "list_documents",
      "get_document",
      "create_document",
      "update_document",
      "sync_document",
      "list_tickets",
      "get_ticket",
      "update_ticket",
      "delete_ticket",
      "sync_ticket",
      "transition_ticket",
    ]
  ) {
    equal(names.has(name), true, name);
  }
});

Deno.test("document tools list/create/get/update local docs", async () => {
  const docsRoot = await Deno.makeTempDir();
  const project = await createProject({
    id: crypto.randomUUID(),
    name: "Docs Project",
    documentPath: docsRoot,
  });
  await createLocalDocument(docsRoot, "Hello Doc");

  const listed = JSON.parse(await listDocumentsTool(project.id, { source: "local" }));
  equal(listed.configured, true);
  equal(listed.documents.length >= 1, true);

  const created = JSON.parse(
    await createDocumentTool(project.id, { source: "local", title: "Second" }),
  );
  equal(created.document.title, "Second");
  const path = created.document.path as string;

  const got = JSON.parse(
    await getDocumentTool(project.id, { source: "local", path }),
  );
  equal(got.document.path, path);

  const updated = JSON.parse(
    await updateDocumentTool(project.id, {
      source: "local",
      path,
      content: "# Second\n\nupdated body\n",
    }),
  );
  equal(typeof updated.document.content, "string");
  equal(updated.document.content.includes("updated body"), true);

  await Deno.remove(docsRoot, { recursive: true });
});

Deno.test("ticket tools list/get/update local tickets", async () => {
  const project = await createProject({
    id: crypto.randomUUID(),
    name: "Ticket Tools Project",
  });
  const ticket = await createLocalTicket(project.id, {
    title: "Local task",
    description: "<p>body</p>",
    status: "Backlog",
  });

  const listed = JSON.parse(await listTicketsTool(project.id));
  equal(Array.isArray(listed.tickets), true);
  equal(listed.tickets.some((row: { localId?: string }) => row.localId === ticket.id), true);

  const got = JSON.parse(await getTicketTool(project.id, { id: ticket.id }));
  equal(got.ticket.localId, ticket.id);
  equal(got.ticket.summary, "Local task");

  const updated = JSON.parse(
    await updateTicketTool(project.id, { id: ticket.id, status: "To Do", title: "Renamed" }),
  );
  equal(updated.ticket.status, "To Do");
  equal(updated.ticket.summary, "Renamed");

  const rows = await listLocalTickets(project.id);
  equal(rows.find((row) => row.id === ticket.id)?.title, "Renamed");
});

Deno.test("toolsFor exposes doc/ticket reads without workspace", () => {
  const plan = toolsFor(null, "plan", false);
  equal(plan.some((tool) => tool.name === "list_documents"), true);
  equal(plan.some((tool) => tool.name === "list_tickets"), true);
  equal(plan.some((tool) => tool.name === "create_document"), false);
  const build = toolsFor(null, "build", false);
  equal(build.some((tool) => tool.name === "create_document"), true);
  equal(build.some((tool) => tool.name === "write_file"), false);
});

Deno.test({
  name: "doc-ticket-tools: cleanup temp data dir",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    closeDb();
    Deno.env.delete("RND_APP_DATA_DIR");
    await Deno.remove(dataDir, { recursive: true });
  },
});
