import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Trash2, Lock } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { SkinHead } from "../common/SkinHead";
import {
  useMinecraftAccount,
  useMinecraftAccounts,
  useMinecraftAuthPoll,
  useMinecraftAuthStart,
  useMinecraftLogout,
  useRemoveMinecraftAccount,
  useSetActiveMinecraftAccount,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { OfflineProfiles } from "./OfflineProfiles";

/**
 * Who Kiza plays as.
 *
 * Microsoft accounts and offline profiles sit on the same page on purpose:
 * they answer the same question, and having them under "APIs" and "Minecraft"
 * respectively meant nobody could find either.
 */
export function AccountSettings() {
  const { t } = useI18n();
  const { data: minecraftAccount } = useMinecraftAccount();
  const { data: minecraftAccounts } = useMinecraftAccounts();
  const minecraftAuthStart = useMinecraftAuthStart();
  const minecraftAuthPoll = useMinecraftAuthPoll();
  const minecraftLogout = useMinecraftLogout();
  const setActiveMinecraftAccount = useSetActiveMinecraftAccount();
  const removeMinecraftAccount = useRemoveMinecraftAccount();

  const [minecraftLogin, setMinecraftLogin] = useState<{
    loginId: string;
    userCode: string;
    verificationUri: string;
    interval: number;
  } | null>(null);

  useEffect(() => {
    if (!minecraftLogin) return;

    const timer = window.setInterval(async () => {
      if (minecraftAuthPoll.isPending) return;
      const status = await minecraftAuthPoll.mutateAsync(minecraftLogin.loginId);
      if (typeof status === "object" && "success" in status) {
        setMinecraftLogin(null);
      }
      if (typeof status === "object" && "error" in status) {
        toast.error(status.error);
        setMinecraftLogin(null);
      }
    }, Math.max(minecraftLogin.interval, 3) * 1000);

    return () => window.clearInterval(timer);
  }, [minecraftAuthPoll, minecraftLogin]);

  const startMicrosoftLogin = async () => {
    const result = await minecraftAuthStart.mutateAsync();
    setMinecraftLogin({
      loginId: result.login_id,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      interval: result.interval,
    });
    await openUrl(result.verification_uri);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t("Minecraft accounts")}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {minecraftAccount
                ? `${t("Active account")}: ${minecraftAccount.username}`
                : t("Connect a Microsoft account to play online.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {minecraftAccount && (
              <button
                onClick={() => minecraftLogout.mutate()}
                disabled={minecraftLogout.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 text-sm font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
              >
                {minecraftLogout.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {t("Disconnect all")}
              </button>
            )}
            <button
              onClick={startMicrosoftLogin}
              disabled={minecraftAuthStart.isPending || !!minecraftLogin}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {minecraftAuthStart.isPending || minecraftLogin ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {t("Add account")}
            </button>
          </div>
        </div>

        {(minecraftAccounts ?? []).length > 0 && (
          <div className="mt-4 grid gap-2">
            {(minecraftAccounts ?? []).map((account) => {
              const active = minecraftAccount?.uuid === account.uuid;
              return (
                <div
                  key={account.uuid}
                  className="grid gap-3 rounded-md border border-border/70 bg-background/45 p-3 md:grid-cols-[auto_minmax(0,1fr)_auto]"
                >
                  <div className="h-12 w-12 overflow-hidden rounded-md border border-border bg-secondary/40">
                    {account.skin_head_url ? (
                      <SkinHead url={account.skin_head_url} className="h-full w-full" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                        {account.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{account.username}</span>
                      {active && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                          {t("Active")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {account.uuid}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!active && (
                      <button
                        onClick={() => setActiveMinecraftAccount.mutate(account.uuid)}
                        disabled={setActiveMinecraftAccount.isPending}
                        className="h-9 rounded-md border border-border bg-secondary/30 px-3 text-sm transition hover:bg-secondary disabled:opacity-50"
                      >
                        {t("Use")}
                      </button>
                    )}
                    <button
                      onClick={() => removeMinecraftAccount.mutate(account.uuid)}
                      disabled={removeMinecraftAccount.isPending}
                      className="h-9 rounded-md border border-red-500/30 bg-red-500/10 px-3 text-sm text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
                    >
                      {t("Remove")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {minecraftLogin && (
          <div className="mt-4 grid gap-3 rounded-md border border-border/70 bg-background/50 p-3 md:grid-cols-[1fr_auto]">
            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {minecraftLogin.userCode ? t("Microsoft code") : t("Browser login")}
              </div>
              {minecraftLogin.userCode && (
                <div className="mt-1 font-mono text-2xl font-semibold tracking-normal">
                  {minecraftLogin.userCode}
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Finish Microsoft login in your browser. Kiza Launcher will detect the local callback automatically.")}
              </p>
            </div>
            <button
              onClick={() => openUrl(minecraftLogin.verificationUri)}
              className="h-10 self-center rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary"
            >
              {t("Open again")}
            </button>
          </div>
        )}
      </div>

      <OfflineProfiles />

      {/* Facts rather than switches. Every line here describes something Kiza
          already does and none of it is configurable, so drawing a toggle
          beside any of them would be inventing a choice that does not exist. */}
      <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4 text-muted-foreground" />
          {t("How your sign-in is kept")}
        </div>
        <ul className="space-y-1.5 text-sm leading-5 text-muted-foreground">
          <li>
            {t("Kiza uses Microsoft's own sign-in page. Your password is never typed into Kiza and never stored by it.")}
          </li>
          <li>
            {t("The token that comes back is held in the Windows credential store, not in a file Kiza wrote.")}
          </li>
          <li>
            {t("Nothing about your account leaves this machine. Kiza has no server to send it to.")}
          </li>
          <li>
            {t("Disconnect all removes every token from this machine. It does not touch your Microsoft account.")}
          </li>
        </ul>
      </div>
    </div>
  );
}
