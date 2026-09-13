import { Boxes, Server, Users } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { MINECRAFT_LOADER_LABELS } from "../../lib/minecraftLoaders";
import { presetById } from "../../lib/serverPresets";
import { useServerIcon, type HostedServer } from "../../lib/hostQueries";
import { stateLabel, stateTone } from "./format";

/**
 * One server in the Manager's grid: picture, name, version, state, players.
 *
 * The picture is the server's own icon when it has one, otherwise the scene
 * of the preset it came from, otherwise the launcher's violet.
 */
export function ServerCard({
  server,
  selected,
  onSelect,
}: {
  server: HostedServer;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const { data: icon } = useServerIcon(server.id, server.has_icon);
  const preset = presetById(server.preset);
  const [ground, sky, light] = preset?.scene ?? ["#120a24", "#4c1d95", "#a78bfa"];
  const tone = stateTone(server.status.state);
  const loader = server.loader === "vanilla"
    ? "Vanilla"
    : `${MINECRAFT_LOADER_LABELS[server.loader]} ${server.loader_version ?? ""}`.trim();

  return (
    <button
      type="button"
      data-anim="server"
      aria-pressed={selected}
      onClick={onSelect}
      {...editable("card")}
      className={cn(
        "kiza-card group relative flex min-h-[220px] flex-col overflow-hidden border bg-card/30 text-left transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/50",
        selected && "border-primary/70 shadow-[0_0_30px_-8px_hsl(var(--primary)/0.7)]",
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: [
            `radial-gradient(ellipse at 75% 25%, ${light}aa 0%, transparent 45%)`,
            `linear-gradient(180deg, ${sky} 0%, ${ground} 75%)`,
          ].join(","),
        }}
      />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[65%] bg-gradient-to-t from-background via-background/90 to-transparent" />

      <span className={cn("absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur", tone.ring, tone.text)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
        {t(stateLabel(server.status.state))}
      </span>

      <div className="relative mt-auto flex items-end gap-3 p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background/60 text-primary ring-1 ring-border/60">
          {icon ? <img src={icon} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" /> : <Server className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xl font-bold">{server.name}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {server.mc_version} · {loader}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Users className="h-3.5 w-3.5" />
            {server.status.players.length}
          </span>
          {server.loader !== "vanilla" && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Boxes className="h-3.5 w-3.5" />
              {server.mod_count}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}
