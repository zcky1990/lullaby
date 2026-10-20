import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Plus, Send, Trash2, X } from "lucide-react";
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
  type ChatPending,
  type ChatResponse,
  type ChatSession,
  type LlmProvider,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const MarkdownView = lazy(() => import("@/components/MarkdownView"));

interface Entry {
  role: "user" | "assistant";
  content: string;
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

interface Props {
  projectId: string | null;
  providers: LlmProvider[];
  onClose: () => void;
}

export function ChatSidebar({ projectId, providers, onClose }: Props) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [variant, setVariant] = useState("medium");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setPending(null);
    setError(undefined);
    refreshSessions().catch(console.error);
  }, [projectId, refreshSessions]);

  const handleResponse = (response: ChatResponse) => {
    if (response.status === "done") {
      setPending(null);
      if (response.sessionId) setSessionId(response.sessionId);
      setEntries((current) => [...current, { role: "assistant", content: response.message }]);
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
    if (!text || sending || pending) return;
    if (!projectId) {
      setError("Pilih project dulu.");
      return;
    }
    if (providers.length === 0) {
      setError("Belum ada provider LLM (Project Settings → LLM).");
      return;
    }
    setError(undefined);
    setInput("");
    const next: Entry[] = [...entries, { role: "user", content: text }];
    setEntries(next);
    setSending(true);
    try {
      const response = await api.chat(projectId, {
        providerId: providerId || undefined,
        sessionId: sessionId ?? undefined,
        variant,
        messages: next.map((entry) => ({ role: entry.role, content: entry.content })),
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
      setPending(null);
      setError(undefined);
      return;
    }
    if (!projectId) return;
    try {
      const detail = await api.getChatSession(projectId, value);
      setSessionId(value);
      setEntries(detail.messages);
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
    <aside className="flex w-96 shrink-0 flex-col border-l bg-card/20">
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
              <SelectValue placeholder="Chat baru" className="truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="new">
                  <Plus />
                  Chat baru
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
            Mulai chat dengan LLM. Aplikasi dapat membaca/menulis file di workspace — setiap edit
            akan meminta persetujuan Anda.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry, index) => (
              <div
                key={index}
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  entry.role === "user"
                    ? "bg-primary text-primary-foreground self-end"
                    : "bg-muted self-start",
                )}
              >
                {entry.role === "assistant" ? (
                  <Suspense fallback={<Skeleton className="h-4 w-32" />}>
                    <MarkdownView content={entry.content} />
                  </Suspense>
                ) : (
                  <span className="whitespace-pre-wrap">{entry.content}</span>
                )}
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
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            pending ? "Selesaikan persetujuan dulu…" : "Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
          }
          disabled={!!pending}
          rows={3}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-60"
        />
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Model</span>
            <Select
              value={providerId}
              onValueChange={setProviderId}
              disabled={providers.length === 0 || !!pending}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Pilih model">
                <SelectValue placeholder="Pilih model" className="truncate" />
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
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Variant</span>
            <Select value={variant} onValueChange={setVariant} disabled={!!pending}>
              <SelectTrigger size="sm" className="w-full" aria-label="Variant model">
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
          </div>
        </div>
        <Button
          size="sm"
          onClick={send}
          disabled={sending || !!pending}
          data-icon="inline-start"
          className="w-full"
        >
          {sending ? <Spinner /> : <Send />}
          Kirim
        </Button>
      </div>
    </aside>
  );
}
