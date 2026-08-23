import { useEffect, useState } from "react";
import { CalendarClock, Globe } from "lucide-react";
import { AppConfig, useAppConfig, useSaveAppConfig } from "../../lib/queries";
import { LANGUAGES, Language, useI18n } from "../../lib/i18n";
import { formatsFromConfig, sample } from "../../lib/datetime";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { ConfigGate, Row, Section } from "./controls";

/**
 * Language, and the two formats that follow from where someone lives.
 *
 * The date and clock choices are not decoration: they are read by
 * `useRegionFormats` wherever the launcher prints a moment. The example
 * underneath updates as the choice is made, because the difference between
 * 25/12 and 12/25 is not something anyone should have to take on trust.
 */
export function LanguageSettings() {
  const { lang, setLang, t } = useI18n();
  const { data: config, isLoading, error } = useAppConfig();
  const saveConfig = useSaveAppConfig();

  const [draft, setDraft] = useState<AppConfig | null>(null);
  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const update = (patch: Partial<AppConfig>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    saveConfig.mutate(next);
  };

  return (
    <ConfigGate
      ready={!!draft}
      loading={isLoading}
      error={error}
      message={t("Kiza could not read its settings file.")}
    >
      {draft && (
        <div className="space-y-6">
          <Section icon={Globe} title={t("Language")}>
            <Row
              label={t("Launcher language")}
              hint={t("Minecraft keeps its own language setting, inside the game.")}
            >
              <div className="w-72">
                <LauncherOptionPicker
                  ariaLabel={t("Launcher language")}
                  options={LANGUAGES.map((language) => ({
                    value: language.id,
                    label: language.label,
                  }))}
                  value={lang}
                  onValueChange={(value) => setLang(value as Language)}
                  placeholder={t("Choose a language")}
                />
              </div>
            </Row>
          </Section>

          <Section icon={CalendarClock} title={t("Dates and times")}>
            <Row label={t("Date")}>
              <div className="w-72">
                <LauncherOptionPicker
                  ariaLabel={t("Date")}
                  options={[
                    { value: "system", label: t("Follow Windows") },
                    { value: "dmy", label: t("Day / month / year") },
                    { value: "mdy", label: t("Month / day / year") },
                    { value: "ymd", label: t("Year-month-day") },
                  ]}
                  placeholder={t("Follow Windows")}
                  value={draft.date_format}
                  onValueChange={(value) => update({ date_format: value })}
                />
              </div>
            </Row>
            <Row label={t("Clock")}>
              <div className="w-72">
                <LauncherOptionPicker
                  ariaLabel={t("Clock")}
                  options={[
                    { value: "system", label: t("Follow Windows") },
                    { value: "24h", label: t("24-hour") },
                    { value: "12h", label: t("12-hour") },
                  ]}
                  placeholder={t("Follow Windows")}
                  value={draft.time_format}
                  onValueChange={(value) => update({ time_format: value })}
                />
              </div>
            </Row>
            <Row label={t("Example")}>
              <span className="font-mono text-sm tabular-nums">
                {sample(formatsFromConfig(draft))}
              </span>
            </Row>
          </Section>

          <p className="text-xs text-muted-foreground">
            {t("Following Windows is the right answer for most people: the question was already answered once, in the region settings.")}
          </p>
        </div>
      )}
    </ConfigGate>
  );
}
