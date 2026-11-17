import type { ReactNode } from "react";
import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Preferensi bahasa UI (Global Settings → Appearance). Perubahan langsung
 * berlaku karena `I18nProvider` menyimpan locale di context + `ui_preferences`.
 */
export function LanguageSettings({ children }: { children?: ReactNode }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
          <Languages className="size-3.5" />
          {t("language.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("language.description")}</p>
        <div className="h-px w-full bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">{t("language.label")}</span>
        <Select
          value={locale}
          onValueChange={(value) => setLocale(value === "en" ? "en" : "id")}
        >
          <SelectTrigger size="sm" className="w-56" aria-label={t("language.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="id">{t("language.option.id")}</SelectItem>
              <SelectItem value="en">{t("language.option.en")}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("language.hint")}</p>
      </div>
      {children}
    </section>
  );
}
