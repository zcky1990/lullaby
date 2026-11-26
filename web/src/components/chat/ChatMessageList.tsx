import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, CircleAlert, FileCode2, FileText, Sparkles } from "lucide-react";
import { ChatChangesList } from "@/components/ChatChangesList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { ChatStep, FileChange } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * PERF-2 (jalur terpanas aplikasi).
 *
 * Dulu `ChatSidebar` merender `entries.map(...)` langsung di JSX induk, jadi
 * setiap perubahan state lokal (ketikan composer, `steps`, `sending`, `width`,
 * `dragging`, `skillQuery`) ikut me-render ulang SEMUA pesan — dan tiap pesan
 * assistant menjalankan ulang `MarkdownView` (chunk ±159 KB).
 *
 * Sekarang:
 * - `ChatMessageItem` di-`memo` dengan props primitif + referensi stabil
 *   (`changes`/`attachments` hanya berubah saat entri itu sendiri diubah).
 * - `ChatMessageList` di-`memo` sehingga render ulang composer berhenti di
 *   subtree composer, tidak menyentuh transkrip.
 * - Auto-scroll hanya jalan saat pengguna mengirim pesan atau sedang berada di
 *   dasar transkrip (tidak melawan saat membaca history).
 * - `content-visibility: auto` + `contain-intrinsic-size` untuk pesan di luar
 *   viewport, plus windowing ringan (200 pesan terakhir, bisa ditambah) supaya
 *   sesi 300+ pesan tetap ringan tanpa dependensi baru.
 */
const MarkdownView = lazy(() => import("@/components/MarkdownView"));

export interface DisplayAttachment {
  name: string;
  type: "image" | "text" | "workspace";
  preview?: string;
  path?: string;
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  skillName?: string;
  changes?: FileChange[];
  attachments?: DisplayAttachment[];
}

/** Jarak (px) dari dasar transkrip yang masih dianggap "menempel di bawah". */
const BOTTOM_SLACK_PX = 72;
/** Jumlah pesan yang dirender pertama kali (sisanya lewat tombol "muat"). */
const WINDOW_INITIAL = 200;
const WINDOW_STEP = 100;
/** Lewati layout/paint pesan yang berada di luar viewport. */
const CONTAINMENT = "[content-visibility:auto] [contain-intrinsic-size:auto_120px]";

interface ChatMessageItemProps {
  id: string;
  role: "user" | "assistant";
  content: string;
  skillName?: string;
  attachments?: DisplayAttachment[];
  changes?: FileChange[];
  fontFamily: string;
  fontSize: number;
  onOpenFile: (path: string) => void;
}

/**
 * Satu baris transkrip. Semua props primitif (atau referensi yang stabil antar
 * render), sehingga `memo` benar-benar memblokir render ulang pesan lama.
 */
export const ChatMessageItem = memo(function ChatMessageItem({
  role,
  content,
  skillName,
  attachments,
  changes,
  fontFamily,
  fontSize,
  onOpenFile,
}: ChatMessageItemProps) {
  return (
    <div
      className={cn(
        "text-md",
        CONTAINMENT,
        role === "user"
          ? "max-w-[85%] self-end rounded-lg border border-muted-foreground/10 px-3 py-2 text-primary"
          : "w-full self-start",
      )}
    >
      {skillName ? (
        <div className="mb-1.5">
          <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
            <Sparkles className="size-3" />
            /{skillName}
          </Badge>
        </div>
      ) : null}
      {attachments?.length
        ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((item, itemIndex) =>
              item.type === "image" && item.preview
                ? (
                  <img
                    key={itemIndex}
                    src={item.preview}
                    alt={item.name}
                    className="max-h-40 rounded-md border border-black/10 object-contain"
                  />
                )
                : (
                  <span
                    key={itemIndex}
                    className="flex items-center gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[11px]"
                    title={item.path ?? item.name}
                  >
                    {item.type === "workspace"
                      ? <FileCode2 className="size-3" />
                      : <FileText className="size-3" />}
                    {item.type === "workspace" ? item.path : item.name}
                  </span>
                )
            )}
          </div>
        )
        : null}
      {role === "assistant"
        ? (
          <>
            {content
              ? (
                <Suspense fallback={<Skeleton className="h-4 w-32" />}>
                  <MarkdownView
                    content={content}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                  />
                </Suspense>
              )
              : null}
            {changes?.length
              ? (
                <ChatChangesList
                  changes={changes}
                  onOpenFile={onOpenFile}
                  className="mt-2"
                />
              )
              : null}
          </>
        )
        : <span className="whitespace-pre-wrap">{content}</span>}
    </div>
  );
});

interface ChatStepsPanelProps {
  steps: ChatStep[];
  sending: boolean;
  permissionBusy: string | null;
  onDecidePermission: (step: ChatStep, decision: "once" | "always" | "deny") => void;
}

