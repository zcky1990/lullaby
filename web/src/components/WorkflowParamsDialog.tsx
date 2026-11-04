import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { LlmProviderModelSelect } from "@/components/LlmProviderModelSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { LlmProvider, WorkflowParam } from "@/lib/api";
import {
  type AttachmentDraft,
  FILE_ACCEPT,
  mergeTextAttachments,
  readAttachment,
} from "@/lib/chat-attachments";
import { cn } from "@/lib/utils";

interface AgentState {
  text: string;
  providerId: string;
  modelId: string;
  attachments: AttachmentDraft[];
}

interface Props {
  open: boolean;
  params: WorkflowParam[];
  providers?: LlmProvider[];
  running?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: Record<string, string>) => void;
}

function initialValues(params: WorkflowParam[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of params) {
    if (param.type === "agent") continue;
    values[param.name] = param.default ?? "";
  }
  return values;
}

function initialAgentState(
  params: WorkflowParam[],
  providers: LlmProvider[],
): Record<string, AgentState> {
  const states: Record<string, AgentState> = {};
  for (const param of params) {
    if (param.type !== "agent") continue;
    states[param.name] = {
      text: param.default ?? "",
      providerId: providers[0]?.id ?? "",
      modelId: "",
      attachments: [],
    };
  }
  return states;
}

function usesTextarea(param: WorkflowParam, value: string): boolean {
  if (param.type === "integer" || param.type === "number" || param.type === "boolean") {
    return false;
  }
  return value.length > 80 || value.includes("\n") ||
    (param.description?.toLowerCase().includes("prompt") ?? false) ||
    param.name.toLowerCase().includes("prompt");
}

function AgentParamField({
  param,
  state,
  providers,
  running,
  onChange,
}: {
  param: WorkflowParam;
  state: AgentState;
  providers: LlmProvider[];
  running: boolean;
  onChange: (next: AgentState) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const stateRef = useRef(state);
  stateRef.current = state;

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length || running) return;
    setError(undefined);
    const accepted: AttachmentDraft[] = [];
    for (const file of files) {
      try {
        accepted.push(await readAttachment(file));
      } catch (err) {
        setError((err as Error).message);
      }
    }
    if (!accepted.length) return;
    const current = stateRef.current;
    onChange({ ...current, attachments: [...current.attachments, ...accepted] });
  }, [onChange, running]);

  const setModel = useCallback((next: { providerId: string; modelId: string }) => {
    const current = stateRef.current;
    if (current.providerId === next.providerId && current.modelId === next.modelId) return;
    onChange({ ...current, providerId: next.providerId, modelId: next.modelId });
  }, [onChange]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="font-mono text-xs">{param.name}</Label>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">agent</span>
      </div>
      {param.description
        ? <p className="text-[11px] text-muted-foreground">{param.description}</p>
        : null}
      <div
        className={cn(
          "border-input focus-within:border-ring focus-within:ring-ring/50 flex flex-col rounded-md border bg-transparent shadow-xs focus-within:ring-[3px]",
          dragging && "border-primary bg-primary/5",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length) {
            void handleFiles(Array.from(event.dataTransfer.files));
          }
        }}
      >
        {state.attachments.length
          ? (
            <div className="flex flex-wrap gap-1.5 px-2 pt-2">
              {state.attachments.map((item) => (
                <div
                  key={item.id}
                  className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-1.5 py-1 text-xs"
                >
                  {item.type === "image"
                    ? <img src={item.data} alt="" className="size-6 rounded object-cover" />
                    : <FileText className="size-3.5 text-muted-foreground" />}
                  <span className="max-w-40 truncate" title={item.name}>{item.name}</span>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() =>
                      onChange({
                        ...state,
                        attachments: state.attachments.filter((row) => row.id !== item.id),
                      })}
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
        <textarea
          id={`wf-param-${param.name}`}
          value={state.text}
          rows={5}
          disabled={running}
          placeholder="Prompt agent… lampirkan file atau seret ke sini"
          onChange={(event) => onChange({ ...state, text: event.target.value })}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              void handleFiles(files);
            }
          }}
          className="w-full resize-none border-0 bg-transparent px-3 py-2 text-xs outline-none disabled:opacity-60"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={FILE_ACCEPT}
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
            disabled={running}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Lampirkan file"
            title="Lampirkan gambar/file teks"
          >
            <Paperclip />
          </Button>
          <LlmProviderModelSelect
            providers={providers}
            providerId={state.providerId}
            modelId={state.modelId}
            disabled={running}
            onChange={setModel}
          />
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {providers.length === 0
        ? (
          <p className="text-[11px] text-muted-foreground">
            Belum ada provider LLM (Global Settings → LLM Providers).
          </p>
        )
        : null}
    </div>
  );
}

