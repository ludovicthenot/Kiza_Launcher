import { GameInstanceSummary } from "../../lib/types";
import { StatusBadge } from "./StatusBadge";
import { Blocks, Play, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatDistanceToNow } from "date-fns";
import { fr as frDateLocale } from "date-fns/locale";
import { formatMinecraftLoader } from "../../lib/minecraftLoaders";
import { useI18n } from "../../lib/i18n";

interface InstanceCardProps {
  instance: GameInstanceSummary;
  onClick: () => void;
  onVerify: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function InstanceCard({ instance, onClick, onVerify, className, style }: InstanceCardProps) {
  const { t, lang } = useI18n();
  const { display_name, status, install_path, last_verified_at, active_profile_id, minecraft } = instance;
  const loaderLabel = formatMinecraftLoader(minecraft);

  return (
    <div
      onClick={onClick}
      style={style}
      className={cn(
        "group relative cursor-pointer rounded-2xl border border-border/60 bg-card p-5 kiza-elevated",
        "transition-[transform,border-color,box-shadow] duration-200",
        "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05),0_2px_4px_hsl(242_30%_3%/0.5),0_16px_40px_-16px_hsl(258_90%_66%/0.25)]",
        "active:translate-y-0 active:scale-[0.99]",
        className
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)]">
            <Blocks className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold leading-tight">{display_name}</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={install_path}>
              {install_path}
            </p>
          </div>
        </div>
        <Play className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border/30 bg-secondary/30 p-2">
          <div className="mb-0.5 text-xs text-muted-foreground">{t("Version")}</div>
          <div className="truncate text-sm font-medium tabular-nums">{minecraft?.mc_version ?? "Minecraft"}</div>
        </div>
        <div className="rounded-lg border border-border/30 bg-secondary/30 p-2">
          <div className="mb-0.5 text-xs text-muted-foreground">Loader</div>
          <div className="truncate text-sm font-medium tabular-nums">{loaderLabel}</div>
        </div>
        <div className="rounded-lg border border-border/30 bg-secondary/30 p-2">
          <div className="mb-0.5 text-xs text-muted-foreground">Mods</div>
          <div className="text-sm font-medium tabular-nums">{instance.active_mod_count ?? instance.mod_count}</div>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{active_profile_id ? t("Custom profile") : t("Balanced profile")}</div>
            <div className="truncate text-xs text-muted-foreground">{t("Managed Java, isolated folder, user-selected mods.")}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/50 pt-3">
        <StatusBadge status={status} />
        
        <div className="flex items-center gap-2">
          {last_verified_at && (
            <span className="text-[10px] text-muted-foreground">
              {t("Checked {time} ago").replace(
                "{time}",
                formatDistanceToNow(new Date(last_verified_at), { locale: lang === "fr" ? frDateLocale : undefined }),
              )}
            </span>
          )}
          <button 
            onClick={onVerify}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
            title={t("Verify instance")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
