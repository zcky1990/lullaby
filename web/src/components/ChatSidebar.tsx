import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, FileText, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  api,
  type ChatAttachment,
  type ChatPending,
  type ChatResponse,
  type ChatSession,
  type FileChange,
  type LlmProvider,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const MarkdownView = lazy(() => import("@/components/MarkdownView"));

interface Entry {
  role: "user" | "assistant";
  content: string;
  changes?: FileChange[];
  attachments?: DisplayAttachment[];
}

interface DisplayAttachment {
  name: string;
  type: "image" | "text" | "workspace";
  preview?: string;
  path?: string;
}

interface AttachmentDraft {
  id: string;
  name: string;
  type: "image" | "text" | "workspace";
  mime?: string;
  data?: string;
  path?: string;
}

interface PendingState {
  runId: string;
  items: ChatPending[];
}

const VARIANTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_BYTES = 200_000;
const MAX_ATTACHMENTS = 6;
const TEXT_FILE =
  /\.(txt|md|markdown|json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|scss|html|xml|yml|yaml|toml|ini|env|rb|py|go|rs|java|kt|swift|php|sh|bash|zsh|sql|csv|log|diff|patch)$/i;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

async function readAttachment(file: File): Promise<AttachmentDraft> {
  const isImage = file.type.startsWith("image/");
  const isText = file.type.startsWith("text/") || TEXT_FILE.test(file.name);
  if (!isImage && !isText) throw new Error(`Tipe file tidak didukung: ${file.name}`);
  if (isImage) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Gambar terlalu besar (maks 3 MB): ${file.name}`);
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      type: "image",
      mime: file.type || "image/png",
      data: await readAsDataUrl(file),
    };
  }
  if (file.size > MAX_TEXT_BYTES) {
    throw new Error(`File teks terlalu besar (maks 200 KB): ${file.name}`);
  }
  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: "text",
    mime: file.type || "text/plain",
    data: await file.text(),
  };
}

interface Props {
  projectId: string | null;
  providers: LlmProvider[];
  onClose: () => void;
  onOpenFile?: (path: string) => void;
}

export function ChatSidebar({ projectId, providers, onClose, onOpenFile }: Props) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [variant, setVariant] = useState("medium");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [dragging, setDragging] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!providerId && providers[0]) setProviderId(providers[0].id);
  }, [providers, providerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, sending, pending]);

  const refreshSessions = useCallback(async () => {
    if (!projectId) {
      setSessions([]);
      return;
    }
    try {
      const result = await api.listChatSessions(projectId);
      setSessions(result.sessions);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    setSessionId(null);
    setEntries([]);
    setAttachments([]);
    setPending(null);
    setError(undefined);
    refreshSessions().catch(console.error);
  }, [projectId, refreshSessions]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setError(undefined);
    const accepted: AttachmentDraft[] = [];
    for (const file of files) {
      try {
        accepted.push(await readAttachment(file));
      } catch (e) {
        setError((e as Error).message);
      }
    }
    if (!accepted.length) return;
    setAttachments((current) => {
      const next = [...current, ...accepted];
      if (next.length > MAX_ATTACHMENTS) {
        setError(`Maksimal ${MAX_ATTACHMENTS} lampiran per pesan.`);
        return next.slice(0, MAX_ATTACHMENTS);
      }
      return next;
    });
  }, []);

  const handleWorkspacePath = useCallback((path: string) => {
    if (!path) return;
    const name = path.split("/").pop() || path;
    setError(undefined);
    setAttachments((current) => {
      if (current.some((item) => item.path === path)) return current;
      if (current.length >= MAX_ATTACHMENTS) {
        setError(`Maksimal ${MAX_ATTACHMENTS} lampiran per pesan.`);
        return current;
      }
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          name,
          type: "workspace",
          path,
        },
      ];
    });
  }, []);

  const handleResponse = (response: ChatResponse) => {
    if (response.status === "done") {
      setPending(null);
      if (response.sessionId) setSessionId(response.sessionId);
      setEntries((current) => [
        ...current,
        {
          role: "assistant",
          content: response.message,
          changes: response.changes ?? [],
        },
      ]);
      refreshSessions().catch(console.error);
      return;
    }
    if (response.status === "approval_required") {
      if (response.sessionId) setSessionId(response.sessionId);
      setPending({ runId: response.runId, items: response.pending });
      refreshSessions().catch(console.error);
      return;
    }
    setError(response.error);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending || pending) return;
    if (!projectId) {
      setError("Pilih project dulu.");
      return;
    }
    if (providers.length === 0) {
      setError("Belum ada provider LLM (Project Settings → LLM).");
      return;
    }
    setError(undefined);
    const content = text || "Lihat lampiran.";
    const outgoing: ChatAttachment[] = attachments.map((item) =>
      item.type === "workspace"
        ? { type: "workspace", name: item.name, path: item.path ?? "" }
        : {
          type: item.type,
          name: item.name,
          mime: item.mime,
          data: item.data ?? "",
        }
    );
    const shown: DisplayAttachment[] = attachments.map((item) => ({
      name: item.name,
      type: item.type,
      preview: item.type === "image" ? item.data : undefined,
      path: item.path,
    }));
    setInput("");
    setAttachments([]);
    const next: Entry[] = [...entries, { role: "user", content, attachments: shown }];
    setEntries(next);
    setSending(true);
    try {
      const response = await api.chat(projectId, {
        providerId: providerId || undefined,
        sessionId: sessionId ?? undefined,
        variant,
        messages: next.map((entry, index) => ({
          role: entry.role,
          content: entry.content,
          ...(index === next.length - 1 && outgoing.length ? { attachments: outgoing } : {}),
        })),
      });
      handleResponse(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const approve = async (action: "once" | "always" | "deny") => {
    if (!pending) return;
    const item = pending.items[0];
    setSending(true);
    setError(undefined);
    try {
      const response = await api.chatApprove({ runId: pending.runId, id: item.id, action });
      handleResponse(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const selectSession = async (value: string) => {
    if (value === "new") {
      setSessionId(null);
      setEntries([]);
      setAttachments([]);
      setPending(null);
      setError(undefined);
      return;
    }
    if (!projectId) return;
    try {
      const detail = await api.getChatSession(projectId, value);
      setSessionId(value);
      setEntries(
        detail.messages.map((message) => ({
          role: message.role,
          content: message.content,
          changes: message.changes,
        })),
      );
      setPending(null);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeSession = async () => {
    if (!projectId || !sessionId) return;
    if (!confirm("Hapus sesi chat ini?")) return;
    try {
      await api.deleteChatSession(projectId, sessionId);
      setSessionId(null);
      setEntries([]);
      setPending(null);
      await refreshSessions();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <aside
      className="relative flex w-96 shrink-0 flex-col border-l bg-card/20"
      onDragOver={(event) => {
        const types = Array.from(event.dataTransfer.types);
        if (!types.includes("Files") && !types.includes("application/x-rnd-workspace-path")) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const workspacePath = event.dataTransfer.getData("application/x-rnd-workspace-path");
        if (workspacePath) {
          handleWorkspacePath(workspacePath);
          return;
        }
        if (event.dataTransfer.files.length) void handleFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-background/85">
          <p className="text-sm font-medium">Lepaskan file di sini</p>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">Chat</span>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Tutup chat">
          <X />
        </Button>
      </div>

      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Select value={sessionId ?? "new"} onValueChange={selectSession} disabled={!!pending}>
            <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Sesi chat">
              <SelectValue placeholder="Chat baru" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="new" >
                  <div className="flex items-center gap-2">
                    <Plus />
                    Chat baru
                  </div>
                </SelectItem>
                {sessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            onClick={removeSession}
            disabled={!sessionId || !!pending}
            aria-label="Hapus sesi chat"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Mulai chat dengan LLM. Lampirkan gambar/file teks atau seret file ke sini. Aplikasi
            dapat membaca/menulis file di workspace — setiap edit akan meminta persetujuan Anda.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry, index) => (
              <div
                key={index}
                className={cn(
                  "text-sm",
                  entry.role === "user"
                    ? "max-w-[85%] self-end rounded-lg border border-muted-foreground/10 px-3 py-2 text-primary"
                    : "w-full self-start",
                )}
              >
                {entry.attachments?.length ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {entry.attachments.map((item, itemIndex) =>
                      item.type === "image" && item.preview ? (
                        <img
                          key={itemIndex}
                          src={item.preview}
                          alt={item.name}
                          className="max-h-40 rounded-md border border-black/10 object-contain"
                        />
                      ) : (
                        <span
                          key={itemIndex}
                          className="flex items-center gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[11px]"
                          title={item.path ?? item.name}
                        >
                          {item.type === "workspace" ? (
                            <FileCode2 className="size-3" />
                          ) : (
                            <FileText className="size-3" />
                          )}
                          {item.type === "workspace" ? item.path : item.name}
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
                {entry.role === "assistant" ? (
                  entry.content ? (
                    <Suspense fallback={<Skeleton className="h-4 w-32" />}>
                      <MarkdownView content={entry.content} />
                    </Suspense>
                  ) : null
                ) : (
                  <span className="whitespace-pre-wrap">{entry.content}</span>
                )}
                {entry.changes?.length ? (
                  <Changes changes={entry.changes} onOpenFile={onOpenFile} />
                ) : null}
              </div>
            ))}
            {sending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Bekerja…
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t p-3">
        {pending ? (
          <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <p className="text-xs font-medium">Persetujuan diperlukan</p>
            <p className="text-sm">
              <span className="font-mono">{pending.items[0].summary}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => approve("once")} disabled={sending}>
                Allow once
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => approve("always")}
                disabled={sending}
              >
                Always allow
              </Button>
              <Button size="sm" variant="outline" onClick={() => approve("deny")} disabled={sending}>
                No
              </Button>
            </div>
            {pending.items.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                {pending.items.length - 1} permintaan lain menunggu.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="border-input focus-within:border-ring focus-within:ring-ring/50 flex flex-col rounded-md border bg-transparent shadow-xs focus-within:ring-[3px]">
          {attachments.length ? (
            <div className="flex flex-wrap gap-1.5 px-2 pt-2">
              {attachments.map((item) => (
                <div
                  key={item.id}
                  className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-1.5 py-1 text-xs"
                >
                  {item.type === "image" && item.data ? (
                    <img src={item.data} alt="" className="size-6 rounded object-cover" />
                  ) : item.type === "workspace" ? (
                    <FileCode2 className="size-3.5 text-muted-foreground" />
                  ) : (
                    <FileText className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="max-w-40 truncate" title={item.path ?? item.name}>
                    {item.type === "workspace" ? item.path : item.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((a) => a.id !== item.id))}
                    aria-label={`Hapus ${item.name}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length) {
                event.preventDefault();
                void handleFiles(files);
              }
            }}
            placeholder={
              pending ? "Selesaikan persetujuan dulu…" : "Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
            }
            disabled={!!pending}
            rows={3}
            className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-60"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,text/*,.md,.markdown,.json,.jsonc,.ts,.tsx,.js,.jsx,.mjs,.cjs,.css,.scss,.html,.xml,.yml,.yaml,.toml,.ini,.env,.rb,.py,.go,.rs,.java,.kt,.swift,.php,.sh,.bash,.zsh,.sql,.csv,.log,.diff,.patch"
              className="hidden"
              onChange={(event) => {
                const files = event.target.files;
                if (files) void handleFiles(Array.from(files));
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!pending}
              aria-label="Lampirkan file"
              title="Lampirkan gambar/file — atau seret file dari Explorer"
            >
              <Paperclip />
            </Button>
            <Select
              value={providerId}
              onValueChange={setProviderId}
              disabled={providers.length === 0 || !!pending}
            >
              <SelectTrigger
                size="sm"
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7"
                aria-label="Pilih model"
              >
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.model ?? provider.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={variant} onValueChange={setVariant} disabled={!!pending}>
              <SelectTrigger
                size="sm"
                className="h-7 w-20 shrink-0 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7"
                aria-label="Variant model"
              >
                <SelectValue placeholder="Variant" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {VARIANTS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="icon"
              className="ml-auto size-7 shrink-0"
              onClick={send}
              disabled={sending || !!pending || (!input.trim() && attachments.length === 0)}
              aria-label="Kirim"
            >
              {sending ? <Spinner /> : <Send />}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Changes({
  changes,
  onOpenFile,
}: {
  changes: FileChange[];
  onOpenFile?: (path: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {changes.map((change) => (
        <div key={change.path} className="overflow-hidden rounded-md border bg-background/70">
          <button
            type="button"
            onClick={() => onOpenFile?.(change.path)}
            className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent"
            title={`Buka ${change.path}`}
          >
            <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{change.path}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {change.action === "create" ? "baru" : "diubah"} · +{change.added} −{change.removed}
            </span>
          </button>
          <pre className="max-h-56 overflow-auto border-t bg-muted/30 px-2 py-1 text-[11px] leading-4">
            {change.diff.split("\n").map((line, index) => (
              <span
                key={index}
                className={cn(
                  "block whitespace-pre-wrap break-all",
                  line.startsWith("+") && "text-emerald-600 dark:text-emerald-400",
                  line.startsWith("-") && "text-red-600 dark:text-red-400",
                  !line.startsWith("+") && !line.startsWith("-") && "text-muted-foreground",
                )}
              >
                {line || " "}
              </span>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
