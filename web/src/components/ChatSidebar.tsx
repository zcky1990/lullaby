import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, FileText, Paperclip, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { SkillMentionMenu, type SkillOption } from "@/components/SkillMentionMenu";
import { Badge } from "@/components/ui/badge";
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
  type ChatMode,
  type ChatPending,
  type ChatResponse,
  type ChatSession,
  type FileChange,
  type LlmProvider,
  type PendingFileChange,
  type Role,
  type SkillInfo,
} from "@/lib/api";
import { CHAT_RESPONSE_EVENT, dispatchChangesApplied, dispatchReview } from "@/lib/review-events";
import { detectSlashQuery, parseSlashSkill } from "@/lib/slash-skill";
import { cn } from "@/lib/utils";

const MarkdownView = lazy(() => import("@/components/MarkdownView"));

interface Entry {
  id: string;
  role: "user" | "assistant";
  content: string;
  skillName?: string;
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
  changes: PendingFileChange[];
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

const SAFE_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

async function readAttachment(file: File): Promise<AttachmentDraft> {
  const mime = (file.type || "").toLowerCase();
  const isImage = SAFE_IMAGE_MIME.has(mime);
  const isText = mime.startsWith("text/") || TEXT_FILE.test(file.name);
  if (!isImage && !isText) {
    if (mime.startsWith("image/")) {
      throw new Error(`Tipe gambar tidak didukung (pakai PNG/JPEG/GIF/WebP): ${file.name}`);
    }
    throw new Error(`Tipe file tidak didukung: ${file.name}`);
  }
  if (isImage) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Gambar terlalu besar (maks 3 MB): ${file.name}`);
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      type: "image",
      mime,
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
  roles?: Role[];
  onClose: () => void;
  onTicketsChanged?: () => void;
  hidden?: boolean;
}

export function ChatSidebar({
  projectId,
  providers,
  roles = [],
  onClose,
  onTicketsChanged,
  hidden,
}: Props) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [variant, setVariant] = useState("medium");
  const [roleId, setRoleId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("rnd.chatRole:v1");
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState<ChatMode>(() => {
    try {
      return localStorage.getItem("rnd.chatMode:v1") === "plan" ? "plan" : "build";
    } catch {
      return "build";
    }
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [dragging, setDragging] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingState | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillActiveIndex, setSkillActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const enabledSkills = useMemo(
    () => skills.filter((skill) => skill.enabled).map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
    })),
    [skills],
  );

  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return enabledSkills.slice(0, 12);
    return enabledSkills
      .filter((skill) =>
        skill.name.includes(query) || skill.description.toLowerCase().includes(query)
      )
      .slice(0, 12);
  }, [enabledSkills, skillQuery]);

  useEffect(() => {
    if (!providerId && providers[0]) setProviderId(providers[0].id);
  }, [providers, providerId]);

  const activeRole = roles.find((role) => role.id === roleId) ?? null;
  const roleProviderId =
    activeRole?.providerId && providers.some((provider) => provider.id === activeRole.providerId)
      ? activeRole.providerId
      : null;

  useEffect(() => {
    if (roleId && roles.length > 0 && !roles.some((role) => role.id === roleId)) {
      setRoleId(null);
    }
  }, [roles, roleId]);

  useEffect(() => {
    if (roleProviderId) setProviderId(roleProviderId);
  }, [roleProviderId]);

  useEffect(() => {
    try {
      if (roleId) localStorage.setItem("rnd.chatRole:v1", roleId);
      else localStorage.removeItem("rnd.chatRole:v1");
    } catch {
      // ignore storage errors
    }
  }, [roleId]);

  useEffect(() => {
    try {
      localStorage.setItem("rnd.chatMode:v1", mode);
    } catch {
      // ignore storage errors
    }
  }, [mode]);

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
    let cancelled = false;
    if (!projectId) {
      setSkills([]);
      setSelectedSkill(null);
      return;
    }
    api
      .getSkills(projectId)
      .then((res) => {
        if (!cancelled) setSkills(res.enabled === false ? [] : res.skills);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const applySkillMention = (skill: SkillOption) => {
    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const slash = detectSlashQuery(input, cursor);
    if (slash.active && slash.start >= 0) {
      const before = input.slice(0, slash.start);
      const after = input.slice(cursor);
      const next = `${before}/${skill.name} ${after}`.replace(/\s{2,}/g, " ");
      setInput(next);
    } else {
      setInput((current) => {
        const trimmed = current.trim();
        if (!trimmed || trimmed.startsWith("/")) return `/${skill.name} `;
        return `/${skill.name} ${trimmed}`;
      });
    }
    setSelectedSkill(skill);
    setSkillMenuOpen(false);
    setSkillQuery("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const syncSkillMenu = (value: string, cursor?: number) => {
    const slash = detectSlashQuery(value, cursor ?? value.length);
    if (!slash.active) {
      setSkillMenuOpen(false);
      setSkillQuery("");
      return;
    }
    setSkillMenuOpen(true);
    setSkillQuery(slash.query);
    setSkillActiveIndex(0);
  };

  useEffect(() => {
    setSessionId(null);
    setEntries([]);
    setAttachments([]);
    setPending(null);
    setError(undefined);
    dispatchReview(null, null);
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
    if (response.status !== "error" && response.createdTickets?.length) {
      onTicketsChanged?.();
    }
    if (response.status === "done") {
      setPending(null);
      dispatchReview(null, null);
      if (response.changes?.length) {
        dispatchChangesApplied(response.changes.map((change) => change.path));
      }
      if (response.sessionId) setSessionId(response.sessionId);
      setEntries((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
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
      setPending({
        runId: response.runId,
        items: response.pending,
        changes: response.pendingChanges ?? [],
      });
      dispatchReview(response.runId, response.pendingChanges ?? []);
      refreshSessions().catch(console.error);
      return;
    }
    setError(response.error);
  };

  const responseRef = useRef(handleResponse);
  responseRef.current = handleResponse;

  useEffect(() => {
    const handler = (event: Event) => {
      const response = (event as CustomEvent<ChatResponse>).detail;
      if (response) responseRef.current(response);
    };
    window.addEventListener(CHAT_RESPONSE_EVENT, handler);
    return () => window.removeEventListener(CHAT_RESPONSE_EVENT, handler);
  }, []);

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0 && !selectedSkill) || sending || pending) return;
    if (!projectId) {
      setError("Pilih project dulu.");
      return;
    }
    if (providers.length === 0) {
      setError("Belum ada provider LLM (Global Settings → LLM Providers).");
      return;
    }
    setError(undefined);
    const parsed = parseSlashSkill(text);
    const skillName = selectedSkill?.name ?? parsed.skillName ?? undefined;
    const bodyText = selectedSkill && !parsed.skillName
      ? text
      : parsed.skillName
      ? parsed.text
      : text;
    const content = bodyText.trim() || (skillName ? `Ikuti skill /${skillName}.` : "Lihat lampiran.");
    const outgoing: ChatAttachment[] = attachments.map((item) =>
      item.type === "workspace" ? { type: "workspace", name: item.name, path: item.path ?? "" } : {
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
    setSelectedSkill(null);
    setSkillMenuOpen(false);
    const next: Entry[] = [
      ...entries,
      {
        id: crypto.randomUUID(),
        role: "user",
        content,
        skillName: skillName || undefined,
        attachments: shown,
      },
    ];
    setEntries(next);
    setSending(true);
    try {
      const response = await api.chat(projectId, {
        providerId: providerId || undefined,
        sessionId: sessionId ?? undefined,
        roleId: roleId ?? undefined,
        skillName,
        variant,
        mode,
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

  const selectSession = async (value: string) => {
    if (value === "new") {
      setSessionId(null);
      setEntries([]);
      setAttachments([]);
      setPending(null);
      setError(undefined);
      dispatchReview(null, null);
      return;
    }
    if (!projectId) return;
    try {
      const detail = await api.getChatSession(projectId, value);
      setSessionId(value);
      setEntries(
        detail.messages.map((message) => ({
          id: crypto.randomUUID(),
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
      className={cn(
        "relative flex w-96 shrink-0 flex-col border-l bg-[var(--sidebar)]",
        hidden && "hidden",
      )}
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
      {dragging
        ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-background/85">
            <p className="text-sm font-medium">Lepaskan file di sini</p>
          </div>
        )
        : null}

      <div className="flex items-center justify-between gap-3 border-b px-3 py-2 max-h-[40px] h-[40px]">
        <div className="flex items-center gap-1 w-3/4">
          <Select value={sessionId ?? "new"} onValueChange={selectSession} disabled={!!pending}>
            <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Sesi chat">
              <SelectValue placeholder="Chat baru" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="new">
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
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Tutup chat">
          <X />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {entries.length === 0
          ? (
            <p className="text-sm text-muted-foreground">
              Mulai chat dengan LLM. Lampirkan gambar/file teks atau seret file ke sini. Aplikasi
              dapat membaca/menulis file di workspace — setiap edit akan meminta persetujuan Anda.
            </p>
          )
          : (
            <div className="flex flex-col gap-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "text-md",
                    entry.role === "user"
                      ? "max-w-[85%] self-end rounded-lg border border-muted-foreground/10 px-3 py-2 text-primary"
                      : "w-full self-start",
                  )}
                >
                  {entry.skillName ? (
                    <div className="mb-1.5">
                      <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
                        <Sparkles className="size-3" />
                        /{entry.skillName}
                      </Badge>
                    </div>
                  ) : null}
                  {entry.attachments?.length
                    ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {entry.attachments.map((item, itemIndex) =>
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
                  {entry.role === "assistant"
                    ? (
                      entry.content
                        ? (
                          <Suspense fallback={<Skeleton className="h-4 w-32" />}>
                            <MarkdownView content={entry.content} />
                          </Suspense>
                        )
                        : null
                    )
                    : <span className="whitespace-pre-wrap">{entry.content}</span>}
                </div>
              ))}
              {sending
                ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    Bekerja…
                  </div>
                )
                : null}
            </div>
          )}
      </div>

      <div className="flex flex-col gap-2 border-t p-3">
        {pending && pending.changes.length > 0
          ? (
            <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
              <p className="text-xs font-medium">Perubahan menunggu review</p>
              <p className="text-xs text-muted-foreground">
                Diff dan tombol accept/reject tersedia di tab editor.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => dispatchReview(pending.runId, pending.changes)}
              >
                Buka review
              </Button>
            </div>
          )
          : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="border-input focus-within:border-ring focus-within:ring-ring/50 flex flex-col rounded-md border bg-transparent shadow-xs focus-within:ring-[3px]">
          {attachments.length
            ? (
              <div className="flex flex-wrap gap-1.5 px-2 pt-2">
                {attachments.map((item) => (
                  <div
                    key={item.id}
                    className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-1.5 py-1 text-xs"
                  >
                    {item.type === "image" && item.data
                      ? <img src={item.data} alt="" className="size-6 rounded object-cover" />
                      : item.type === "workspace"
                      ? <FileCode2 className="size-3.5 text-muted-foreground" />
                      : <FileText className="size-3.5 text-muted-foreground" />}
                    <span className="max-w-40 truncate" title={item.path ?? item.name}>
                      {item.type === "workspace" ? item.path : item.name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) => current.filter((a) => a.id !== item.id))}
                      aria-label={`Hapus ${item.name}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )
            : null}
          <div className="flex items-center gap-2 px-2 pt-2">
            <span className="w-9 shrink-0 text-[11px] text-muted-foreground">Role</span>
            <Select
              value={roleId ?? "none"}
              onValueChange={(value) => {
                const next = value === "none" ? null : value;
                setRoleId(next);
                const role = roles.find((item) => item.id === next);
                if (
                  role?.providerId &&
                  providers.some((provider) => provider.id === role.providerId)
                ) {
                  setProviderId(role.providerId);
                }
              }}
              disabled={!!pending}
            >
              <SelectTrigger
                size="sm"
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7"
                aria-label="Role chat"
              >
                <SelectValue placeholder="Tanpa role" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">Tanpa role</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {roleProviderId
              ? (
                <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                  LLM role
                </Badge>
              )
              : null}
          </div>
          <div className="relative">
            {skillMenuOpen ? (
              <SkillMentionMenu
                skills={filteredSkills}
                activeIndex={Math.min(skillActiveIndex, Math.max(filteredSkills.length - 1, 0))}
                onHover={setSkillActiveIndex}
                onSelect={applySkillMention}
              />
            ) : null}
            {selectedSkill ? (
              <div className="flex items-center gap-1 px-3 pt-2">
                <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
                  <Sparkles className="size-3" />
                  /{selectedSkill.name}
                  <button
                    type="button"
                    className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
                    aria-label="Hapus skill"
                    onClick={() => setSelectedSkill(null)}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => {
                const value = event.target.value;
                setInput(value);
                const parsed = parseSlashSkill(value);
                if (parsed.skillName) {
                  const match = enabledSkills.find((skill) => skill.name === parsed.skillName);
                  if (match) setSelectedSkill(match);
                }
                syncSkillMenu(value, event.target.selectionStart);
              }}
              onKeyDown={(event) => {
                if (skillMenuOpen && filteredSkills.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSkillActiveIndex((index) => (index + 1) % filteredSkills.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSkillActiveIndex((index) =>
                      (index - 1 + filteredSkills.length) % filteredSkills.length
                    );
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    applySkillMention(
                      filteredSkills[Math.min(skillActiveIndex, filteredSkills.length - 1)],
                    );
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSkillMenuOpen(false);
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length) {
                  event.preventDefault();
                  void handleFiles(files);
                }
              }}
              placeholder={pending
                ? "Selesaikan persetujuan dulu…"
                : "Tulis pesan… /skill-name · Enter kirim"}
              disabled={!!pending}
              rows={3}
              className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-60"
            />
          </div>
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,text/*,.md,.markdown,.json,.jsonc,.ts,.tsx,.js,.jsx,.mjs,.cjs,.css,.scss,.html,.xml,.yml,.yaml,.toml,.ini,.env,.rb,.py,.go,.rs,.java,.kt,.swift,.php,.sh,.bash,.zsh,.sql,.csv,.log,.diff,.patch"
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
              value={mode}
              onValueChange={(value) => setMode(value as ChatMode)}
              disabled={!!pending}
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-[4.75rem] shrink-0 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7"
                aria-label="Mode chat"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="plan">Plan</SelectItem>
                  <SelectItem value="build">Build</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={providerId}
              onValueChange={setProviderId}
              disabled={providers.length === 0 || !!pending || !!roleProviderId}
            >
              <SelectTrigger
                size="sm"
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7"
                aria-label="Pilih model"
                title={roleProviderId ? "Provider ditentukan oleh role" : undefined}
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
              disabled={sending || !!pending ||
                (!input.trim() && attachments.length === 0 && !selectedSkill)}
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
