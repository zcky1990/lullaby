import { publish } from "../bus.ts";
import { safeParse } from "./llm.ts";
import type { ChatStep, ChatStepEvent, Run, ToolCall } from "./types.ts";

export function emitChatStep(run: Run, step: Omit<ChatStep, "ts"> & { ts?: number }): void {
  const event: ChatStepEvent = {
    ...step,
    ts: step.ts ?? Date.now(),
    runId: run.id,
    projectId: run.projectId,
    sessionId: run.sessionId,
  };
  if (run.emit) {
    try {
      run.emit(event);
      return;
    } catch {
      // stream closed; fall back to the event bus
    }
  }
  publish({ type: "chat.step", payload: event });
}

export function describeToolCall(call: ToolCall): string {
  const args = safeParse(call.arguments);
  const path = typeof args.path === "string" ? args.path : "";
  switch (call.name) {
    case "list_files":
      return path ? `Melihat folder ${path}` : "Melihat isi workspace";
    case "read_file":
      return path ? `Membaca ${path}` : "Membaca file";
    case "write_file":
      return path ? `Menulis ${path}` : "Menulis file";
    case "list_documents":
      return "Mengambil daftar dokumen";
    case "get_document":
      return "Membaca dokumen";
    case "create_document":
      return "Membuat dokumen";
    case "update_document":
      return "Memperbarui dokumen";
    case "sync_document":
      return "Sinkronisasi dokumen";
    case "list_tickets":
      return "Mengambil daftar tiket";
    case "get_ticket":
      return "Membaca tiket";
    case "create_ticket":
      return "Membuat tiket";
    case "update_ticket":
      return "Memperbarui tiket";
    case "delete_ticket":
      return "Menghapus tiket";
    case "sync_ticket":
      return "Sinkronisasi tiket";
    case "transition_ticket":
      return "Mengubah status tiket";
    case "use_skill":
      return typeof args.name === "string" ? `Memuat skill ${args.name}` : "Memuat skill";
    default:
      return call.name.startsWith("mcp_") ? `Menjalankan tool MCP ${call.name}` : call.name;
  }
}

export function summarizeToolResult(result: string): string {
  const text = result.replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
