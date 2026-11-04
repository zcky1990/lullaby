import { useEffect, useState } from "react";
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
import type { WorkflowParam } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  params: WorkflowParam[];
  running?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: Record<string, string>) => void;
}

function initialValues(params: WorkflowParam[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of params) {
    values[param.name] = param.default ?? "";
  }
  return values;
}

function usesTextarea(param: WorkflowParam, value: string): boolean {
  if (param.type === "integer" || param.type === "number" || param.type === "boolean") {
    return false;
  }
  return value.length > 80 || value.includes("\n") ||
    (param.description?.toLowerCase().includes("prompt") ?? false) ||
    param.name.toLowerCase().includes("prompt");
}

export function WorkflowParamsDialog({
  open,
  params,
  running = false,
  onOpenChange,
  onConfirm,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setValues(initialValues(params));
  }, [open, params]);

  const submit = () => {
    const clean: Record<string, string> = {};
    for (const param of params) {
      clean[param.name] = values[param.name] ?? "";
    }
    onConfirm(clean);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>Parameter workflow</DialogTitle>
          <DialogDescription>
            Isi nilai param sebelum menjalankan workflow. Default dari YAML sudah terisi.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {params.map((param) => {
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
