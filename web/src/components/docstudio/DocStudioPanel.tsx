import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ScrollText, Send, Sparkles, Trash2, Wand2 } from "lucide-react";
import { PanelHeader } from "@/components/PanelHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { readActiveProjectId } from "@/lib/active-project";
import { useI18n } from "@/lib/i18n";
import { canFinalize, compactText, docStudioErrorKey } from "@/lib/doc-studio";
import { docStudioApi, type DocStudioDraft, type DocTemplate } from "@/lib/doc-studio-api";
import { cn } from "@/lib/utils";

/**
 * Semua prop opsional:
 * - `ActivityBar` merender tanpa prop → panel membaca project aktif dari
 *   localStorage (`rnd.activeProjectId:v1`) dan mengecek document workspace
 *   lewat `GET /api/projects/:id`.
 * - Shell (`App.tsx`) boleh memberi prop eksplisit bila wiring panel ditambahkan
 *   ke sana nanti.
 */
export interface DocStudioPanelProps {
  projectId?: string | null;
  documentWorkspaceReady?: boolean;
  onSelectLocalDocument?: (path: string, title: string) => void;
}

type Busy = "start" | "turn" | "finalize" | "load" | null;

function errorCode(error: unknown): string {
  return (error as Error)?.message ?? String(error);
}

/**
 * Menu Doc Studio: pilih tipe dokumen → interview AI → generate → simpan ke
 * document workspace project (muncul di menu Document).
 */
