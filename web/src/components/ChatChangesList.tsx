import { useMemo, useState } from "react";
import { ChevronRight, ExternalLink, FileCode2, FilePlus2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FileChange } from "@/lib/api";
import { summarizeChanges } from "@/lib/chat-changes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  changes: FileChange[];
  /** Buka path di tab editor. Tanpa prop ini daftar hanya informatif. */
  onOpenFile?: (path: string) => void;
  /** Mulai dalam keadaan terbuka. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Daftar file yang diubah/dibuat setelah chat selesai, di dalam collapsible.
 * Klik satu baris untuk membuka file tersebut di tab editor.
 */
export function ChatChangesList({ changes, onOpenFile, defaultOpen = false, className }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const summary = useMemo(() => summarizeChanges(changes), [changes]);

  const describeSummary = () => {
    const parts: string[] = [];
    if (summary.created > 0) parts.push(t("chat.changes.created", { count: summary.created }));
    if (summary.updated > 0) parts.push(t("chat.changes.updated", { count: summary.updated }));
    return parts.join(", ");
  };

  const actionLabel = (action: "create" | "update") =>
    t(action === "create" ? "chat.changes.action.create" : "chat.changes.action.update");

  if (summary.files.length === 0) return null;

  return (
    <div className={cn("overflow-hidden rounded-md border border-border/60 bg-muted/20", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={open ? t("chat.changes.hide") : t("chat.changes.show")}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent/40"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0 font-medium">{t("chat.changes.title")}</span>
        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
          {summary.files.length}
        </Badge>
        <span className="truncate text-muted-foreground">{describeSummary()}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
          +{summary.added}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-red-600 dark:text-red-400">
          −{summary.removed}
        </span>
      </button>

      {open
        ? (
          <ul className="flex flex-col border-t border-border/60">
            {summary.files.map((file) => {
              const Icon = file.action === "create" ? FilePlus2 : FileCode2;
              const label = actionLabel(file.action);
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onOpenFile?.(file.path)}
                    disabled={!onOpenFile}
                    title={onOpenFile
                      ? t("chat.changes.openTitle", { path: file.path, action: label })
                      : t("chat.changes.pathWithAction", { path: file.path, action: label })}
                    aria-label={t("chat.changes.openAria", { path: file.path })}
                    className={cn(
                      "group flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] transition-colors",
                      onOpenFile
                        ? "hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
                        : "cursor-default",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-3 shrink-0",
                        file.action === "create"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
                      {file.path}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                      +{file.added}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-red-600 dark:text-red-400">
                      −{file.removed}
                    </span>
                    {onOpenFile
                      ? (
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                      )
                      : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )
        : null}
    </div>
  );
}
