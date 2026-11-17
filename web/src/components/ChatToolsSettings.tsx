import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import {
  api,
  type ChatToolCatalogEntry,
  type ChatToolsSettingsResponse,
  type WriteReviewMode,
} from "@/lib/api";

const REVIEW_MODES: Array<{ id: WriteReviewMode; labelKey: string }> = [
  { id: "end", labelKey: "settings.tools.reviewModeAfter" },
  { id: "before", labelKey: "settings.tools.reviewModeBefore" },
];

const DEFAULT_REVIEW_KEEP_HOURS = 24;

type SavePatch = {
  autoApproveWrites?: boolean;
  disabledTools?: string[];
  autoApproveTools?: string[];
  maxSteps?: number | null;
  writeReviewMode?: WriteReviewMode;
  reviewKeepHours?: number;
};

export function ChatToolsSettings() {
  const [autoApproveWrites, setAutoApproveWrites] = useState(false);
  const [writeReviewMode, setWriteReviewMode] = useState<WriteReviewMode>("end");
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [autoApproveTools, setAutoApproveTools] = useState<string[]>([]);
  const [maxSteps, setMaxSteps] = useState<number | null>(null);
  const [maxStepsDraft, setMaxStepsDraft] = useState("");
  const [reviewKeepHours, setReviewKeepHours] = useState(DEFAULT_REVIEW_KEEP_HOURS);
  const [reviewKeepDraft, setReviewKeepDraft] = useState(String(DEFAULT_REVIEW_KEEP_HOURS));
  const [tools, setTools] = useState<ChatToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api
      .getChatToolsSettings()
      .then((res) => {
        if (cancelled) return;
        applyResponse(res);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyResponse = (res: ChatToolsSettingsResponse) => {
    setAutoApproveWrites(res.autoApproveWrites);
    setWriteReviewMode(res.writeReviewMode ?? "end");
    setDisabledTools(res.disabledTools);
    setAutoApproveTools(res.autoApproveTools);
    setMaxSteps(res.maxSteps);
    setMaxStepsDraft(res.maxSteps == null ? "" : String(res.maxSteps));
    const keep = res.reviewKeepHours ?? DEFAULT_REVIEW_KEEP_HOURS;
    setReviewKeepHours(keep);
    setReviewKeepDraft(String(keep));
    setTools(res.tools);
  };

  const save = async (patch: SavePatch = {}) => {
    setBusy(true);
    setError(undefined);
    try {
      const payload = {
        autoApproveWrites: patch.autoApproveWrites ?? autoApproveWrites,
        disabledTools: patch.disabledTools ?? disabledTools,
        autoApproveTools: patch.autoApproveTools ?? autoApproveTools,
        maxSteps: patch.maxSteps !== undefined ? patch.maxSteps : maxSteps,
        writeReviewMode: patch.writeReviewMode ?? writeReviewMode,
        reviewKeepHours: patch.reviewKeepHours ?? reviewKeepHours,
      };
      const res = await api.saveChatToolsSettings(payload);
      applyResponse(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleTool = (name: string, enabled: boolean) => {
    const next = enabled
      ? disabledTools.filter((item) => item !== name)
      : [...new Set([...disabledTools, name])];
    void save({ disabledTools: next });
  };

  const commitMaxSteps = () => {
    const trimmed = maxStepsDraft.trim();
    if (!trimmed) {
      void save({ maxSteps: null });
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 200) {
      setError(t("settings.tools.maxStepsError"));
      setMaxStepsDraft(maxSteps == null ? "" : String(maxSteps));
      return;
    }
    void save({ maxSteps: parsed });
  };

  const commitReviewKeepHours = () => {
    const trimmed = reviewKeepDraft.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 168) {
      setError(t("settings.tools.reviewKeepError"));
      setReviewKeepDraft(String(reviewKeepHours));
      return;
    }
    void save({ reviewKeepHours: parsed });
  };

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("settings.tools.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings.tools.description")}
        </p>
        <Separator />
      </div>

      {loading
        ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            {t("common.loading")}
          </div>
        )
        : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-medium">{t("settings.tools.autoApproveTitle")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("settings.tools.autoApproveBefore")}{" "}
                  <code className="text-xs">write_file</code>{" "}
                  {t("settings.tools.autoApproveAfter")}
                </span>
              </div>
              <Switch
                checked={autoApproveWrites}
                onCheckedChange={(next) => void save({ autoApproveWrites: next })}
                disabled={busy}
                aria-label={t("settings.tools.autoApproveTitle")}
              />
            </div>

            {!autoApproveWrites
              ? (
                <>
                  <div className="flex flex-col gap-2 rounded-md border p-4">
                    <Label htmlFor="chat-write-review-mode" className="text-xs font-medium">
                      {t("settings.tools.reviewTitle")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">{t("settings.tools.reviewModeAfter")}</span>{" "}
                      {t("settings.tools.reviewModeAfterHint")}{" "}
                      <span className="font-medium">{t("settings.tools.reviewModeBefore")}</span>
                      {t("settings.tools.reviewModeBeforeHint")}
                    </p>
                    <Select
                      value={writeReviewMode}
                      onValueChange={(value) =>
                        void save({
                          writeReviewMode: value === "before" ? "before" : "end",
                        })}
                      disabled={busy}
                    >
                      <SelectTrigger
                        id="chat-write-review-mode"
                        size="sm"
                        className="h-8 w-full text-xs"
                        aria-label={t("settings.tools.reviewModeAria")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {REVIEW_MODES.map((mode) => (
                            <SelectItem key={mode.id} value={mode.id} className="text-xs">
                              {t(mode.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2 rounded-md border p-4">
                    <Label htmlFor="chat-review-keep-hours" className="text-xs font-medium">
                      {t("settings.tools.reviewKeepTitle")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.tools.reviewKeepDescription")}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="chat-review-keep-hours"
                        type="number"
                        min={1}
                        max={168}
                        inputMode="numeric"
                        className="h-8 w-24 text-xs"
                        value={reviewKeepDraft}
                        onChange={(event) => setReviewKeepDraft(event.target.value)}
                        onBlur={() => commitReviewKeepHours()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                        disabled={busy}
                      />
                      <span className="text-xs text-muted-foreground">
                        {t("settings.tools.hours")}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || reviewKeepHours === DEFAULT_REVIEW_KEEP_HOURS}
                        onClick={() => {
                          setReviewKeepDraft(String(DEFAULT_REVIEW_KEEP_HOURS));
                          void save({ reviewKeepHours: DEFAULT_REVIEW_KEEP_HOURS });
                        }}
                      >
                        {t("settings.tools.resetReviewKeep")}
                      </Button>
                    </div>
                  </div>
                </>
              )
              : null}

            <div className="flex flex-col gap-2 rounded-md border p-4">
              <Label htmlFor="chat-max-steps" className="text-xs font-medium">
                {t("settings.tools.maxStepsTitle")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.tools.maxStepsDescription")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="chat-max-steps"
                  type="number"
                  min={1}
                  max={200}
                  inputMode="numeric"
                  placeholder={t("settings.tools.unlimited")}
                  className="h-8 w-36 text-xs"
                  value={maxStepsDraft}
                  onChange={(event) => setMaxStepsDraft(event.target.value)}
                  onBlur={() => commitMaxSteps()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || maxSteps == null}
                  onClick={() => {
                    setMaxStepsDraft("");
                    void save({ maxSteps: null });
                  }}
                >
                  {t("settings.tools.unlimited")}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-md border p-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">{t("settings.tools.alwaysAllowTitle")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("settings.tools.alwaysAllowDescription")}
                </span>
              </div>
              {autoApproveTools.length === 0
                ? (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.tools.alwaysAllowEmpty")}
                  </p>
                )
                : (
                  <ul className="flex flex-wrap gap-1.5">
                    {autoApproveTools.map((name) => (
                      <li
                        key={name}
                        className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs"
                      >
                        <span className="font-mono">{name}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          aria-label={t("settings.tools.revokeAria", { name })}
                          onClick={() =>
                            void save({
                              autoApproveTools: autoApproveTools.filter((item) => item !== name),
                            })}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium">{t("settings.tools.chatToolsTitle")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.tools.chatToolsDescription")}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || disabledTools.length === 0}
                  onClick={() => void save({ disabledTools: [] })}
                >
                  {t("settings.tools.enableAll")}
                </Button>
              </div>

              <ul className="flex flex-col gap-2">
                {tools.map((tool) => {
                  const enabled = !disabledTools.includes(tool.name);
                  return (
                    <li
                      key={tool.name}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{tool.name}</span>
                          {tool.requiresApproval && (
                            <Badge variant="secondary" className="text-[10px]">
                              {autoApproveWrites
                                ? t("settings.tools.badgeAutoApproveOn")
                                : writeReviewMode === "end"
                                ? t("settings.tools.badgeReviewEnd")
                                : t("settings.tools.badgeNeedsApproval")}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{tool.description}</span>
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(next) => toggleTool(tool.name, next)}
                        disabled={busy}
                        aria-label={t("settings.tools.enableToolAria", { name: tool.name })}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
