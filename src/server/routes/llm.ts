import { LlmProviderInput } from "../../config/schema.ts";
import {
  createLlmProvider,
  deleteLlmProvider,
  getLlmProvider,
  listLlmProviders,
  updateLlmProvider,
} from "../../db/db.ts";
import { isMaskedSecret, json, readJson, record } from "../http.ts";
import { serializeLlm } from "../serializers.ts";

export async function listLlmHandler(): Promise<Response> {
  return json({ providers: (await listLlmProviders()).map(serializeLlm) });
}

export async function createLlmHandler(req: Request): Promise<Response> {
  const parsed = LlmProviderInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const provider = await createLlmProvider({
    id: crypto.randomUUID(),
    name: parsed.data.name,
    provider: parsed.data.provider,
    model: parsed.data.model,
    baseUrl: parsed.data.baseUrl,
    apiKey: parsed.data.apiKey,
    mode: parsed.data.mode,
  });
  await record("llm.created", { name: provider.name });
  return json({ provider: serializeLlm(provider) }, 201);
}

export async function updateLlmHandler(providerId: string, req: Request): Promise<Response> {
  const existing = await getLlmProvider(providerId);
  if (!existing) return json({ error: "provider_not_found" }, 404);

  const parsed = LlmProviderInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const provider = await updateLlmProvider(providerId, {
    name: parsed.data.name,
    provider: parsed.data.provider,
    model: parsed.data.model,
    baseUrl: parsed.data.baseUrl,
    apiKey: isMaskedSecret(parsed.data.apiKey)
      ? (existing.api_key ?? undefined)
      : parsed.data.apiKey,
    mode: parsed.data.mode,
  });
  await record("llm.saved", { providerId });
  return json({ provider: serializeLlm(provider!) });
}

export async function deleteLlmHandler(providerId: string): Promise<Response> {
  const existing = await getLlmProvider(providerId);
  if (!existing) return json({ error: "provider_not_found" }, 404);
  await deleteLlmProvider(providerId);
  await record("llm.deleted", { providerId });
  return json({ ok: true });
}