export function DocStudioPanel({
  projectId,
  documentWorkspaceReady,
  onSelectLocalDocument,
}: DocStudioPanelProps = {}) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(projectId ?? null);
  const [workspaceReady, setWorkspaceReady] = useState(documentWorkspaceReady ?? true);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<DocStudioDraft[]>([]);
  const [draft, setDraft] = useState<DocStudioDraft | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<Busy>("load");
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  /** Kode error API yang dikenal diterjemahkan ke pesan + langkah perbaikan. */
  const describe = useCallback(
    (err: unknown): string => {
      const code = errorCode(err);
      const key = docStudioErrorKey(code);
      return key ? t(key) : code;
    },
    [t],
  );

  useEffect(() => {
    const id = projectId ?? readActiveProjectId();
    setActiveId(id);
    if (!id) return;
    if (documentWorkspaceReady !== undefined) {
      setWorkspaceReady(documentWorkspaceReady);
      return;
    }
    let cancelled = false;
    api
      .projectDetail(id)
      .then((detail) => {
        if (!cancelled) setWorkspaceReady(Boolean(detail.project.document_path));
      })
      .catch(() => {
        if (!cancelled) setWorkspaceReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, documentWorkspaceReady]);

  const load = useCallback(async () => {
    if (!activeId) {
      setTemplates([]);
      setDrafts([]);
      setDraft(null);
      setBusy(null);
      return;
    }
    setBusy("load");
    setError(null);
    try {
      const [templatesRes, draftsRes, settingsRes] = await Promise.all([
        docStudioApi.templates(),
        docStudioApi.listDrafts(activeId),
        docStudioApi.getSettings(),
      ]);
      setTemplates(templatesRes.templates);
      setDrafts(draftsRes.drafts);
      setRoleNames(
        Object.fromEntries(settingsRes.roles.map((role) => [role.id, role.name])),
      );
    } catch (err) {
      setError(t("docStudio.loadError", { message: describe(err) }));
    } finally {
      setBusy(null);
    }
  }, [activeId, describe, t]);

  useEffect(() => {
    setDraft(null);
    setAnswer("");
    void load();
  }, [load]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [draft?.transcript.length, busy]);

  const activeTemplate = useMemo(
    () => (draft ? templates.find((item) => item.id === draft.typeId) ?? null : null),
    [draft, templates],
  );

  const start = async (template: DocTemplate) => {
    if (!activeId) return;
    setBusy("start");
    setError(null);
    try {
      const res = await docStudioApi.createDraft(activeId, { typeId: template.id });
      setDraft(res.draft);
      setDrafts((current) => [res.draft, ...current.filter((item) => item.id !== res.draft.id)]);
    } catch (err) {
      setError(t("docStudio.startError", { message: describe(err) }));
    } finally {
      setBusy(null);
    }
  };

  const resume = async (target: DocStudioDraft) => {
    if (!activeId) return;
    setBusy("load");
    setError(null);
    try {
      const res = await docStudioApi.getDraft(activeId, target.id);
      setDraft(res.draft);
    } catch (err) {
      setError(t("docStudio.loadError", { message: describe(err) }));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    const message = answer.trim();
    if (!activeId || !draft || !message) return;
    setBusy("turn");
    setError(null);
    setAnswer("");
    try {
      const res = await docStudioApi.sendTurn(activeId, draft.id, message);
      setDraft(res.draft);
      setDrafts((current) =>
        current.map((item) => (item.id === res.draft.id ? res.draft : item))
      );
    } catch (err) {
      setAnswer(message);
      setError(t("docStudio.turnError", { message: describe(err) }));
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    if (!activeId || !draft) return;
    setBusy("finalize");
    setError(null);
    try {
      const res = await docStudioApi.finalize(activeId, draft.id);
      setDraft(res.draft);
      setDrafts((current) =>
        current.map((item) => (item.id === res.draft.id ? res.draft : item))
      );
      onSelectLocalDocument?.(res.document.path, res.document.title);
    } catch (err) {
      setError(t("docStudio.finalizeError", { message: describe(err) }));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (target: DocStudioDraft) => {
    if (!activeId) return;
    try {
      await docStudioApi.deleteDraft(activeId, target.id);
      setDrafts((current) => current.filter((item) => item.id !== target.id));
      setDraft((current) => (current?.id === target.id ? null : current));
    } catch (err) {
      setError(t("docStudio.loadError", { message: describe(err) }));
    }
  };

  const roleLabel = (roleId: string | null): string => {
    const name = roleId ? roleNames[roleId] : undefined;
    return name ? t("docStudio.roleLabel", { role: name }) : t("docStudio.roleNone");
  };

  const finalizeAllowed = draft
    ? canFinalize({
      status: draft.status,
      transcript: draft.transcript,
      busy: busy !== null,
    })
    : false;
  const blocked = !activeId || !workspaceReady;

  return (
    <>
      <PanelHeader title={t("docStudio.title")} count={drafts.length} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {!activeId ? (
          <p className="px-2 text-xs text-muted-foreground">{t("docStudio.noProject")}</p>
        ) : null}
        {activeId && !workspaceReady ? (
          <p className="px-2 text-xs text-destructive">{t("docStudio.noWorkspace")}</p>
        ) : null}
        {error ? <p className="px-2 text-xs text-destructive">{error}</p> : null}

        {!draft ? (
          <>
            <div className="px-2">
              <p className="text-xs font-medium">{t("docStudio.pickTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("docStudio.pickHint")}</p>
            </div>
            <div className="flex flex-col gap-1">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  disabled={blocked || busy !== null}
                  onClick={() => void start(template)}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <ScrollText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs font-medium">{template.label}</span>
                    <span className="line-clamp-2 text-[11px] text-muted-foreground">
                      {template.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-2 px-2">
              <p className="text-xs font-medium">{t("docStudio.draftsTitle")}</p>
            </div>
            {drafts.length === 0 ? (
              <p className="px-2 text-[11px] text-muted-foreground">{t("docStudio.noDrafts")}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {drafts.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent"
                  >
                    <button
                      type="button"
                      onClick={() => void resume(item)}
                      disabled={busy !== null}
                      className="flex min-w-0 flex-1 flex-col items-start text-left"
                    >
                      <span className="truncate text-xs">{item.title}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {t(`docStudio.status.${item.status}`)}
                        {item.updatedAt ? ` · ${item.updatedAt}` : ""}
                      </span>
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 opacity-0 group-hover:opacity-100"
                      title={t("docStudio.deleteDraft")}
                      aria-label={t("docStudio.deleteDraft")}
                      onClick={() => void remove(item)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title={t("docStudio.back")}
                aria-label={t("docStudio.back")}
                onClick={() => {
                  setDraft(null);
                  setAnswer("");
                  setError(null);
                }}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <span className="truncate text-xs font-medium">
                {activeTemplate?.label ?? draft.typeId}
              </span>
              <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                {t(`docStudio.status.${draft.status}`)}
              </Badge>
            </div>
            <p className="px-1 text-[10px] text-muted-foreground">{roleLabel(draft.roleId)}</p>

            <div
              ref={transcriptRef}
              className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto rounded-md border bg-muted/20 p-2"
            >
              {draft.transcript.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("docStudio.emptyTranscript")}
                </p>
              ) : null}
              {draft.transcript.map((turn, index) => (
                <div
                  key={`${index}-${turn.role}`}
                  className={cn(
                    "max-w-[92%] rounded-lg px-2 py-1.5 text-[11px] whitespace-pre-wrap",
                    turn.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-background/80 text-foreground",
                  )}
                >
                  {compactText(turn.content)}
                </div>
              ))}
              {busy === "turn" ? (
                <p className="text-[11px] text-muted-foreground">{t("docStudio.sending")}</p>
              ) : null}
            </div>

            {draft.status === "ready" ? (
              <p className="flex items-center gap-1 px-1 text-[10px] text-primary">
                <Sparkles className="size-3" />
                {t("docStudio.readyHint")}
              </p>
            ) : null}

            {draft.status === "saved" && draft.documentPath ? (
              <>
                <p className="px-1 text-[10px] text-muted-foreground">
                  {t("docStudio.savedAt", { path: draft.documentPath })}
                </p>
                {onSelectLocalDocument ? (
                  <Button
                    size="sm"
                    variant="outline"
                    data-icon="inline-start"
                    onClick={() => onSelectLocalDocument(draft.documentPath!, draft.title)}
                  >
                    <ScrollText />
                    {t("docStudio.openDocument", { title: draft.title })}
                  </Button>
                ) : null}
              </>
            ) : null}

            {draft.status !== "saved" ? (
              <>
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={3}
                  placeholder={t("docStudio.answerPlaceholder")}
                  aria-label={t("docStudio.answerPlaceholder")}
                  className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    data-icon="inline-start"
                    disabled={!answer.trim() || busy !== null}
                    onClick={() => void send()}
                  >
                    {busy === "turn" ? <Spinner /> : <Send />}
                    {t("docStudio.send")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-icon="inline-start"
                    disabled={!finalizeAllowed}
                    onClick={() => void finalize()}
                  >
                    {busy === "finalize" ? <Spinner /> : <Wand2 />}
                    {busy === "finalize" ? t("docStudio.finalizing") : t("docStudio.finalize")}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        )}

        {busy === "start" ? (
          <p className="px-2 text-[11px] text-muted-foreground">{t("docStudio.sending")}</p>
        ) : null}
      </div>
    </>
  );
}
