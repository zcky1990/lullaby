import type { LlmProviderRow } from "../../db/db.ts";
import { request } from "../../integrations/http.ts";
import type { ChatAttachment, ChatTurn, ToolCall, ToolDef } from "./types.ts";

export function safeParse(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const MAX_TEXT_ATTACHMENT = 200_000;

function attachmentText(attachments: ChatAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .filter((item) => item.type === "text")
    .map((item) => `\n\n--- ${item.name} ---\n${(item.data ?? "").slice(0, MAX_TEXT_ATTACHMENT)}`)
    .join("");
}

function parseImageDataUrl(data: string): { mediaType: string; base64: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(data.trim());
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), base64: match[2].replace(/\s+/g, "") };
}

function openAiMessages(turns: ChatTurn[]) {
  return turns.map((turn) => {
    if (turn.role === "tool") {
      return { role: "tool", tool_call_id: turn.toolCallId, content: turn.content };
    }
    if (turn.role === "assistant" && turn.toolCalls?.length) {
      return {
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (turn.role === "user" && turn.attachments?.length) {
      const text = `${turn.content}${attachmentText(turn.attachments)}`;
      const images = turn.attachments.filter((item) => item.type === "image");
      if (!images.length) return { role: "user", content: text };
      return {
        role: "user",
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((image) => ({ type: "image_url", image_url: { url: image.data ?? "" } })),
        ],
      };
    }
    return { role: turn.role, content: turn.content };
  });
}

async function completeOpenAi(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  tools: ToolDef[],
  temperature?: number,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const base = (provider.base_url ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("baseUrl provider LLM belum diisi.");
  const body: Record<string, unknown> = {
    model: provider.model ?? "",
    messages: openAiMessages(turns),
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    body.tool_choice = "auto";
  }
  const res = await request(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${provider.api_key ?? ""}`,
    },
    body: JSON.stringify(body),
  }, 120_000);
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${res.text.slice(0, 300)}`);
  const json = JSON.parse(res.text || "{}") as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const message = json.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.function?.name ?? "",
    arguments: call.function?.arguments ?? "{}",
  }));
  return { text: message?.content ?? "", toolCalls };
}

async function completeAnthropic(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  tools: ToolDef[],
  temperature?: number,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const base = (provider.base_url ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("baseUrl provider LLM belum diisi.");

  const system = turns
    .filter((turn) => turn.role === "system")
    .map((turn) => turn.content)
    .join("\n\n");

  type Block = Record<string, unknown>;
  const messages: Array<{ role: "user" | "assistant"; content: string | Block[] }> = [];
  for (const turn of turns) {
    if (turn.role === "system") continue;
    if (turn.role === "tool") {
      const block: Block = {
        type: "tool_result",
        tool_use_id: turn.toolCallId,
        content: turn.content,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        messages.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (turn.role === "user" && turn.attachments?.length) {
      const text = `${turn.content}${attachmentText(turn.attachments)}`;
      const blocks: Block[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const image of turn.attachments) {
        if (image.type !== "image") continue;
        const parsed = parseImageDataUrl(image.data ?? "");
        if (parsed) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: parsed.mediaType, data: parsed.base64 },
          });
        }
      }
      messages.push({ role: "user", content: blocks.length ? blocks : text });
      continue;
    }
    if (turn.role === "assistant" && turn.toolCalls?.length) {
      const content: Block[] = [];
      if (turn.content) content.push({ type: "text", text: turn.content });
      for (const call of turn.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: safeParse(call.arguments),
        });
      }
      messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({ role: turn.role, content: turn.content });
  }

  const body: Record<string, unknown> = {
    model: provider.model ?? "",
    max_tokens: 2048,
    system: system || undefined,
    messages,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  const res = await request(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.api_key ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  }, 120_000);
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${res.text.slice(0, 300)}`);
  const json = JSON.parse(res.text || "{}") as {
    content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  };
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id ?? `call_${toolCalls.length}`,
        name: block.name ?? "",
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }
  return { text, toolCalls };
}

export function complete(
  provider: LlmProviderRow,
  turns: ChatTurn[],
  tools: ToolDef[],
  temperature?: number,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const type = (provider.provider || "openai").toLowerCase();
  return type === "anthropic"
    ? completeAnthropic(provider, turns, tools, temperature)
    : completeOpenAi(provider, turns, tools, temperature);
}

export const VARIANT_TEMPERATURE: Record<string, number | undefined> = {
  low: 0.2,
  medium: 0.5,
  high: 0.9,
};
