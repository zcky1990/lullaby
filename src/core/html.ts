import sanitizeHtmlLib from "sanitize-html";

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

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
]);

const INLINE_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "strike", "del", "code", "a"]);
const VOID_TAGS = new Set(["br", "hr"]);

const MARK_TAGS: Record<string, string> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "underline",
  s: "strike",
  strike: "strike",
  del: "strike",
  code: "code",
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#?[a-z0-9]+);/gi, (match, name: string) => {
    const key = name.toLowerCase();
    return ENTITIES[key] ?? match;
  });
}

export function sanitizeHtml(input: string): string {
  if (!input) return "";
  const clean = sanitizeHtmlLib(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName: string, attribs: Record<string, string>) => {
        const href = attribs.href ?? "";
        if (!/^https?:\/\//i.test(href)) {
          return { tagName: "a", attribs: {} };
        }
        return {
          tagName: "a",
          attribs: { href, target: "_blank", rel: "noreferrer" },
        };
      },
    },
  });
  return clean.trim().slice(0, 20_000);
}

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HtmlNode | string>;
}

function parseHtml(html: string): Array<HtmlNode | string> {
  const root: HtmlNode = { tag: "root", attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? [];

  for (const token of tokens) {
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim().toLowerCase();
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === name) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (token.startsWith("<")) {
      const nameMatch = /^<\s*([a-z0-9]+)/i.exec(token);
      if (!nameMatch) continue;
      const tag = nameMatch[1].toLowerCase();
      const attrs: Record<string, string> = {};
      const attrPattern = /([a-z0-9-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
      let attr: RegExpExecArray | null;
      while ((attr = attrPattern.exec(token))) {
        if (!/^on/i.test(attr[1])) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? "";
      }
      const node: HtmlNode = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!VOID_TAGS.has(tag) && !token.endsWith("/>")) stack.push(node);
      continue;
    }
    const text = decodeEntities(token);
    if (text) stack[stack.length - 1].children.push(text);
  }
  return root.children;
}

export function htmlToPlainText(input: string): string {
  if (!input) return "";
  const out: string[] = [];
  const walk = (node: HtmlNode | string) => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (node.tag === "br") {
      out.push("\n");
      return;
    }
    if (node.tag === "li") {
      out.push("\n• ");
      node.children.forEach(walk);
      out.push("\n");
      return;
    }
    if (BLOCK_TAGS.has(node.tag)) {
      out.push("\n");
      node.children.forEach(walk);
      out.push("\n");
      return;
    }
    node.children.forEach(walk);
  };
  parseHtml(input).forEach(walk);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
}

function markFor(node: HtmlNode): AdfMark | null {
  if (node.tag === "a") {
    const href = node.attrs.href ?? "";
    return /^https?:\/\//i.test(href) ? { type: "link", attrs: { href } } : null;
  }
  const type = MARK_TAGS[node.tag];
  return type ? { type } : null;
}

function textNodes(text: string, marks: AdfMark[]): AdfNode[] {
  const parts = text.split("\n");
  const out: AdfNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ type: "hardBreak" });
    if (part) {
      out.push(marks.length ? { type: "text", text: part, marks } : { type: "text", text: part });
    }
  });
  return out;
}

function inlineNodes(children: Array<HtmlNode | string>, marks: AdfMark[] = []): AdfNode[] {
  const out: AdfNode[] = [];
  for (const child of children) {
    if (typeof child === "string") {
      out.push(...textNodes(child, marks));
    } else if (child.tag === "br") {
      out.push({ type: "hardBreak" });
    } else if (INLINE_TAGS.has(child.tag)) {
      const mark = markFor(child);
      out.push(...inlineNodes(child.children, mark ? [...marks, mark] : marks));
    } else {
      out.push(...inlineNodes(child.children, marks));
    }
  }
  return out;
}

function nodeText(children: Array<HtmlNode | string>): string {
  return children
    .map((child) => (typeof child === "string" ? child : nodeText(child.children)))
    .join("");
}

function listItems(node: HtmlNode): AdfNode[] {
  return node.children
    .filter((child): child is HtmlNode => typeof child !== "string" && child.tag === "li")
    .map((item) => ({ type: "listItem", content: blocksFrom(item.children) }));
}

function blocksFrom(children: Array<HtmlNode | string>): AdfNode[] {
  const blocks: AdfNode[] = [];
  let inline: AdfNode[] = [];
  const flush = () => {
    if (inline.length) {
      blocks.push({ type: "paragraph", content: inline });
      inline = [];
    }
  };

  for (const child of children) {
    if (typeof child === "string") {
      inline.push(...textNodes(child, []));
      continue;
    }
    if (child.tag === "br") {
      inline.push({ type: "hardBreak" });
      continue;
    }
    if (INLINE_TAGS.has(child.tag)) {
      inline.push(...inlineNodes([child]));
      continue;
    }
    flush();
    if (child.tag === "p" || child.tag === "div") {
      blocks.push({ type: "paragraph", content: inlineNodes(child.children) });
    } else if (/^h[1-4]$/.test(child.tag)) {
      blocks.push({
        type: "heading",
        attrs: { level: Number(child.tag[1]) },
        content: inlineNodes(child.children),
      });
    } else if (child.tag === "ul" || child.tag === "ol") {
      blocks.push({
        type: child.tag === "ul" ? "bulletList" : "orderedList",
        content: listItems(child),
      });
    } else if (child.tag === "blockquote") {
      blocks.push({ type: "blockquote", content: blocksFrom(child.children) });
    } else if (child.tag === "pre") {
      blocks.push({
        type: "codeBlock",
        content: [{ type: "text", text: nodeText(child.children) }],
      });
    } else if (child.tag === "hr") {
      blocks.push({ type: "rule" });
    } else {
      blocks.push(...blocksFrom(child.children));
    }
  }
  flush();
  return blocks;
}

export function htmlToAdf(input: string): unknown {
  const content = blocksFrom(parseHtml(input));
  return {
    type: "doc",
    version: 1,
    content: content.length ? content : [{ type: "paragraph", content: [] }],
  };
}