/** Panel langkah/tool yang sedang berjalan. */
export const ChatStepsPanel = memo(function ChatStepsPanel({
  steps,
  sending,
  permissionBusy,
  onDecidePermission,
}: ChatStepsPanelProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/50 bg-muted/20 p-2">
      {steps.map((step) => (
        <div
          key={step.id}
          className={cn(
            "flex items-start gap-2 text-xs",
            step.toolName === "spawn_agent" && "ml-3 border-l border-border/60 pl-2",
          )}
        >
          {step.status === "running"
            ? <Spinner className="mt-0.5 size-3 shrink-0" />
            : step.status === "error"
            ? <CircleAlert className="mt-0.5 size-3 shrink-0 text-destructive" />
            : <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" />}
          <div className="min-w-0">
            <p
              className={cn(
                "font-medium",
                step.status === "done" && "text-muted-foreground",
                step.toolName === "spawn_agent" && "text-[11px]",
              )}
            >
              {step.title}
            </p>
            {step.detail ? (
              <p className="break-words text-muted-foreground/80">{step.detail}</p>
            ) : null}
            {step.kind === "permission" && step.status === "running"
              ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={permissionBusy !== null || step.runId === undefined}
                    onClick={() => onDecidePermission(step, "once")}
                  >
                    Allow once
                  </Button>
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={permissionBusy !== null || step.runId === undefined}
                    onClick={() => onDecidePermission(step, "always")}
                  >
                    Always allow
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-destructive"
                    disabled={permissionBusy !== null || step.runId === undefined}
                    onClick={() => onDecidePermission(step, "deny")}
                  >
                    No
                  </Button>
                </div>
              )
              : null}
          </div>
        </div>
      ))}
      {sending && steps.length === 0
        ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            Bekerja…
          </div>
        )
        : null}
    </div>
  );
});

interface ChatMessageListProps {
  entries: ChatEntry[];
  steps: ChatStep[];
  sending: boolean;
  permissionBusy: string | null;
  fontFamily: string;
  fontSize: number;
  onOpenFile: (path: string) => void;
  onDecidePermission: (step: ChatStep, decision: "once" | "always" | "deny") => void;
}

/**
 * Transkrip chat + panel langkah. Di-`memo` supaya perubahan state di induk
 * (composer, lebar panel, dsb.) tidak me-render ulang isi transkrip.
 */
export const ChatMessageList = memo(function ChatMessageList({
  entries,
  steps,
  sending,
  permissionBusy,
  fontFamily,
  fontSize,
  onOpenFile,
  onDecidePermission,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** `true` selama pengguna masih menempel di dasar transkrip. */
  const stickToBottomRef = useRef(true);
  const lastCountRef = useRef(0);
  const [windowSize, setWindowSize] = useState(WINDOW_INITIAL);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance <= BOTTOM_SLACK_PX;
  }, []);

  // Auto-scroll hanya bila pengguna mengirim pesan baru atau memang sedang
  // menempel di dasar; kalau sedang membaca history ke atas, jangan dilawan.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = entries.length !== lastCountRef.current;
    lastCountRef.current = entries.length;
    const lastEntry = entries[entries.length - 1];
    const userSent = grew && lastEntry?.role === "user";
    if (!userSent && !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  // Panel langkah muncul/hilang mengubah tinggi transkrip; ikuti hanya kalau
  // pengguna masih di dasar (tidak dipanggil per token, hanya saat jumlah
  // langkah berubah atau status kirim berubah).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [steps.length, sending]);

  const hidden = entries.length > windowSize ? entries.length - windowSize : 0;
  const visible = hidden > 0 ? entries.slice(hidden) : entries;

  const revealOlder = useCallback(() => {
    const el = scrollRef.current;
    const heightBefore = el?.scrollHeight ?? 0;
    setWindowSize((current) => current + WINDOW_STEP);
    requestAnimationFrame(() => {
      if (!el) return;
      // Jaga posisi baca: pesan lama ditambahkan di atas, bukan menggeser layar.
      el.scrollTop += el.scrollHeight - heightBefore;
      stickToBottomRef.current = false;
    });
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="chat-surface flex-1 overflow-y-auto p-3"
      style={{ fontFamily, fontSize: `${fontSize}px` }}
    >
      {entries.length === 0
        ? (
          <p className="text-muted-foreground">
            Mulai chat dengan LLM. Lampirkan gambar/file teks, atau seret file, dokumen, dan tiket
            dari panel kiri ke sini sebagai konteks. Aplikasi dapat membaca/menulis file di
            workspace — setiap edit langsung diterapkan lalu bisa di-review atau di-revert setelah
            chat selesai.
          </p>
        )
        : (
          <div className="flex flex-col gap-3">
            {hidden > 0
              ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 self-center text-xs text-muted-foreground"
                  onClick={revealOlder}
                >
                  Tampilkan {Math.min(WINDOW_STEP, hidden)} pesan sebelumnya ({hidden} belum tampil)
                </Button>
              )
              : null}
            {visible.map((entry) => (
              <ChatMessageItem
                key={entry.id}
                id={entry.id}
                role={entry.role}
                content={entry.content}
                skillName={entry.skillName}
                attachments={entry.attachments}
                changes={entry.changes}
                fontFamily={fontFamily}
                fontSize={fontSize}
                onOpenFile={onOpenFile}
              />
            ))}
            {steps.length > 0 || sending
              ? (
                <ChatStepsPanel
                  steps={steps}
                  sending={sending}
                  permissionBusy={permissionBusy}
                  onDecidePermission={onDecidePermission}
                />
              )
              : null}
          </div>
        )}
    </div>
  );
});
