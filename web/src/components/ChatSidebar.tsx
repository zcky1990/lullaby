import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
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
import { api, type LlmProvider } from "@/lib/api";
import { cn } from "@/lib/utils";

const MarkdownView = lazy(() => import("@/components/MarkdownView"));

interface Entry {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  projectId: string | null;
  providers: LlmProvider[];
  onClose: () => void;
}

export function ChatSidebar({ projectId, providers, onClose }: Props) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!providerId && providers[0]) setProviderId(providers[0].id);
  }, [providers, providerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
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
      const res = await api.chat(projectId, {
        providerId: providerId || undefined,
        messages: next.map((entry) => ({ role: entry.role, content: entry.content })),
      });
      setEntries((current) => [...current, { role: "assistant", content: res.message }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
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
        <Select
          value={providerId}
          onValueChange={setProviderId}
          disabled={providers.length === 0}
        >
          <SelectTrigger size="sm" aria-label="Provider LLM">
            <SelectValue placeholder="Pilih provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.model ? ` · ${provider.model}` : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Mulai chat dengan LLM. Konfigurasikan provider di Project Settings → LLM.
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
                Mengetik…
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t p-3">
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
          placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
          rows={3}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        />
        <Button size="sm" onClick={send} disabled={sending} data-icon="inline-start">
          {sending ? <Spinner /> : <Send />}
          Kirim
        </Button>
      </div>
    </aside>
  );
}
