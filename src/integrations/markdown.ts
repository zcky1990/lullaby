/** Shared markdown → Notion blocks / Confluence storage helpers. */

const MAX_RICH_TEXT = 2000;

export function notionRichText(content: string): Array<Record<string, unknown>> {
  const text = content.length ? content : "";
  const chunks: Array<Record<string, unknown>> = [];
  for (let i = 0; i < text.length || chunks.length === 0; i += MAX_RICH_TEXT) {
    const part = text.slice(i, i + MAX_RICH_TEXT);
    chunks.push({ type: "text", text: { content: part } });
    if (!text.length) break;
  }
  return chunks;
}

export function markdownToNotionBlocks(markdown: string): Record<string, unknown>[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Record<string, unknown>[] = [];
  let i = 0;

  const pushParagraph = (text: string) => {
    if (!text.trim()) return;
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: notionRichText(text) },
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: notionRichText(body.join("\n")),
          language: lang || "plain text",
        },
      });
      i += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
      blocks.push({
        object: "block",
        type,
        [type]: { rich_text: notionRichText(heading[2]) },
      });
      i += 1;
      continue;
    }
    const todo = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todo) {
      blocks.push({
        object: "block",
        type: "to_do",
        to_do: {
          rich_text: notionRichText(todo[2]),
          checked: todo[1].toLowerCase() === "x",
        },
      });
      i += 1;
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: notionRichText(bullet[1]) },
      });
      i += 1;
      continue;
    }
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: notionRichText(numbered[1]) },
      });
      i += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: notionRichText(line.slice(2)) },
      });
      i += 1;
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length && lines[i].trim() &&
      !/^#{1,3}\s|^\s*[-*]|\d+\.\s|^```|^>|^---+$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    pushParagraph(para.join("\n"));
  }

  return blocks.slice(0, 100);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function markdownToConfluenceStorage(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      parts.push(
        `<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${
          body.join("\n")
        }]]></ac:plain-text-body></ac:structured-macro>`,
      );
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      parts.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const items: string[] = [`<li>${escapeHtml(bullet[1])}</li>`];
      i += 1;
      while (i < lines.length) {
        const next = /^[-*]\s+(.*)$/.exec(lines[i]);
        if (!next) break;
        items.push(`<li>${escapeHtml(next[1])}</li>`);
        i += 1;
      }
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      const items: string[] = [`<li>${escapeHtml(numbered[1])}</li>`];
      i += 1;
      while (i < lines.length) {
        const next = /^\d+\.\s+(.*)$/.exec(lines[i]);
        if (!next) break;
        items.push(`<li>${escapeHtml(next[1])}</li>`);
        i += 1;
      }
      parts.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length && lines[i].trim() && !/^#{1,6}\s|^\s*[-*]|\d+\.\s|^```/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    parts.push(`<p>${escapeHtml(para.join(" "))}</p>`);
  }
  return parts.join("") || "<p></p>";
}
