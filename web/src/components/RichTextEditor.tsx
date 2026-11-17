import { useEffect, useRef } from "react";
import {
  Bold,
  Code2,
  Eraser,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const ACTIONS = [
  { labelKey: "documents.richText.bold", icon: Bold, command: "bold" },
  { labelKey: "documents.richText.italic", icon: Italic, command: "italic" },
  { labelKey: "documents.richText.underline", icon: Underline, command: "underline" },
  { labelKey: "documents.richText.strikethrough", icon: Strikethrough, command: "strikeThrough" },
  { labelKey: "documents.richText.heading", icon: Heading2, command: "formatBlock", arg: "h2" },
  { labelKey: "documents.richText.bulletList", icon: List, command: "insertUnorderedList" },
  { labelKey: "documents.richText.numberedList", icon: ListOrdered, command: "insertOrderedList" },
  { labelKey: "documents.richText.quote", icon: Quote, command: "formatBlock", arg: "blockquote" },
  { labelKey: "documents.richText.codeBlock", icon: Code2, command: "formatBlock", arg: "pre" },
];

export function RichTextEditor({ value, onChange, placeholder, disabled, className }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const safe = sanitizeHtml(value);
    if (safe !== element.innerHTML) element.innerHTML = safe;
  }, [value]);

  const emit = () => {
    const raw = ref.current?.innerHTML ?? "";
    const clean = sanitizeHtml(raw);
    if (ref.current && clean !== raw) ref.current.innerHTML = clean;
    onChange(clean);
  };

  const exec = (command: string, arg?: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const clean = html ? sanitizeHtml(html) : text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    document.execCommand("insertHTML", false, clean);
    emit();
  };

  return (
    <div
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring/50 flex flex-col rounded-md border bg-transparent shadow-xs focus-within:ring-[3px]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b p-1">
        {ACTIONS.map(({ labelKey, icon: Icon, command, arg }) => (
          <Button
            key={labelKey}
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t(labelKey)}
            title={t(labelKey)}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => exec(command, arg)}
          >
            <Icon />
          </Button>
        ))}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("documents.richText.clearFormat")}
          title={t("documents.richText.clearFormat")}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("removeFormat")}
        >
          <Eraser />
        </Button>
      </div>
      <div className="relative">
        <div
          ref={ref}
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder ?? t("documents.richText.ariaLabel")}
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          suppressContentEditableWarning
          className={cn(
            "min-h-28 w-full px-3 py-2 text-xs outline-none",
            "[&_p]:mb-2 last:[&_p]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
            "[&_h1]:mb-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold",
            "[&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
            "[&_blockquote]:text-muted-foreground [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted",
            "[&_pre]:p-2 [&_pre]:font-mono [&_code]:font-mono [&_a]:underline",
            disabled && "opacity-60",
          )}
        />
        {!value ? (
          <span className="pointer-events-none absolute inset-x-0 top-0 px-3 py-2 text-xs text-muted-foreground">
            {placeholder}
          </span>
        ) : null}
      </div>
    </div>
  );
}
