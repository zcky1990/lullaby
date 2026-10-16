import type { GithubConfig } from "../config/schema.ts";
import { request, type TestResult, truncate } from "./http.ts";

function statusMessage(status: number): string {
  if (status === 401) return "Ditolak (401): token GitHub tidak valid.";
  if (status === 403) return "Ditolak (403): rate limit atau scope kurang.";
  if (status === 404) return "Tidak ditemukan (404): periksa org/repo.";
  return `GitHub merespons HTTP ${status}.`;
}

export async function testGithub(cfg: GithubConfig): Promise<TestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  if (!cfg.token) {
    return { ok: false, message: "Token GitHub belum diisi.", latencyMs: elapsed() };
  }

  const base = cfg.baseUrl.replace(/\/+$/, "");
  const path = cfg.org && cfg.repo ? `/repos/${cfg.org}/${cfg.repo}` : "/user";

  try {
    const res = await request(`${base}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rnd-workflow",
      },
    });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        message: cfg.org && cfg.repo
          ? `Repo ${cfg.org}/${cfg.repo} dapat diakses.`
          : "Koneksi GitHub berhasil.",
        latencyMs: elapsed(),
      };
    }
    return {
      ok: false,
      status: res.status,
      message: statusMessage(res.status),
      detail: truncate(res.text),
      latencyMs: elapsed(),
    };
  } catch (error) {
    return {
      ok: false,
      message: `Gagal menghubungi GitHub: ${(error as Error).message}`,
      latencyMs: elapsed(),
    };
  }
}
