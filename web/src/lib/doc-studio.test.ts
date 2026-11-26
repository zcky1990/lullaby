import { describe, expect, it } from "vitest";
import {
  appendTurn,
  canFinalize,
  compactText,
  docStudioErrorKey,
  transcriptLength,
} from "@/lib/doc-studio";

describe("doc-studio helper", () => {
  it("appendTurn menambah giliran tanpa duplikat berurutan", () => {
    const start = appendTurn([], { role: "assistant", content: "Siapa penggunanya?" });
    expect(start).toHaveLength(1);
    const again = appendTurn(start, { role: "assistant", content: "Siapa penggunanya?" });
    expect(again).toHaveLength(1);
    const withUser = appendTurn(again, { role: "user", content: "PM" });
    expect(withUser).toHaveLength(2);
  });

  it("canFinalize: butuh minimal satu jawaban user atau status ready", () => {
    expect(canFinalize({ status: "interviewing", transcript: [] })).toBe(false);
    expect(
      canFinalize({
        status: "interviewing",
        transcript: [{ role: "assistant", content: "Halo" }],
      }),
    ).toBe(false);
    expect(
      canFinalize({
        status: "interviewing",
        transcript: [{ role: "assistant", content: "Halo" }, { role: "user", content: "Hai" }],
      }),
    ).toBe(true);
    expect(canFinalize({ status: "ready", transcript: [] })).toBe(true);
  });

  it("canFinalize: draft tersimpan atau proses berjalan tidak boleh finalize", () => {
    const transcript = [{ role: "user" as const, content: "Hai" }];
    expect(canFinalize({ status: "saved", transcript })).toBe(false);
    expect(canFinalize({ status: "ready", transcript, busy: true })).toBe(false);
  });

  it("compactText merapikan baris kosong berlebih", () => {
    expect(compactText("  a\n\n\n\nb  ")).toBe("a\n\nb");
  });

  it("transcriptLength menghitung jawaban user", () => {
    expect(
      transcriptLength([
        { role: "assistant", content: "q1" },
        { role: "user", content: "a1" },
        { role: "user", content: "a2" },
      ]),
    ).toBe(2);
  });

  it("docStudioErrorKey memetakan kode API ke pesan yang bisa ditindaklanjuti", () => {
    expect(docStudioErrorKey("llm_not_configured")).toBe("docStudio.error.llmNotConfigured");
    expect(docStudioErrorKey("document_workspace_missing")).toBe(
      "docStudio.error.workspaceMissing",
    );
    expect(docStudioErrorKey("  draft_not_found  ")).toBe("docStudio.error.draftNotFound");
    expect(docStudioErrorKey("draft_already_saved")).toBe("docStudio.error.draftAlreadySaved");
    // Kode tak dikenal dibiarkan tampil apa adanya supaya bug baru tidak tersembunyi.
    expect(docStudioErrorKey("method_not_allowed")).toBeNull();
    expect(docStudioErrorKey("   ")).toBeNull();
  });
});
