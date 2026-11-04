import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import MarkdownView from "@/components/MarkdownView";
import { registerFinder } from "@/lib/find";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  fontSize?: number;
  fontFamily?: string;
  className?: string;
}

function clearMarks(marks: HTMLElement[]) {
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function highlightMatches(root: HTMLElement, query: string): HTMLElement[] {
  const marks: HTMLElement[] = [];
  const needle = query.toLowerCase();
  if (!needle) return marks;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("mark[data-md-find]")) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script, style")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    const lower = text.toLowerCase();
    const ranges: Array<{ start: number; end: number }> = [];
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      ranges.push({ start: index, end: index + needle.length });
      from = index + needle.length;
    }
    if (ranges.length === 0) continue;

    for (let i = ranges.length - 1; i >= 0; i--) {
      const { start, end } = ranges[i]!;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const mark = document.createElement("mark");
      mark.dataset.mdFind = "1";
      mark.className = "md-find-hit rounded-sm bg-yellow-300/80 text-inherit dark:bg-yellow-500/50";
      try {
        range.surroundContents(mark);
        marks.unshift(mark);
      } catch {
        // skip odd DOM boundaries
      }
    }
  }
  return marks;
}

export default function SearchableMarkdown({
  content,
  fontSize,
  fontFamily,
  className,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const marksRef = useRef<HTMLElement[]>([]);
  const currentRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);

  const closeFind = () => {
    clearMarks(marksRef.current);
    marksRef.current = [];
    currentRef.current = 0;
    setTotal(0);
    setCurrent(0);
    setOpen(false);
  };

  const jumpTo = (index: number, marks: HTMLElement[]) => {
    if (marks.length === 0) {
      currentRef.current = 0;
      setCurrent(0);
      return;
    }
    const next = ((index % marks.length) + marks.length) % marks.length;
    for (const [i, mark] of marks.entries()) {
      mark.classList.toggle("ring-2", i === next);
      mark.classList.toggle("ring-orange-500", i === next);
    }
    marks[next]?.scrollIntoView({ block: "center", behavior: "smooth" });
    currentRef.current = next;
    setCurrent(next + 1);
  };

  const runSearch = (value: string, preferIndex = 0) => {
    const root = rootRef.current;
    clearMarks(marksRef.current);
    marksRef.current = [];
    if (!root || !value.trim()) {
      currentRef.current = 0;
      setTotal(0);
      setCurrent(0);
      return;
    }
    const marks = highlightMatches(root, value.trim());
    marksRef.current = marks;
    setTotal(marks.length);
    jumpTo(preferIndex, marks);
  };

  useEffect(() => {
    return registerFinder((context) => {
      if (context.preferTerminal) return false;
      const root = rootRef.current;
      if (!root?.isConnected) return false;
      const rect = root.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      setOpen(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return true;
    });
  }, []);

  useEffect(() => {
    clearMarks(marksRef.current);
    marksRef.current = [];
    setTotal(0);
    setCurrent(0);
    if (open && query.trim()) {
      const id = requestAnimationFrame(() => runSearch(query));
      return () => cancelAnimationFrame(id);
    }
    return undefined;
    // Re-run highlights when markdown content remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    return () => {
      clearMarks(marksRef.current);
      marksRef.current = [];
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("relative h-full", className)}>
      {open
        ? (
          <div
            data-md-find
            className="absolute top-2 right-2 z-10 flex w-80 items-center gap-1 rounded-md border bg-popover/95 p-1.5 shadow-md backdrop-blur-sm"
          >
            <Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                runSearch(value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeFind();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (marksRef.current.length === 0) return;
                  jumpTo(
                    event.shiftKey
                      ? currentRef.current - 1
                      : currentRef.current + 1,
                    marksRef.current,
                  );
                }
              }}
              placeholder="Cari di markdown…"
              className="h-7 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
            />
            <span className="shrink-0 px-1 text-[10px] text-muted-foreground tabular-nums">
              {total > 0 ? `${current}/${total}` : "0/0"}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => jumpTo(currentRef.current - 1, marksRef.current)}
              disabled={total === 0}
              aria-label="Previous match"
              title="Previous"
            >
              <ChevronUp />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => jumpTo(currentRef.current + 1, marksRef.current)}
              disabled={total === 0}
              aria-label="Next match"
              title="Next"
            >
              <ChevronDown />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={closeFind}
              aria-label="Close find"
              title="Close"
            >
              <X />
            </Button>
          </div>
        )
        : null}
      <div className="h-full overflow-y-auto">
        <div className="px-8 py-6">
          <MarkdownView
            content={content}
            fontSize={fontSize}
            fontFamily={fontFamily}
          />
        </div>
      </div>
    </div>
  );
}
