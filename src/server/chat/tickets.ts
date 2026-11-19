import type { LlmProviderRow } from "../../db/db.ts";
import { readTicketPrompt } from "../prompts.ts";
import { complete, VARIANT_TEMPERATURE } from "./llm.ts";
import { executeTool, TICKET_TOOL } from "./tools.ts";
import type { CreatedTicket, Run } from "./types.ts";

export async function generateTicketsFromDocument(
  projectId: string,
  provider: LlmProviderRow,
  title: string,
  content: string,
  variant = "medium",
): Promise<{ tickets: CreatedTicket[]; message: string }> {
  // System prompt bisa di-override dari Global Settings → Prompts (`ticket_prompt`).
  const systemPrompt = await readTicketPrompt();
  const run: Run = {
    id: crypto.randomUUID(),
    provider,
    workspace: null,
    sessionId: "",
    temperature: VARIANT_TEMPERATURE[variant],
    turns: [
      { role: "system", content: systemPrompt },
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
    mcpTools: new Map(),
    createdTickets: [],
    createdAt: Date.now(),
  };

  for (let step = 0; step < 5; step++) {
    const response = await complete(
      provider,
      run.turns,
      [TICKET_TOOL],
      run.temperature,
      undefined,
      run.workspace,
    );
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
