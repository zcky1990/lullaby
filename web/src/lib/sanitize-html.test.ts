import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml", () => {
  it("strips scripts, handlers, and unsafe links", () => {
    const html = sanitizeHtml(
      '<p onclick="x()">Hi <b>there</b><script>alert(1)</script>' +
        '<img src=x onerror=1><a href="javascript:alert(1)">x</a>' +
        '<a href="https://example.com">y</a></p>',
    );
    expect(html.includes("<script")).toBe(false);
    expect(html.includes("onclick")).toBe(false);
    expect(html.includes("onerror")).toBe(false);
    expect(html.includes("javascript:")).toBe(false);
    expect(html.includes('href="https://example.com"')).toBe(true);
    expect(html.includes('rel="noreferrer"')).toBe(true);
  });

  it("returns empty for blank input", () => {
    expect(sanitizeHtml("")).toBe("");
  });
});
