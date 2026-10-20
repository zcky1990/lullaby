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
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const ACTIONS = [
  { label: "Bold", icon: Bold, command: "bold" },
  { label: "Italic", icon: Italic, command: "italic" },
  { label: "Underline", icon: Underline, command: "underline" },
  { label: "Strikethrough", icon: Strikethrough, command: "strikeThrough" },
  { label: "Heading", icon: Heading2, command: "formatBlock", arg: "h2" },
  { label: "Bullet list", icon: List, command: "insertUnorderedList" },
  { label: "Numbered list", icon: ListOrdered, command: "insertOrderedList" },
  { label: "Quote", icon: Quote, command: "formatBlock", arg: "blockquote" },
  { label: "Code block", icon: Code2, command: "formatBlock", arg: "pre" },
];

export function RichTextEditor({ value, onChange, placeholder, disabled, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (value !== element.innerHTML) element.innerHTML = value;
  }, [value]);

  const emit = () => onChange(ref.current?.innerHTML ?? "");

  const exec = (command: string, arg?: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
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
        {ACTIONS.map(({ label, icon: Icon, command, arg }) => (
          <Button
            key={label}
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={label}
            title={label}
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
          aria-label="Hapus format"
          title="Hapus format"
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
          onInput={emit}
          onBlur={emit}
          suppressContentEditableWarning
          className={cn(
            "min-h-28 w-full px-3 py-2 text-sm outline-none",
            "[&_p]:mb-2 last:[&_p]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
            "[&_h1]:mb-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold",
            "[&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
            "[&_blockquote]:text-muted-foreground [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted",
            "[&_pre]:p-2 [&_pre]:font-mono [&_code]:font-mono [&_a]:underline",
            disabled && "opacity-60",
          )}
        />
        {!value ? (
          <span className="pointer-events-none absolute inset-x-0 top-0 px-3 py-2 text-sm text-muted-foreground">
            {placeholder}
          </span>
        ) : null}
      </div>
    </div>
  );
}
