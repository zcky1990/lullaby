import { z } from "zod";
import {
  ConfluenceConfig,
  DocmostConfig,
  GithubConfig,
  type IntegrationInput,
  JiraConfig,
  NotionConfig,
} from "../config/schema.ts";
import { testConfluence } from "./confluence.ts";
import { testDocmost } from "./docmost.ts";
import { testGithub } from "./github.ts";
import { request, type TestResult, truncate } from "./http.ts";
import { testJira } from "./jira.ts";
import { testNotion } from "./notion.ts";
import { testCursor } from "../server/chat/cursor.ts";

const LlmConfig = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), { message: "URL harus http(s)" })
    .optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});

function invalid(error: z.ZodError): TestResult {
  return {
    ok: false,
    message: "Konfigurasi tidak valid.",
    detail: error.issues,
    latencyMs: 0,
  };
}

async function testLlm(cfg: z.infer<typeof LlmConfig>): Promise<TestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if ((cfg.provider ?? "openai").toLowerCase() === "cursor") {
    try {
      const result = await testCursor(cfg.apiKey ?? "");
      return {
        ok: result.ok,
        message: result.message,
        latencyMs: elapsed(),
      };
    } catch (error) {
      return {
        ok: false,
        message: `Cursor SDK error: ${(error as Error).message}`,
        latencyMs: elapsed(),
      };
    }
  }
  if (!cfg.baseUrl) {
    return { ok: false, message: "Base URL provider LLM belum diisi.", latencyMs: elapsed() };
  }
  const base = cfg.baseUrl.replace(/\/+$/, "");
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const res = await request(`${base}/models`, { method: "GET", headers });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        message: "Provider LLM merespons.",
        latencyMs: elapsed(),
      };
    }
    return {
      ok: false,
      status: res.status,
      message: `Provider LLM merespons HTTP ${res.status}.`,
      detail: truncate(res.text),
      latencyMs: elapsed(),
    };
  } catch (error) {
    return {
      ok: false,
      message: `Gagal menghubungi LLM: ${(error as Error).message}`,
      latencyMs: elapsed(),
    };
  }
}

export async function testIntegration(input: IntegrationInput): Promise<TestResult> {
  switch (input.kind) {
    case "docmost": {
      const parsed = DocmostConfig.safeParse(input.config);
      if (!parsed.success) return invalid(parsed.error);
      return await testDocmost(parsed.data);
    }
    case "notion": {
      const parsed = NotionConfig.safeParse(input.config);
      if (!parsed.success) return invalid(parsed.error);
      return await testNotion(parsed.data);
    }
    case "confluence": {
      const parsed = ConfluenceConfig.safeParse(input.config);
      if (!parsed.success) return invalid(parsed.error);
      return await testConfluence(parsed.data);
    }
    case "jira": {
      const parsed = JiraConfig.safeParse(input.config);
      if (!parsed.success) return invalid(parsed.error);
      return await testJira(parsed.data);
    }
    case "github": {
      const parsed = GithubConfig.safeParse(input.config);
      if (!parsed.success) return invalid(parsed.error);
      return await testGithub(parsed.data);
    }
    case "llm": {
      const parsed = LlmConfig.safeParse(input.config);
      if (!parsed.success) return invalid(parsed.error);
      return await testLlm(parsed.data);
    }
  }
}
