import { useEffect, useState } from "react";
import { ExternalLink, Github, Info, Loader2, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "../../lib/i18n";
import { useUpdaterStore } from "../../lib/updater";
import { ActionButton, Row, Section } from "./controls";
import kizaHeader from "../../assets/kiza-header.png";

const REPOSITORY = "https://github.com/ludovicthenot/Kiza-Client";

/**
 * What this is, which version of it, and where it came from.
 *
 * The update state shown here is the launcher's real one — the same store the
 * Update button in the title bar reads — rather than a second, prettier
 * account of it that could disagree.
 */
export function AboutSettings() {
  const { t } = useI18n();
  const updater = useUpdaterStore();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const updateLine = () => {
    switch (updater.phase) {
      case "checking":
        return t("Checking…");
      case "available":
        return t("An update is available.");
      case "downloading":
        return t("Downloading the update…");
      case "ready":
      case "deferred":
        return t("An update is ready to install.");
      case "installing":
        return t("Installing…");
      default:
        return t("Kiza is up to date.");
    }
  };

  const busy = updater.phase === "checking" || updater.phase === "downloading";

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-secondary/10 px-4 py-8 text-center">
        <img src={kizaHeader} alt="Kiza Launcher" className="h-24 w-auto" />
        <div className="text-sm text-muted-foreground">
          {version ? (
            <span className="font-mono">v{version}</span>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
        </div>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("A Minecraft launcher with isolated instances, managed mods, and a Kiza client drawn inside the game.")}
        </p>
      </div>

      <Section icon={RefreshCw} title={t("Updates")}>
        <Row label={updateLine()}>
          <ActionButton
            onClick={() => void updater.checkForUpdate()}
            busy={busy}
            icon={RefreshCw}
          >
            {t("Check now")}
          </ActionButton>
        </Row>
        <Row
          label={t("How updates arrive")}
          hint={t("Kiza checks at launch and every five minutes. Each update is signed, and one that fails its signature is refused.")}
        />
      </Section>

      <Section icon={Info} title={t("Project")}>
        <Row label={t("Source code and releases")}>
          <ActionButton onClick={() => void openUrl(REPOSITORY)} icon={Github}>
            {t("Open")}
          </ActionButton>
        </Row>
        <Row label={t("Report a problem")}>
          <ActionButton onClick={() => void openUrl(`${REPOSITORY}/issues`)} icon={ExternalLink}>
            {t("Open")}
          </ActionButton>
        </Row>
      </Section>

      {/* Named because they are other people's work, and because someone
          reading an About page is entitled to know what is inside. */}
      <Section icon={Info} title={t("Built with")}>
        <Row label="Tauri, Rust, React" hint={t("The launcher itself.")} />
        <Row
          label="Modrinth, CurseForge"
          hint={t("Where mods come from. Kiza is not affiliated with either.")}
        />
        <Row
          label="Mojang, Microsoft"
          hint={t("Minecraft and the accounts that sign in to it. Kiza is not affiliated with either.")}
        />
      </Section>
    </div>
  );
}
