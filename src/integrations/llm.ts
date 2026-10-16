import { request, truncate } from "./http.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProviderConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export async function chat(
  config: LlmProviderConfig,
  messages: ChatMessage[],
): Promise<string> {
  const base = config.baseUrl?.trim();
  if (!base) throw new Error("baseUrl provider LLM belum diisi (Project Settings → LLM).");

  const type = (config.provider || "openai").toLowerCase();
  if (!config.model) throw new Error("model provider LLM belum diisi.");

  if (type === "anthropic") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const res = await request(endpoint(base, "/messages"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        system: system || undefined,
        messages: messages.filter((message) => message.role !== "system"),
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${truncate(res.text, 300)}`);
    const json = JSON.parse(res.text || "{}") as {
      content?: Array<{ text?: string }>;
    };
    return (json.content ?? []).map((part) => part.text ?? "").join("");
  }

  const res = await request(endpoint(base, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${config.apiKey ?? ""}`,
    },
    body: JSON.stringify({ model: config.model, messages }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${truncate(res.text, 300)}`);
  const json = JSON.parse(res.text || "{}") as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}
