import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  CircleAlert,
  FileCode2,
  FileText,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { SkillMentionMenu, type SkillOption } from "@/components/SkillMentionMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  type ChatStep,
  type CursorModel,
  type FileChange,
  type LlmProvider,
  type PendingFileChange,
  type Role,
  type SkillInfo,
} from "@/lib/api";
import {
  AUTO_BUILD_EVENT,
  type AutoBuildDetail,
} from "@/lib/auto-build-events";
import { CHAT_RESPONSE_EVENT, dispatchChangesApplied, dispatchReview } from "@/lib/review-events";
import {
  AUTOSKILL_COMMAND,
  AUTOSKILL_OPTION,
  detectSlashQuery,
  isAutoskillCommand,
  matchesAutoskillQuery,
  parseSlashSkill,
} from "@/lib/slash-skill";
import { buildAutoBuildPrompt } from "@/lib/ticket-columns";
import { APP_FONT_STACKS, useTheme } from "@/components/ThemeProvider";
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
const CHAT_WIDTH_KEY = "rnd.chatWidth:v1";
const CHAT_MIN_WIDTH = 280;
const CHAT_MAX_WIDTH = 720;
const CHAT_DEFAULT_WIDTH = 384;
const CURSOR_VALUE_SEP = "::";

function readChatWidth(): number {
  try {
    const value = Number(localStorage.getItem(CHAT_WIDTH_KEY));
    if (
      Number.isFinite(value) && value >= CHAT_MIN_WIDTH && value <= CHAT_MAX_WIDTH
    ) {
      return value;
    }
  } catch {
    // ignore
  }
  return CHAT_DEFAULT_WIDTH;
}

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
  const [cursorModelsByProvider, setCursorModelsByProvider] = useState<
    Record<string, CursorModel[]>
  >({});
  const [cursorModelId, setCursorModelId] = useState("");
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
  const [resizing, setResizing] = useState(false);
  const [width, setWidth] = useState(readChatWidth);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [steps, setSteps] = useState<ChatStep[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingState | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillActiveIndex, setSkillActiveIndex] = useState(0);
  const { chatFont, chatFontSize } = useTheme();
  const chatFontFamily = APP_FONT_STACKS[chatFont];
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(width));
    } catch {
      // ignore
    }
  }, [width]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setResizing(true);
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        CHAT_MAX_WIDTH,
        Math.max(CHAT_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)),
      );
      setWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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
    const commandMatches = matchesAutoskillQuery(query) ? [AUTOSKILL_OPTION] : [];
    const skills = !query
      ? enabledSkills.slice(0, 11)
      : enabledSkills
        .filter((skill) =>
          skill.name.includes(query) || skill.description.toLowerCase().includes(query)
        )
        .slice(0, 11);
    return [...commandMatches, ...skills].slice(0, 12);
  }, [enabledSkills, skillQuery]);

  useEffect(() => {
    if (!providerId && providers[0]) setProviderId(providers[0].id);
  }, [providers, providerId]);

  const activeProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const cursorModels = activeProvider?.provider === "cursor"
    ? (cursorModelsByProvider[activeProvider.id] ?? activeProvider.models ?? [])
    : [];

  const providerSelectValue = activeProvider?.provider === "cursor" && cursorModelId
    ? `${providerId}${CURSOR_VALUE_SEP}${cursorModelId}`
    : providerId;

  const selectProviderValue = (value: string) => {
    const sep = value.indexOf(CURSOR_VALUE_SEP);
    if (sep >= 0) {
      setProviderId(value.slice(0, sep));
      setCursorModelId(value.slice(sep + CURSOR_VALUE_SEP.length));
      return;
    }
    setProviderId(value);
    setCursorModelId("");
  };

  useEffect(() => {
    let cancelled = false;
    const cursorProviders = providers.filter((provider) => provider.provider === "cursor");
    if (cursorProviders.length === 0) {
      setCursorModelsByProvider({});
      setCursorModelId("");
      return;
    }

    const next: Record<string, CursorModel[]> = {};
    for (const provider of cursorProviders) {
      if (provider.models?.length) next[provider.id] = provider.models;
    }
    setCursorModelsByProvider((current) => ({ ...current, ...next }));

    void Promise.all(
      cursorProviders
        .filter((provider) => !provider.models?.length)
        .map(async (provider) => {
          try {
            const res = await api.listCursorModels({ providerId: provider.id });
            if (!cancelled) {
              setCursorModelsByProvider((current) => ({
                ...current,
                [provider.id]: res.models,
              }));
            }
          } catch {
            if (!cancelled) {
              setCursorModelsByProvider((current) => ({
                ...current,
                [provider.id]: current[provider.id] ?? [],
              }));
            }
          }
        }),
    );

    return () => {
      cancelled = true;
    };
  }, [providers]);

  useEffect(() => {
    if (activeProvider?.provider !== "cursor") {
      setCursorModelId("");
      return;
    }
    setCursorModelId((current) => {
      if (current && cursorModels.some((model) => model.id === current)) return current;
      if (
        activeProvider.model &&
        cursorModels.some((model) => model.id === activeProvider.model)
      ) {
        return activeProvider.model;
      }
      return cursorModels[0]?.id ?? "";
    });
  }, [activeProvider, cursorModels]);

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
  }, [entries, sending, pending, steps]);

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
    setSelectedSkill(skill.name === AUTOSKILL_COMMAND ? null : skill);
    if (skill.name === "code-review") setMode("plan");
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
    setSteps([]);
    setError(undefined);
    dispatchReview(null, null);
    refreshSessions().catch(console.error);
  }, [projectId, refreshSessions]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, []);

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

  const mergeStep = useCallback((step: ChatStep) => {
    setSteps((current) => {
      const index = current.findIndex((item) => item.id === step.id);
      if (index < 0) return [...current, step];
      const next = current.slice();
      next[index] = { ...next[index], ...step };
      return next;
    });
  }, []);

  const handleResponse = (response: ChatResponse) => {
    if (
      (response.status === "done" || response.status === "approval_required") &&
      response.createdTickets?.length
    ) {
      onTicketsChanged?.();
    }
    if (response.status === "cancelled") {
      setPending(null);
      setSteps([]);
      setError(undefined);
      if (response.sessionId) setSessionId(response.sessionId);
      return;
    }
    if (response.status === "done") {
      setPending(null);
      setSteps([]);
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
      setSteps([]);
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
    setSteps([]);
    setError(response.error);
  };

  const responseRef = useRef(handleResponse);
  responseRef.current = handleResponse;

  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const providerIdRef = useRef(providerId);
  providerIdRef.current = providerId;
  const roleIdRef = useRef(roleId);
  roleIdRef.current = roleId;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  useEffect(() => {
    const handler = (event: Event) => {
      const response = (event as CustomEvent<ChatResponse>).detail;
      if (response) responseRef.current(response);
    };
    window.addEventListener(CHAT_RESPONSE_EVENT, handler);
    return () => window.removeEventListener(CHAT_RESPONSE_EVENT, handler);
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string; payload?: ChatStep };
        if (event.type !== "chat.step" || !event.payload) return;
        const activeProjectId = projectIdRef.current;
        if (
          event.payload.projectId &&
          activeProjectId &&
          event.payload.projectId !== activeProjectId
        ) {
          return;
        }
        mergeStep(event.payload);
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, [mergeStep]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AutoBuildDetail>).detail;
      if (!detail) return;
      void (async () => {
        if (sendingRef.current || pendingRef.current) return;
        const activeProjectId = projectIdRef.current;
        if (!activeProjectId || detail.projectId !== activeProjectId) return;
        if (providersRef.current.length === 0) {
          setError("Belum ada provider LLM (Global Settings → LLM Providers).");
          return;
        }

        const content = buildAutoBuildPrompt(detail);
        setMode("build");
        try {
          localStorage.setItem("rnd.chatMode:v1", "build");
        } catch {
          // ignore
        }
        setSessionId(null);
        setAttachments([]);
        setSelectedSkill(null);
        setPending(null);
        setSteps([]);
        setError(undefined);
        dispatchReview(null, null);

        const next: Entry[] = [
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
          },
        ];
        setEntries(next);
        setSending(true);
        const controller = new AbortController();
        streamAbortRef.current = controller;
        try {
          const response = await api.chatStream(activeProjectId, {
            providerId: providerIdRef.current || undefined,
            roleId: roleIdRef.current ?? undefined,
            variant: variantRef.current,
            mode: "build",
            messages: [{ role: "user", content }],
          }, { onStep: mergeStep, signal: controller.signal });
          responseRef.current(response);
        } catch (e) {
          if (!controller.signal.aborted) setError((e as Error).message);
        } finally {
          if (streamAbortRef.current === controller) streamAbortRef.current = null;
          setSending(false);
        }
      })();
    };
    window.addEventListener(AUTO_BUILD_EVENT, handler);
    return () => window.removeEventListener(AUTO_BUILD_EVENT, handler);
  }, []);

  const refreshSkills = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.getSkills(projectId);
      setSkills(res.enabled === false ? [] : res.skills);
    } catch {
      // ignore refresh errors
    }
  }, [projectId]);

  const runAutoskillCommand = async () => {
    if (!projectId || sending || pending) return;
    setError(undefined);
    setInput("");
    setAttachments([]);
    setSelectedSkill(null);
    setSkillMenuOpen(false);
    const userEntry: Entry = {
      id: crypto.randomUUID(),
      role: "user",
      content: `/${AUTOSKILL_COMMAND}`,
    };
    const runningId = crypto.randomUUID();
    setEntries((current) => [
      ...current,
      userEntry,
      {
        id: runningId,
        role: "assistant",
        content: "Menjalankan `npx autoskills` di workspace… (bisa beberapa menit)",
      },
    ]);
    setSending(true);
    try {
      const result = await api.runAutoskills(projectId);
      const names = result.skills.map((skill) => skill.name);
      const body = result.ok
        ? [
          result.dryRun ? "Dry-run selesai." : "Autoskills selesai.",
          names.length
            ? `Skill workspace (${names.length}): ${names.map((name) => `/${name}`).join(", ")}`
            : "Tidak ada skill workspace baru terdeteksi (cek output CLI).",
          result.output ? `\n\`\`\`\n${result.output.slice(0, 2500)}\n\`\`\`` : "",
        ].filter(Boolean).join("\n")
        : [
          `Gagal: ${result.error ?? "autoskills error"}`,
          result.output ? `\n\`\`\`\n${result.output.slice(0, 2500)}\n\`\`\`` : "",
        ].filter(Boolean).join("\n");
      setEntries((current) =>
        current.map((entry) => (entry.id === runningId ? { ...entry, content: body } : entry))
      );
      if (result.ok) await refreshSkills();
    } catch (e) {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === runningId
            ? { ...entry, content: `Gagal: ${(e as Error).message}` }
            : entry
        )
      );
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0 && !selectedSkill) || sending || pending) return;
    if (!projectId) {
      setError("Pilih project dulu.");
      return;
    }

    if (
      isAutoskillCommand(text) ||
      selectedSkill?.name === AUTOSKILL_COMMAND ||
      text === `/${AUTOSKILL_COMMAND}`
    ) {
      await runAutoskillCommand();
      return;
    }

    if (providers.length === 0) {
      setError("Belum ada provider LLM (Global Settings → LLM Providers).");
      return;
    }
    setError(undefined);
    const parsed = parseSlashSkill(text);
    const skillName = selectedSkill?.name === AUTOSKILL_COMMAND
      ? undefined
      : selectedSkill?.name ?? parsed.skillName ?? undefined;
    const bodyText = selectedSkill && !parsed.skillName
      ? text
      : parsed.skillName
      ? parsed.text
      : text;
    const content = bodyText.trim() || (skillName ? `Ikuti skill /${skillName}.` : "Lihat lampiran.");
    const effectiveMode: ChatMode = skillName === "code-review" ? "plan" : mode;
    if (skillName === "code-review" && mode !== "plan") setMode("plan");
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
    setSteps([]);
    setSending(true);
    const controller = new AbortController();
    streamAbortRef.current = controller;
    try {
      const response = await api.chatStream(projectId, {
        providerId: providerId || undefined,
        model: activeProvider?.provider === "cursor" ? cursorModelId || undefined : undefined,
        sessionId: sessionId ?? undefined,
        roleId: roleId ?? undefined,
        skillName,
        variant,
        mode: effectiveMode,
        messages: next.map((entry, index) => ({
          role: entry.role,
          content: entry.content,
          ...(index === next.length - 1 && outgoing.length ? { attachments: outgoing } : {}),
        })),
      }, { onStep: mergeStep, signal: controller.signal });
      handleResponse(response);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      setSending(false);
    }
  };

  const stop = async () => {
    if (!projectId) return;
    const controller = streamAbortRef.current;
    streamAbortRef.current = null;
    try {
      await api.cancelChat(projectId, { sessionId: sessionId ?? undefined });
    } catch {
      // ignore cancel errors; aborting the stream still stops the UI
    }
    controller?.abort();
    setSending(false);
    setSteps([]);
  };

  const selectSession = async (value: string) => {
    if (value === "new") {
      setSessionId(null);
      setEntries([]);
      setAttachments([]);
      setPending(null);
      setSteps([]);
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
      setSteps([]);
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
      setSteps([]);
      await refreshSessions();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <aside
      style={{ width }}
      className={cn(
        "relative flex shrink-0 flex-col border-l border-border/50 bg-[var(--sidebar)]/70 backdrop-blur-xl",
        hidden && "hidden",
        resizing && "select-none",
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
      <div
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat"
        title="Drag to resize"
        className="hover:bg-primary/40 absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize transition-colors"
      />
      {dragging
        ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-background/85">
            <p className="text-xs font-medium">Lepaskan file di sini</p>
          </div>
        )
        : null}

      <div className="flex items-center justify-between gap-3 border-b py-2 max-h-[35px] h-[35px] px-2">
        <div className="flex items-center justify-between gap-1 w-full">
          <Select value={sessionId ?? "new"} onValueChange={selectSession} disabled={!!pending}>
            <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7" aria-label="Sesi chat">
              <SelectValue placeholder="Chat baru" className="text-xs"/>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="new">
                  <div className="flex items-center gap-2 text-xs">
                    <Plus size={12}/>
                    Chat baru
                  </div>
                </SelectItem>
                {sessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="truncate">{session.title}</span>
                      {session.source === "cursor" ? (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          Cursor
                        </Badge>
                      ) : null}
                    </div>
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

      <div
        ref={scrollRef}
        className="chat-surface flex-1 overflow-y-auto p-3"
        style={{ fontFamily: chatFontFamily, fontSize: `${chatFontSize}px` }}
      >
        {entries.length === 0
          ? (
            <p className="text-muted-foreground">
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
                            <MarkdownView
                              content={entry.content}
                              fontSize={chatFontSize}
                              fontFamily={chatFontFamily}
                            />
                          </Suspense>
                        )
                        : null
                    )
                    : <span className="whitespace-pre-wrap">{entry.content}</span>}
                </div>
              ))}
              {steps.length > 0 || sending
                ? (
                  <div className="flex flex-col gap-1.5 rounded-md border border-border/50 bg-muted/20 p-2">
                    {steps.map((step) => (
                      <div key={step.id} className="flex items-start gap-2 text-xs">
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
                            )}
                          >
                            {step.title}
                          </p>
                          {step.detail
                            ? (
                              <p className="break-words text-muted-foreground/80">{step.detail}</p>
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
                  <SelectItem value="none" className="text-xs">Tanpa role</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id} className="text-xs">
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
                    const option =
                      filteredSkills[Math.min(skillActiveIndex, filteredSkills.length - 1)];
                    if (
                      event.key === "Enter" &&
                      input.trim().toLowerCase() === `/${option.name}`.toLowerCase()
                    ) {
                      void send();
                      return;
                    }
                    applySkillMention(option);
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
              className="chat-composer-input w-full resize-none border-0 bg-transparent px-3 py-2 outline-none disabled:opacity-60"
              style={{ fontFamily: chatFontFamily, fontSize: `${chatFontSize}px` }}
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
                  <SelectItem value="plan" className="text-xs">Plan</SelectItem>
                  <SelectItem value="build" className="text-xs">Build</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={providerSelectValue}
              onValueChange={selectProviderValue}
              disabled={providers.length === 0 || !!pending || !!roleProviderId}
            >
              <SelectTrigger
                size="sm"
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7"
                aria-label="Pilih provider / model"
                title={roleProviderId ? "Provider ditentukan oleh role" : undefined}
              >
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent className="min-w-[14rem]">
                {providers.map((provider) => {
                  if (provider.provider === "cursor") {
                    const models = cursorModelsByProvider[provider.id] ??
                      provider.models ?? [];
                    return (
                      <SelectGroup key={provider.id}>
                        <SelectLabel className="text-xs">{provider.name}</SelectLabel>
                        {models.length > 0
                          ? models.map((model) => (
                            <SelectItem
                              key={`${provider.id}${CURSOR_VALUE_SEP}${model.id}`}
                              value={`${provider.id}${CURSOR_VALUE_SEP}${model.id}`}
                              className="text-xs"
                            >
                              {model.name === model.id
                                ? model.id
                                : `${model.name} (${model.id})`}
                            </SelectItem>
                          ))
                          : (
                            <SelectItem value={provider.id} disabled className="text-xs">
                              Memuat model…
                            </SelectItem>
                          )}
                      </SelectGroup>
                    );
                  }
                  return (
                    <SelectGroup key={provider.id}>
                      <SelectLabel className="text-xs">{provider.name}</SelectLabel>
                      <SelectItem value={provider.id} className="text-xs">
                        {provider.model ? provider.model : provider.name}
                      </SelectItem>
                    </SelectGroup>
                  );
                })}
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
                    <SelectItem key={item.id} value={item.id} className="text-xs">
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
              onClick={sending ? stop : send}
              disabled={!sending && (!!pending ||
                (!input.trim() && attachments.length === 0 && !selectedSkill))}
              aria-label={sending ? "Hentikan chat" : "Kirim"}
              title={sending ? "Hentikan chat" : "Kirim"}
            >
              {sending ? <Square className="size-3 fill-current" /> : <Send />}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
