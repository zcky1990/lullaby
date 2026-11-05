import { describe, expect, it } from "vitest";
import type { ChatResponse, PendingFileChange, PendingHunk } from "./api";
import {
  countPendingHunks,
  describeDeferredReview,
  isChangeSettled,
  readDeferredReview,
} from "./chat-review";

const hunk = (overrides: Partial<PendingHunk> = {}): PendingHunk => ({
  oldStart: 0,
  oldLines: 1,
  newStart: 0,
  newLines: 1,
  lines: [{ type: "+", text: "baru", oldLine: null, newLine: 1 }],
  decision: "accepted",
  ...overrides,
});

const change = (
  path: string,
  overrides: Partial<PendingFileChange> = {},
): PendingFileChange => ({
  callId: `${path}-call`,
  path,
  action: "update",
  added: 1,
  removed: 0,
  hunks: [hunk()],
  ...overrides,
});

const done = (extra: Record<string, unknown> = {}): ChatResponse =>
  ({
    status: "done",
    message: "selesai",
    sessionId: "sess-1",
    changes: [],
    createdTickets: [],
    ...extra,
  }) as unknown as ChatResponse;

describe("readDeferredReview", () => {
  it("mengembalikan runId dan perubahan dari respons done bertanda reviewDeferred", () => {
    const review = readDeferredReview(
      done({ runId: "run-1", reviewDeferred: true, pendingChanges: [change("a.ts")] }),
    );
    expect(review?.runId).toBe("run-1");
    expect(review?.changes.map((item) => item.path)).toEqual(["a.ts"]);
  });

  it("menolak respons yang belum selesai atau tanpa review deferred", () => {
    expect(readDeferredReview(null)).toBeNull();
    expect(readDeferredReview(undefined)).toBeNull();
    expect(
      readDeferredReview({
        status: "approval_required",
        runId: "run-1",
        pending: [],
        pendingChanges: [change("a.ts")],
        sessionId: "sess-1",
        changes: [],
        createdTickets: [],
      }),
    ).toBeNull();
    expect(readDeferredReview(done({ runId: "run-1", pendingChanges: [change("a.ts")] })))
      .toBeNull();
    expect(readDeferredReview(done({ runId: "run-1", reviewDeferred: true, pendingChanges: [] })))
      .toBeNull();
    expect(readDeferredReview(done({ reviewDeferred: true, pendingChanges: [change("a.ts")] })))
      .toBeNull();
  });

  it("mengabaikan runId kosong", () => {
    expect(
      readDeferredReview(
        done({ runId: "  ", reviewDeferred: true, pendingChanges: [change("a.ts")] }),
      ),
    ).toBeNull();
  });
});

describe("countPendingHunks", () => {
  it("menjumlahkan hunk semua file", () => {
    expect(countPendingHunks(undefined)).toBe(0);
    expect(countPendingHunks([])).toBe(0);
    expect(
      countPendingHunks([
        change("a.ts", { hunks: [hunk(), hunk()] }),
        change("b.ts"),
      ]),
    ).toBe(3);
  });
});

describe("describeDeferredReview", () => {
  it("meringkas file, aksi, dan jumlah baris", () => {
    const text = describeDeferredReview([
      change("a.ts", { action: "create", added: 10, removed: 0 }),
      change("b.ts", { added: 2, removed: 3 }),
    ]);
    expect(text).toBe("2 file (1 baru, 1 diubah) · +12 · −3");
  });

  it("memakai bentuk tunggal dan kosong bila tidak ada perubahan", () => {
    expect(describeDeferredReview([change("a.ts", { added: 1, removed: 1 })])).toBe(
      "1 file (1 diubah) · +1 · −1",
    );
    expect(describeDeferredReview([])).toBe("");
    expect(describeDeferredReview(null)).toBe("");
  });
});

describe("isChangeSettled", () => {
  it("menandai file yang semua hunk-nya sudah diputuskan", () => {
    expect(isChangeSettled(change("a.ts"))).toBe(true);
    expect(
      isChangeSettled(change("b.ts", { hunks: [hunk(), hunk({ decision: "pending" })] })),
    ).toBe(false);
    expect(isChangeSettled(change("c.ts", { hunks: [] }))).toBe(true);
  });
});
