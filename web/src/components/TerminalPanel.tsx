import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Eraser,
  FolderOpen,
  Plus,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import {
  TerminalSession,
  type TerminalHandle,
  type TerminalStatus,
} from "@/components/TerminalSession";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, type TerminalShell } from "@/lib/api";
import { cn } from "@/lib/utils";

const HEIGHT_KEY = "rnd.terminalHeight:v1";
const MIN_HEIGHT = 140;

interface Instance {
  id: string;
  title: string;
  shell: TerminalShell;
}

interface Props {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
}

function readHeight(): number {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(value) && value >= MIN_HEIGHT) return value;
  } catch {
    // ignore
  }
  return 280;
}

function statusLabel(status: TerminalStatus | undefined): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "connecting":
      return "Connecting";
    case "error":
      return "Error";
    case "closed":
      return "Exited";
    default:
      return "";
  }
}

function shortenPath(path: string | undefined): string {
  if (!path) return "";
  const home = path.match(/^\/Users\/[^/]+(.*)$/);
  if (home) return `~${home[1] || ""}`;
  return path;
}

export function TerminalPanel({ projectId, open, onClose }: Props) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [height, setHeight] = useState(readHeight);
  const [statuses, setStatuses] = useState<
    Record<string, { status: TerminalStatus; detail?: string }>
  >({});
  const [resizing, setResizing] = useState(false);
  const [shell, setShell] = useState<TerminalShell>("zsh");
  const [defaultReady, setDefaultReady] = useState(false);
  const counterRef = useRef(1);
  const handlesRef = useRef<Map<string, TerminalHandle>>(new Map());

  const addInstance = useCallback((nextShell: TerminalShell = shell) => {
    const id = crypto.randomUUID();
    const n = counterRef.current++;
    const title = `${nextShell} ${n}`;
    setInstances((current) => [...current, { id, title, shell: nextShell }]);
    setActiveId(id);
  }, [shell]);

  const removeInstance = (id: string) => {
    handlesRef.current.delete(id);
    setInstances((current) => {
      const next = current.filter((item) => item.id !== id);
      setActiveId((active) => {
        if (active !== id) return active;
        return next[next.length - 1]?.id ?? null;
      });
      return next;
    });
    setStatuses((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  useEffect(() => {
    setInstances([]);
    setActiveId(null);
    setStatuses({});
    handlesRef.current.clear();
    counterRef.current = 1;
    setDefaultReady(false);
    let cancelled = false;
    api
      .getTerminalSettings()
      .then((res) => {
        if (!cancelled) setShell(res.shell);
      })
      .catch(() => {
        // keep zsh fallback
      })
      .finally(() => {
        if (!cancelled) setDefaultReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (open && projectId && defaultReady && instances.length === 0) addInstance(shell);
  }, [open, projectId, defaultReady, instances.length, addInstance, shell]);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      // ignore
    }
  }, [height]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    setResizing(true);

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        Math.max(startHeight - (moveEvent.clientY - startY), MIN_HEIGHT),
        window.innerHeight * 0.75,
      );
      setHeight(next);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const active = instances.find((item) => item.id === activeId);
  const activeStatus = activeId ? statuses[activeId] : undefined;
  const cwd = shortenPath(activeStatus?.detail);

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-t bg-background",
        !open && "hidden",
        resizing && "select-none",
      )}
      style={{ height }}
    >
      <div
        onPointerDown={startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        className="group relative flex h-1.5 shrink-0 cursor-row-resize items-center justify-center"
      >
        <span
          className={cn(
            "h-0.5 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/60",
            resizing && "bg-primary",
          )}
        />
      </div>

      <div className="flex h-9 shrink-0 items-stretch justify-between gap-2 border-b bg-[var(--tabbar)] px-1">
        <div className="flex min-w-0 items-stretch gap-1">
          <div className="flex items-center gap-1.5 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <SquareTerminal className="size-3.5 shrink-0" />
            <span>Terminal</span>
          </div>

          <div className="flex min-w-0 items-stretch overflow-x-auto">
            {instances.map((instance) => {
              const status = statuses[instance.id]?.status;
              const selected = instance.id === activeId;
              return (
                <div
                  key={instance.id}
                  className={cn(
                    "group flex h-full shrink-0 items-center gap-1.5 border-t-2 px-2.5 text-xs",
                    selected
                      ? "border-t-primary bg-background text-foreground"
                      : "border-t-transparent text-muted-foreground hover:bg-accent/70",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(instance.id)}
                    className="flex max-w-40 items-center gap-1.5"
                    title={instance.title}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        status === "ready" && "bg-emerald-500",
                        status === "error" && "bg-destructive",
                        status === "closed" && "bg-muted-foreground",
                        (!status || status === "connecting") && "animate-pulse bg-amber-500",
                      )}
                    />
                    <span className="truncate font-mono text-[12px]">{instance.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeInstance(instance.id)}
                    aria-label={`Tutup ${instance.title}`}
                    className={cn(
                      "rounded p-0.5 hover:bg-accent",
                      selected ? "opacity-60" : "opacity-0 group-hover:opacity-60",
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <Select
            value={shell}
            onValueChange={(value) => setShell(value as TerminalShell)}
            disabled={!projectId}
          >
            <SelectTrigger
              className="my-auto h-7 w-[4.75rem] shrink-0 border-0 bg-transparent px-1.5 text-[11px] shadow-none"
              aria-label="Shell untuk terminal baru"
              title="Shell untuk terminal baru"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="zsh">zsh</SelectItem>
                <SelectItem value="bash">bash</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="my-auto size-7 shrink-0"
            onClick={() => addInstance(shell)}
            aria-label="Terminal baru"
            title={`Terminal baru (${shell})`}
            disabled={!projectId}
          >
            <Plus />
          </Button>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-1 px-1">
          {cwd ? (
            <span
              className="mr-1 hidden max-w-64 items-center gap-1 truncate font-mono text-[11px] text-muted-foreground sm:inline-flex"
              title={activeStatus?.detail}
            >
              <FolderOpen className="size-3 shrink-0 opacity-70" />
              {cwd}
            </span>
          ) : null}
          {activeStatus?.status ? (
            <span
              className={cn(
                "mr-1 hidden rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase sm:inline",
                activeStatus.status === "ready" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                activeStatus.status === "connecting" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                activeStatus.status === "error" && "bg-destructive/15 text-destructive",
                activeStatus.status === "closed" && "bg-muted text-muted-foreground",
              )}
            >
              {statusLabel(activeStatus.status)}
            </span>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!activeId}
            onClick={() => activeId && handlesRef.current.get(activeId)?.clear()}
            aria-label="Clear terminal"
            title="Clear"
          >
            <Eraser />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!activeId}
            onClick={() => activeId && removeInstance(activeId)}
            aria-label="Kill terminal"
            title="Kill terminal"
          >
            <Trash2 />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onClose}
            aria-label="Sembunyikan terminal"
            title="Sembunyikan panel"
          >
            <ChevronDown />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-background">
        {!projectId ? (
          <Empty className="h-full border-0 p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SquareTerminal />
              </EmptyMedia>
              <EmptyTitle>Belum ada project</EmptyTitle>
              <EmptyDescription>Pilih project di Workspace untuk membuka terminal.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : instances.length === 0 ? (
          <Empty className="h-full border-0 p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Plus />
              </EmptyMedia>
              <EmptyTitle>Tidak ada terminal</EmptyTitle>
              <EmptyDescription>Klik + untuk membuat session baru.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="relative h-full w-full">
            {instances.map((instance) => {
              const status = statuses[instance.id]?.status;
              const selected = instance.id === activeId;
              return (
                <div
                  key={instance.id}
                  className={cn(
                    "absolute inset-0 h-full w-full",
                    !selected && "invisible pointer-events-none",
                  )}
                  aria-hidden={!selected}
                >
                  {status === "connecting" && selected ? (
                    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                      <span className="inline-flex items-center gap-1.5 rounded-md border bg-popover/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
                        <Spinner className="size-3" />
                        Connecting…
                      </span>
                    </div>
                  ) : null}
                  {status === "error" && selected ? (
                    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                      <span className="inline-flex max-w-[90%] items-center truncate rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive shadow-sm">
                        {statuses[instance.id]?.detail || "Terminal error"}
                      </span>
                    </div>
                  ) : null}
                  <TerminalSession
                    projectId={projectId}
                    shell={instance.shell}
                    active={open && selected}
                    onReady={(handle) => handlesRef.current.set(instance.id, handle)}
                    onStatus={(next, detail) =>
                      setStatuses((current) => ({
                        ...current,
                        [instance.id]: { status: next, detail },
                      }))}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
