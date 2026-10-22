import { ChevronDown, Plus } from "lucide-react";
import { LlmProviderForm } from "@/components/LlmProviderForm";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import type { LlmProvider, LlmProviderPayload, TestResult } from "@/lib/api";

interface Props {
  providers: LlmProvider[];
  addingProvider: boolean;
  onAddProvider: (value: boolean) => void;
  onTestLlm: (payload: LlmProviderPayload) => Promise<TestResult>;
  onSaveLlm: (id: string | null, payload: LlmProviderPayload) => Promise<void>;
  onDeleteLlm: (id: string) => Promise<void>;
}

export function LlmProvidersSettings({
  providers,
  addingProvider,
  onAddProvider,
  onTestLlm,
  onSaveLlm,
  onDeleteLlm,
}: Props) {
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
              LLM Providers
            </h2>
            <p className="text-sm text-muted-foreground">
              Provider LLM global, dipakai semua project (chat dan generate ticket).
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddProvider(true)}
            data-icon="inline-start"
          >
            <Plus />
            Provider
          </Button>
        </div>
        <Separator />
      </div>

      {providers.length === 0 && !addingProvider ? (
        <p className="text-sm text-muted-foreground">
          Belum ada provider LLM. Tambahkan minimal satu untuk chat dan generate ticket.
        </p>
      ) : null}

      {providers.map((provider) => (
        <Collapsible
          key={provider.id + provider.updatedAt}
          defaultOpen={false}
          className="rounded-md border"
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-3">
              <span className="truncate text-left">
                {provider.name}
                {provider.model ? ` · ${provider.model}` : ""}
              </span>
              <ChevronDown className="size-4 shrink-0" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <LlmProviderForm
              provider={provider}
              onSave={(payload) => onSaveLlm(provider.id, payload)}
              onTest={onTestLlm}
              onDelete={() => onDeleteLlm(provider.id)}
            />
          </CollapsibleContent>
        </Collapsible>
      ))}

      {addingProvider ? (
        <Collapsible defaultOpen className="rounded-md border">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-3">
              Provider baru
              <ChevronDown className="size-4 shrink-0" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <LlmProviderForm
              onSave={(payload) => onSaveLlm(null, payload)}
              onTest={onTestLlm}
              onDelete={async () => onAddProvider(false)}
              onCancel={() => onAddProvider(false)}
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}
