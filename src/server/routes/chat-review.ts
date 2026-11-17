import { getProject } from "../../db/db.ts";
import { hydrateChatRun, hydrateLatestChatRun } from "../chat/persist.ts";
import { pendingChangesPayload } from "../chat/review.ts";
import { findRunByProject, getRun, pruneRuns } from "../chat/state.ts";
import type { Run } from "../chat/types.ts";
import { isAuthorized, json } from "../http.ts";

const RUN_REVIEW_PATH = "/api/chat/review";
const PROJECT_REVIEW_PATTERN = /^\/api\/projects\/([^/]+)\/chat\/review$/;

export type ChatReviewStatus = "running" | "review" | "interrupted";

export interface ChatReviewPayload {
  runId: string;
  sessionId: string;
  projectId: string;
  status: ChatReviewStatus;
  interrupted: boolean;
  reviewDeferred: boolean;
  createdAt: number;
  finishedAt: number | null;
  changes: Run["changes"];
  pendingChanges: ReturnType<typeof pendingChangesPayload>;
}

function payloadFor(run: Run): ChatReviewPayload {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    projectId: run.projectId,
    status: run.interrupted ? "interrupted" : run.finishedAt ? "review" : "running",
    interrupted: run.interrupted === true,
    reviewDeferred: run.finishedAt !== undefined,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? null,
    changes: run.changes,
    pendingChanges: pendingChangesPayload(run),
  };
}

/**
 * Route Review: sumber data tab Review (bukan state stream chat).
 * - `GET /api/chat/review?runId=` — state satu run.
 * - `GET /api/projects/:id/chat/review` — run review terbaru milik project
 *   (dipakai UI saat bootstrap untuk memulihkan tab Review setelah restart).
 * Mengembalikan `null` bila path bukan milik modul ini.
 */
export async function handleChatReviewRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const { pathname } = url;
  const projectMatch = PROJECT_REVIEW_PATTERN.exec(pathname);
  if (pathname !== RUN_REVIEW_PATH && !projectMatch) return null;

  if (req.method.toUpperCase() !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!isAuthorized(req)) return json({ error: "unauthorized" }, 401);

  pruneRuns();

  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const project = await getProject(projectId);
    if (!project) return json({ error: "project_not_found" }, 404);
    const run = (await hydrateLatestChatRun(projectId)) ?? findRunByProject(projectId);
    return json({ run: run ? payloadFor(run) : null });
  }

  const runId = url.searchParams.get("runId")?.trim() ?? "";
  if (!runId) return json({ error: "run_id_required" }, 400);
  const run = getRun(runId) ?? (await hydrateChatRun(runId));
  return json({ run: run ? payloadFor(run) : null });
}
