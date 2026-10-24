import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { TerminalSession, type TerminalStatus } from "@/components/TerminalSession";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HEIGHT_KEY = "rnd.terminalHeight:v1";
const MIN_HEIGHT = 120;

interface Instance {
  id: string;
  title: string;
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
  return 260;
}

export function TerminalPanel({ projectId, open, onClose }: Props) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [height, setHeight] = useState(readHeight);
  const [statuses, setStatuses] = useState<
    Record<string, { status: TerminalStatus; detail?: string }>
  >({});
  const counterRef = useRef(1);

  const addInstance = useCallback(() => {
    const id = crypto.randomUUID();
    const title = `Terminal ${counterRef.current++}`;
    setInstances((current) => [...current, { id, title }]);
    setActiveId(id);
  }, []);

  const removeInstance = (id: string) => {
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
    counterRef.current = 1;
  }, [projectId]);

  useEffect(() => {
    if (open && projectId && instances.length === 0) addInstance();
  }, [open, projectId, instances.length, addInstance]);

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

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        Math.max(startHeight - (moveEvent.clientY - startY), MIN_HEIGHT),
        window.innerHeight * 0.75,
      );
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const active = instances.find((item) => item.id === activeId);
  const activeStatus = activeId ? statuses[activeId] : undefined;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-t bg-[var(--background)]",
        !open && "hidden",
      )}
      style={{ height }}
    >
      <div
        onPointerDown={startResize}
        role="separator"
        aria-orientation="horizontal"
        className="hover:bg-primary/40 h-1 shrink-0 cursor-row-resize transition-colors"
      />

      <div className="flex h-[35px] shrink-0 items-center justify-between gap-2 border-b px-2">
        <div className="flex min-w-0 items-center gap-1">
          <SquareTerminal className="mx-1 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {instances.map((instance) => {
              const status = statuses[instance.id]?.status;
              return (
                <div
                  key={instance.id}
                  className={cn(
                    "group flex h-[30px] shrink-0 items-center gap-1 rounded-t border-t-2 px-2 text-xs",
                    instance.id === activeId
                      ? "border-t-primary bg-[var(--tabbar)] text-foreground"
                      : "border-t-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(instance.id)}
                    className="flex items-center gap-1.5"
                    title={instance.title}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        status === "ready"
                          ? "bg-emerald-500"
                          : status === "error"
                          ? "bg-red-500"
                          : status === "closed"
                          ? "bg-muted-foreground"
                          : "bg-amber-500",
                      )}
                    />
                    <span className="max-w-32 truncate">{instance.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeInstance(instance.id)}
                    aria-label={`Tutup ${instance.title}`}
                    className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={addInstance}
            aria-label="Terminal baru"
            title="Terminal baru"
            disabled={!projectId}
          >
            <Plus />
          </Button>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {activeStatus?.detail ? (
            <span className="max-w-72 truncate font-mono">{activeStatus.detail}</span>
          ) : active ? (
            <span className="truncate">{active.title}</span>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onClose}
            aria-label="Sembunyikan terminal"
            title="Sembunyikan panel terminal"
          >
            <X />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-1">
        {!projectId ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Pilih project dulu untuk membuka terminal.
          </div>
        ) : instances.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Klik + untuk membuat terminal baru.
          </div>
        ) : (
          <div className="relative h-full w-full">
            {instances.map((instance) => (
              <div
                key={instance.id}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  instance.id !== activeId && "invisible pointer-events-none",
                )}
                aria-hidden={instance.id !== activeId}
              >
                <TerminalSession
                  projectId={projectId}
                  active={open && instance.id === activeId}
                  onStatus={(status, detail) =>
                    setStatuses((current) => ({
                      ...current,
                      [instance.id]: { status, detail },
                    }))}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
