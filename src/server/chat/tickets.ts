import type { LlmProviderRow } from "../../db/db.ts";
import { complete, VARIANT_TEMPERATURE } from "./llm.ts";
import { executeTool, TICKET_TOOL } from "./tools.ts";
import type { CreatedTicket, Run } from "./types.ts";

const TICKET_GENERATION_PROMPT =
  "You generate actionable implementation tickets from a document. Read the document and call " +
  "create_ticket for each ticket (1-5 tickets). Each ticket needs a short imperative title, a " +
  "description containing context and acceptance criteria, a sensible priority (Low/Medium/High/Urgent), " +
  "and a type (Task/Bug/Story). Status should usually be 'To Do'. Tickets are stored locally and " +
  "synced to Jira later by the user. Only use create_ticket; do not describe tickets without " +
  "creating them. When finished, reply with a short summary.";

export async function generateTicketsFromDocument(
  projectId: string,
  provider: LlmProviderRow,
  title: string,
  content: string,
  variant = "medium",
): Promise<{ tickets: CreatedTicket[]; message: string }> {
  const run: Run = {
    id: crypto.randomUUID(),
    provider,
    workspace: null,
    sessionId: "",
    temperature: VARIANT_TEMPERATURE[variant],
    turns: [
      { role: "system", content: TICKET_GENERATION_PROMPT },
      {
        role: "user",
        content: `Document: ${title}\n\n${content.slice(0, 30_000)}`,
      },
    ],
    pendingBatch: [],
    pendingChanges: new Map(),
    batchResults: new Map(),
    changes: [],
    projectId,
    mode: "build",
    skills: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
  };

  for (let step = 0; step < 5; step++) {
    const response = await complete(provider, run.turns, [TICKET_TOOL], run.temperature);
    if (response.toolCalls.length === 0) {
      return { tickets: run.createdTickets, message: response.text };
    }
    run.turns.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });
    for (const call of response.toolCalls) {
      let result: string;
      if (call.name !== "create_ticket") {
        result = "Tool tidak tersedia. Gunakan create_ticket.";
      } else {
        try {
          result = await executeTool(run, call);
        } catch (error) {
          result = `Error: ${(error as Error).message}`;
        }
      }
      run.turns.push({ role: "tool", toolCallId: call.id, content: result });
    }
    if (run.createdTickets.length >= 10) break;
  }
  return {
    tickets: run.createdTickets,
    message: run.createdTickets.length ? "Tiket dibuat." : "(tidak ada tiket yang dibuat)",
  };
}
