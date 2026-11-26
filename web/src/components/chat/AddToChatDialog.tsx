import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dispatchAddToChat } from "@/lib/add-to-chat-events";
import { requestChatOpen } from "@/lib/chat-drag";
import { clipContext } from "@/lib/chat-context";
import { useI18n } from "@/lib/i18n";

export interface AddToChatDialogProps {
  open: boolean;
  selection: string;
  sourceLabel?: string;
  onOpenChange: (open: boolean) => void;
}

export function AddToChatDialog({ open, selection, sourceLabel, onOpenChange }: AddToChatDialogProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open, selection]);

  const submit = () => {
    const text = selection.trim();
    if (!text) {
      onOpenChange(false);
      return;
    }
    requestChatOpen();
    dispatchAddToChat({
      selection: clipContext(text),
      prompt: prompt.trim(),
      sourceLabel,
    });
    onOpenChange(false);
  };

  const preview = selection.length > 280 ? `${selection.slice(0, 280)}…` : selection;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-add-to-chat-dialog
        className="gap-3 sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="text-sm">{t("chat.addToChat.title")}</DialogTitle>
        <DialogDescription className="text-xs">
          {t("chat.addToChat.description")}
          {sourceLabel ? t("chat.addToChat.source", { source: sourceLabel }) : ""}
        </DialogDescription>

        <div className="max-h-36 overflow-auto rounded-md border bg-muted/30 p-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {preview || t("chat.addToChat.emptySelection")}
          </pre>
        </div>

        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder={t("chat.addToChat.placeholder")}
          className="min-h-[4.5rem] w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("chat.addToChat.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={submit} disabled={!selection.trim()}>
            {t("chat.addToChat.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
