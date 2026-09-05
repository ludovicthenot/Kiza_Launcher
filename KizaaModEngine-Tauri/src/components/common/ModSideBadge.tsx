import { HelpCircle, Monitor, Server } from "lucide-react";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

export type ModSide = "client" | "server" | "both";

/**
 * Which side of the game a mod runs on, said with a mark.
 *
 * A screen means it only runs where you play; a server tower means it only runs
 * where the world is; both marks together mean it is needed at each end, which
 * is most gameplay mods. Nothing worth reading is written, because this sits in
 * a row that already carries a name, a description, a source and three
 * versions, and a fifth word would be one too many.
 *
 * <p>Unknown is shown rather than hidden. Forge and NeoForge manifests carry no
 * side at all, so a Forge mod outside a catalogue genuinely cannot be
 * classified — and a row that silently omitted the mark would read as "both",
 * which is a claim nothing here can make.
 */
export function ModSideBadge({
  side,
  className,
}: {
  side: string | null | undefined;
  className?: string;
}) {
  const { t } = useI18n();
  const known: ModSide | null =
    side === "client" || side === "server" || side === "both" ? side : null;

  const tone =
    known === "client"
      ? "border-sky-500/25 bg-sky-500/10 text-sky-300"
      : known === "server"
        ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
        : "border-border/60 bg-secondary/25 text-muted-foreground";

  const label =
    known === "client"
      ? t("Client only — runs where you play, not on a server")
      : known === "server"
        ? t("Server only — runs where the world is, not on your machine")
        : known === "both"
          ? t("Both sides — needed on your machine and on a server")
          : t("Unknown — nothing this mod ships says which side it runs on");

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5",
        tone,
        className,
      )}
    >
      {known === "client" && <Monitor className="h-3.5 w-3.5" />}
      {known === "server" && <Server className="h-3.5 w-3.5" />}
      {known === "both" && (
        <>
          <Monitor className="h-3.5 w-3.5" />
          <Server className="h-3.5 w-3.5" />
        </>
      )}
      {known === null && <HelpCircle className="h-3.5 w-3.5" />}
    </span>
  );
}
