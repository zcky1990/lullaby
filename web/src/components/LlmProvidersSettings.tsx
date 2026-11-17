import { ChevronDown, Plus } from "lucide-react";
import { LlmProviderForm } from "@/components/LlmProviderForm";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/lib/i18n";
import type { LlmProvider, LlmProviderPayload, TestResult } from "@/lib/api";

interface Props {
  providers: LlmProvider[];
  addingProvider: boolean;
  onAddProvider: (value: boolean) => void;
  onTestLlm: (payload: LlmProviderPayload, providerId?: string) => Promise<TestResult>;
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
  const { t } = useI18n();
  return (
    <section className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {t("settings.llm.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("settings.llm.description")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddProvider(true)}
            data-icon="inline-start"
          >
            <Plus />
            {t("settings.llm.add")}
          </Button>
        </div>
        <Separator />
      </div>

      {providers.length === 0 && !addingProvider ? (
        <p className="text-xs text-muted-foreground">{t("settings.llm.empty")}</p>
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
              {t("settings.llm.newProvider")}
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
