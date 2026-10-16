import { equal, throws } from "node:assert/strict";
import { JiraConfig, LlmProviderInput, ProjectInput } from "../src/config/schema.ts";

Deno.test("ProjectInput trims and drops empty optional fields", () => {
  throws(() => ProjectInput.parse({ name: "" }));
  const parsed = ProjectInput.parse({ name: "  Checkout ", docmostSpaceId: "" });
  equal(parsed.name, "Checkout");
  equal(parsed.docmostSpaceId, undefined);
});

Deno.test("JiraConfig applies defaults and validates input", () => {
  const cfg = JiraConfig.parse({ baseUrl: "https://acme.atlassian.net", projectKey: "PROJ" });
  equal(cfg.deployment, "cloud");
  throws(() => JiraConfig.parse({ baseUrl: "not-a-url", projectKey: "PROJ" }));
  const noKey = JiraConfig.parse({ baseUrl: "https://acme.atlassian.net" });
  equal(noKey.projectKey, "");
});

Deno.test("LlmProviderInput supports multiple providers and defaults", () => {
  const a = LlmProviderInput.parse({ name: "Anthropic", provider: "anthropic" });
  equal(a.name, "Anthropic");
  equal(a.provider, "anthropic");
  equal(a.mode, "api");
  equal(a.baseUrl, undefined);

  const b = LlmProviderInput.parse({ name: "Ollama", provider: "ollama", baseUrl: "" });
  equal(b.baseUrl, undefined);

  const c = LlmProviderInput.parse({
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  });
  equal(c.baseUrl, "https://api.openai.com/v1");

  throws(() => LlmProviderInput.parse({ name: "" }));
  throws(() => LlmProviderInput.parse({ name: "X", baseUrl: "not-a-url" }));
});
