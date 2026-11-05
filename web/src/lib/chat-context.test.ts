import { describe, expect, it } from "vitest";
import {
  clipContext,
  formatDocumentContext,
  formatTicketContext,
  htmlToPlainText,
} from "./chat-context";

describe("htmlToPlainText", () => {
  it("mengubah paragraf dan list menjadi teks biasa", () => {
    expect(
      htmlToPlainText("<p>Halo <b>dunia</b></p><ul><li>satu</li><li>dua</li></ul>"),
    ).toBe("Halo dunia\n- satu\n- dua");
  });

  it("mendekode entity umum dan membuang script", () => {
    expect(htmlToPlainText("<p>a &amp; b</p><script>alert(1)</script>")).toBe("a & b");
  });
});

describe("formatTicketContext", () => {
  it("menyusun konteks tiket lengkap dengan deskripsi plain text", () => {
    const attachment = formatTicketContext({
      key: "LOCAL-1",
      summary: "Perbaiki drag",
      status: "In Progress",
      priority: "High",
      assignee: "saya",
      labels: ["ui", "chat"],
      description: "<p>Baris satu</p><p>Baris dua</p>",
      source: "local",
    });

    expect(attachment.name).toBe("LOCAL-1 — Perbaiki drag");
    expect(attachment.text).toContain("# Tiket LOCAL-1: Perbaiki drag");
    expect(attachment.text).toContain("- Status: In Progress");
    expect(attachment.text).toContain("- Prioritas: High");
    expect(attachment.text).toContain("- Label: ui, chat");
    expect(attachment.text).toContain("- Sumber: Local");
    expect(attachment.text).toContain("Baris satu\nBaris dua");
    expect(attachment.text).not.toContain("<p>");
  });

  it("tetap aman untuk tiket tanpa label dan deskripsi", () => {
    const attachment = formatTicketContext({ key: "A-2", summary: "Kosong" });
    expect(attachment.text).toContain("_Tidak ada deskripsi._");
  });
});

describe("formatDocumentContext", () => {
  it("menyertakan sumber, path, dan isi dokumen", () => {
    const attachment = formatDocumentContext({
      title: "Plan",
      source: "local",
      path: "notes/plan.md",
      content: "# Isi\n\nHalo",
    });

    expect(attachment.name).toBe("Plan");
    expect(attachment.text).toContain("# Dokumen: Plan");
    expect(attachment.text).toContain("- Sumber: Local");
    expect(attachment.text).toContain("- Path: notes/plan.md");
    expect(attachment.text).toContain("Halo");
  });

  it("menandai dokumen remote dengan page id", () => {
    const attachment = formatDocumentContext({
      title: "Spec",
      source: "notion",
      id: "page-1",
      content: "",
    });

    expect(attachment.text).toContain("- Sumber: Notion");
    expect(attachment.text).toContain("- Page ID: page-1");
    expect(attachment.text).toContain("_Dokumen kosong._");
  });
});

describe("clipContext", () => {
  it("membiarkan teks pendek apa adanya", () => {
    expect(clipContext("abc", 10)).toBe("abc");
  });

  it("memotong teks panjang dan menandainya", () => {
    const clipped = clipContext("x".repeat(20), 10);
    expect(clipped.startsWith("x".repeat(10))).toBe(true);
    expect(clipped).toContain("dipotong");
  });
});
