import { describe, expect, it } from "vitest";
import { DOCS_POLL_INTERVAL_MS, shouldPollLocalDocs } from "./docs-poll";

describe("shouldPollLocalDocs", () => {
  it("memutar polling hanya saat panel local aktif dan terlihat", () => {
    expect(shouldPollLocalDocs({ visible: true, enabled: true, loading: false })).toBe(true);
  });

  it("berhenti saat window hidden, sumber bukan local, atau masih loading", () => {
    expect(shouldPollLocalDocs({ visible: false, enabled: true, loading: false })).toBe(false);
    expect(shouldPollLocalDocs({ visible: true, enabled: false, loading: false })).toBe(false);
    expect(shouldPollLocalDocs({ visible: true, enabled: true, loading: true })).toBe(false);
    expect(shouldPollLocalDocs({ visible: false, enabled: false, loading: true })).toBe(false);
  });
});

describe("DOCS_POLL_INTERVAL_MS", () => {
  it("cukup longgar agar tidak membaca disk terus-menerus", () => {
    expect(DOCS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(3_000);
    expect(DOCS_POLL_INTERVAL_MS).toBeLessThanOrEqual(30_000);
  });
});
