import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type CursorModel, type LlmProvider } from "@/lib/api";
import { cn } from "@/lib/utils";

const CURSOR_VALUE_SEP = "::";

interface Props {
  providers: LlmProvider[];
  providerId: string;
  modelId: string;
  disabled?: boolean;
  className?: string;
  onChange: (next: { providerId: string; modelId: string }) => void;
}

export function LlmProviderModelSelect({
  providers,
  providerId,
  modelId,
  disabled,
  className,
  onChange,
}: Props) {
  const [cursorModelsByProvider, setCursorModelsByProvider] = useState<
    Record<string, CursorModel[]>
  >({});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const activeProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const cursorModels = activeProvider?.provider === "cursor"
    ? (cursorModelsByProvider[activeProvider.id] ?? activeProvider.models ?? [])
    : [];

  const value = activeProvider?.provider === "cursor" && modelId
    ? `${providerId}${CURSOR_VALUE_SEP}${modelId}`
    : providerId;

  useEffect(() => {
    let cancelled = false;
    const cursorProviders = providers.filter((provider) => provider.provider === "cursor");
    if (cursorProviders.length === 0) {
      setCursorModelsByProvider({});
      return;
    }

    const seeded: Record<string, CursorModel[]> = {};
    for (const provider of cursorProviders) {
      if (provider.models?.length) seeded[provider.id] = provider.models;
    }
    if (Object.keys(seeded).length) {
      setCursorModelsByProvider((current) => ({ ...current, ...seeded }));
    }

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
    if (!activeProvider || activeProvider.provider !== "cursor") return;
    if (modelId && cursorModels.some((model) => model.id === modelId)) return;
    const fallback =
      (activeProvider.model &&
          cursorModels.some((model) => model.id === activeProvider.model)
        ? activeProvider.model
        : undefined) ??
        cursorModels[0]?.id ??
        "";
    if (!fallback || fallback === modelId) return;
    onChangeRef.current({ providerId: activeProvider.id, modelId: fallback });
  }, [activeProvider, cursorModels, modelId]);

  return (
    <Select
      value={value || undefined}
      onValueChange={(next) => {
        const sep = next.indexOf(CURSOR_VALUE_SEP);
        if (sep >= 0) {
          onChange({
            providerId: next.slice(0, sep),
            modelId: next.slice(sep + CURSOR_VALUE_SEP.length),
          });
          return;
        }
        onChange({ providerId: next, modelId: "" });
      }}
      disabled={providers.length === 0 || disabled}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-7",
          className,
        )}
        aria-label="Pilih provider / model"
      >
        <SelectValue placeholder="Provider" />
      </SelectTrigger>
      <SelectContent className="min-w-[14rem]">
        {providers.map((provider) => {
          if (provider.provider === "cursor") {
            const models = cursorModelsByProvider[provider.id] ?? provider.models ?? [];
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
  );
}
