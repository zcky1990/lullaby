import type { VisibleMessage } from "./types.ts";

export interface StoredChatMessage {
  role: string;
  content: string;
}

export interface SessionTranscriptMerge {
  /** New rows to persist (usually the latest user turn). */
  append: VisibleMessage[];
  /** Full user/assistant transcript for this run (DB history + delta). */
  transcript: VisibleMessage[];
}

function asVisibleRole(role: string): "user" | "assistant" | null {
  if (role === "assistant") return "assistant";
  if (role === "user") return "user";
  return null;
}

/**
 * Session-centric merge: DB holds the conversation; `incoming` is the new turn
 * (typically one user message). If a client still sends a full transcript, only
 * the last user message is treated as the delta when history already exists.
 */
export function mergeSessionTranscript(
  stored: StoredChatMessage[],
  incoming: VisibleMessage[],
): SessionTranscriptMerge {
  const history: VisibleMessage[] = [];
  for (const row of stored) {
    const role = asVisibleRole(row.role);
    if (!role) continue;
    history.push({ role, content: row.content });
  }

  if (!incoming.length) return { append: [], transcript: history };

  if (history.length === 0) {
    const append = incoming.filter((message) =>
      message.role === "user" || message.role === "assistant"
    );
    return {
      append,
      transcript: append.map((message) => ({
        role: message.role,
        content: message.content,
        attachments: message.attachments,
      })),
    };
  }

  const last = incoming[incoming.length - 1];
  if (last.role !== "user") return { append: [], transcript: history };

  const lastStored = history[history.length - 1];
  const alreadyStored = lastStored?.role === "user" && lastStored.content === last.content;

  if (!alreadyStored) {
    history.push({
      role: "user",
      content: last.content,
      attachments: last.attachments,
    });
    return { append: [last], transcript: history };
  }

  history[history.length - 1] = {
    role: "user",
    content: lastStored.content,
    attachments: last.attachments ?? lastStored.attachments,
  };
  return { append: [], transcript: history };
}
