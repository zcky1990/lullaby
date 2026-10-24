import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p",
  "div",
  "br",
  "hr",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
];

const MAX_LENGTH = 20_000;

export function sanitizeHtml(input: string): string {
  if (!input) return "";
  const clean = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target"],
  });
  return String(clean)
    .replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
      const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const href = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
      if (!/^https?:\/\//i.test(href)) return "<a>";
      const safe = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return `<a href="${safe}" target="_blank" rel="noreferrer">`;
    })
    .trim()
    .slice(0, MAX_LENGTH);
}