export function WorkflowParamsDialog({
  open,
  params,
  providers = [],
  running = false,
  onOpenChange,
  onConfirm,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const hasAgent = params.some((param) => param.type === "agent");

  useEffect(() => {
    if (!open) return;
    setValues(initialValues(params));
    setAgentStates(initialAgentState(params, providers));
  }, [open, params, providers]);

  const submit = () => {
    const clean: Record<string, string> = {};
    for (const param of params) {
      if (param.type === "agent") {
        const state = agentStates[param.name] ?? {
          text: "",
          providerId: providers[0]?.id ?? "",
          modelId: "",
          attachments: [],
        };
        const { text, images } = mergeTextAttachments(state.text, state.attachments);
        clean[param.name] = text;
        if (state.providerId) clean[`${param.name}__provider`] = state.providerId;
        if (state.modelId) clean[`${param.name}__model`] = state.modelId;
        if (images.length) {
          clean[`${param.name}__attachments`] = JSON.stringify(
            images.map((item) => ({
              type: item.type,
              name: item.name,
              mime: item.mime,
              data: item.data,
            })),
          );
        }
        continue;
      }
      clean[param.name] = values[param.name] ?? "";
    }
    onConfirm(clean);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden p-0",
          hasAgent ? "sm:max-w-xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>Parameter workflow</DialogTitle>
          <DialogDescription>
            {hasAgent
              ? "Isi param sebelum run. Param bertipe agent mendukung prompt, lampiran file, dan pilihan model."
              : "Isi nilai param sebelum menjalankan workflow. Default dari YAML sudah terisi."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {params.map((param) => {
            if (param.type === "agent") {
              const state = agentStates[param.name] ?? {
                text: param.default ?? "",
                providerId: providers[0]?.id ?? "",
                modelId: "",
                attachments: [],
              };
              return (
                <AgentParamField
                  key={param.name}
                  param={param}
                  state={state}
                  providers={providers}
                  running={running}
                  onChange={(next) =>
                    setAgentStates((current) => ({ ...current, [param.name]: next }))}
                />
              );
            }

            const value = values[param.name] ?? "";
            const multiline = usesTextarea(param, value);
            return (
              <div key={param.name} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor={`wf-param-${param.name}`} className="font-mono text-xs">
                    {param.name}
                  </Label>
                  {param.type
                    ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {param.type}
                      </span>
                    )
                    : null}
                </div>
                {param.description
                  ? (
                    <p className="text-[11px] text-muted-foreground">{param.description}</p>
                  )
                  : null}
                {multiline
                  ? (
                    <textarea
                      id={`wf-param-${param.name}`}
                      value={value}
                      rows={4}
                      disabled={running}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [param.name]: event.target.value,
                        }))}
                      className={cn(
                        "border-input placeholder:text-muted-foreground flex w-full rounded-md border bg-transparent px-3 py-2 text-xs shadow-xs outline-none",
                        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                    />
                  )
                  : (
                    <Input
                      id={`wf-param-${param.name}`}
                      value={value}
                      disabled={running}
                      type={param.type === "integer" || param.type === "number"
                        ? "number"
                        : "text"}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [param.name]: event.target.value,
                        }))}
                    />
                  )}
              </div>
            );
          })}
        </div>
        <DialogFooter className="shrink-0 border-t px-4 py-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            Batal
          </Button>
          <Button onClick={submit} disabled={running} data-icon="inline-start">
            {running ? <Spinner /> : null}
            Jalankan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
