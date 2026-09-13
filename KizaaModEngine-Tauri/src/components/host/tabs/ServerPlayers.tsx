import { useState } from "react";
import { Ban, Crown, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { editable } from "../../../lib/maker/editable";
import { usePlayerAction, useServerPlayers, type HostedServer, type PlayerAction } from "../../../lib/hostQueries";
import { Input } from "../../ui/primitives";

/**
 * Who is on, who runs things, who may join, who may not.
 *
 * Every button here is a console command in disguise — `op`, `kick`,
 * `whitelist add` — so the server itself keeps its lists, and none of it is
 * available while it is off. The lists are still shown then, read from the
 * files, so the page is never blank.
 */
export function ServerPlayers({ server }: { server: HostedServer }) {
  const { t } = useI18n();
  const { data: lists } = useServerPlayers(server.id);
  const act = usePlayerAction();
  const online = server.status.state === "online";
  const [name, setName] = useState("");

  const run = (action: PlayerAction, player: string) => act.mutate({ serverId: server.id, action, player });
  const isOp = (player: string) => lists?.ops.some((p) => p.name === player) ?? false;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {!online && (
        <p className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-2.5 text-sm text-muted-foreground lg:col-span-2">
          {t("Player actions go through the running server. Start it to kick, ban, op or whitelist.")}
        </p>
      )}

      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Users className="h-4 w-4" />
          {t("Online")} · {server.status.players.length}
        </h3>
        {server.status.players.length === 0 ? (
          <p className="text-sm text-muted-foreground">{online ? t("Nobody is on.") : t("The server is off.")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {server.status.players.map((player) => (
              <li key={player} className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{player}</span>
                {isOp(player) && <Crown className="h-3.5 w-3.5 text-amber-300" />}
                <Action icon={isOp(player) ? UserMinus : Crown} label={isOp(player) ? t("Deop") : t("Op")} onClick={() => run(isOp(player) ? "deop" : "op", player)} disabled={!online} />
                <Action icon={UserMinus} label={t("Kick")} onClick={() => run("kick", player)} disabled={!online} />
                <Action icon={Ban} label={t("Ban")} tone="danger" onClick={() => run("ban", player)} disabled={!online} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          {t("Whitelist")}
          {lists && (
            <span className={cn("ml-1 rounded-full border px-2 py-0.5 text-[11px] normal-case tracking-normal", lists.whitelist_enabled ? "border-emerald-400/40 text-emerald-300" : "border-border/70")}>
              {lists.whitelist_enabled ? t("enforced") : t("off")}
            </span>
          )}
        </h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            run("whitelist_add", name.trim());
            setName("");
          }}
          className="mb-3 flex gap-2"
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Player name")} disabled={!online} />
          <button type="submit" disabled={!online || !name.trim()} className="kiza-action inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <UserPlus className="h-4 w-4" />
            {t("Add")}
          </button>
        </form>
        <NameList
          players={lists?.whitelist ?? []}
          empty={t("Nobody on the whitelist.")}
          action={(player) => <Action icon={UserMinus} label={t("Remove")} onClick={() => run("whitelist_remove", player)} disabled={!online} />}
        />
      </section>

      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Crown className="h-4 w-4" />
          {t("Operators")}
        </h3>
        <NameList
          players={lists?.ops ?? []}
          empty={t("No operator yet. Op yourself from the Online list once you join.")}
          detail={(player) => (player.level != null ? `${t("level")} ${player.level}` : undefined)}
          action={(player) => <Action icon={UserMinus} label={t("Deop")} onClick={() => run("deop", player)} disabled={!online} />}
        />
      </section>

      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Ban className="h-4 w-4" />
          {t("Banned")}
        </h3>
        <NameList
          players={lists?.banned ?? []}
          empty={t("Nobody is banned.")}
          detail={(player) => player.reason ?? undefined}
          action={(player) => <Action icon={UserPlus} label={t("Pardon")} onClick={() => run("pardon", player)} disabled={!online} />}
        />
      </section>
    </div>
  );
}

function NameList({
  players,
  empty,
  detail,
  action,
}: {
  players: Array<{ name: string; level?: number | null; reason?: string | null }>;
  empty: string;
  detail?: (player: { name: string; level?: number | null; reason?: string | null }) => string | undefined;
  action: (name: string) => React.ReactNode;
}) {
  if (players.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {players.map((player) => (
        <li key={player.name} className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{player.name}</span>
            {detail?.(player) && <span className="ml-2 text-xs text-muted-foreground">{detail(player)}</span>}
          </span>
          {action(player.name)}
        </li>
      ))}
    </ul>
  );
}

function Action({ icon: Icon, label, onClick, disabled, tone }: { icon: typeof Ban; label: string; onClick: () => void; disabled: boolean; tone?: "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40",
        tone === "danger" && "hover:border-red-400/50 hover:text-red-300",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
