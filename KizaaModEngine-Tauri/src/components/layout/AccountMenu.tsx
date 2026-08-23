import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LogOut, Plus, Settings2, User } from "lucide-react";
import { SkinHead } from "../common/SkinHead";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../../lib/store";
import {
  MinecraftAccount,
  useMinecraftAccount,
  useMinecraftAccounts,
  useMinecraftAuthPoll,
  useMinecraftAuthStart,
  useMinecraftLogout,
  useSetActiveMinecraftAccount,
} from "../../lib/queries";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

function AccountRow({
  account,
  active,
  onSelect,
}: {
  account: MinecraftAccount;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition",
        active ? "bg-primary/10" : "hover:bg-secondary/60",
      )}
    >
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
        <SkinHead url={account.skin_head_url} className="h-6 w-6 rounded-sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{account.username}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{account.uuid}</span>
      </span>
      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}

export function AccountMenu() {
  const { t } = useI18n();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const { data: account } = useMinecraftAccount();
  const { data: accounts } = useMinecraftAccounts();
  const setActiveAccount = useSetActiveMinecraftAccount();
  const logout = useMinecraftLogout();
  const authStart = useMinecraftAuthStart();
  const authPoll = useMinecraftAuthPoll();

  const [open, setOpen] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<{ loginId: string; interval: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!pendingLogin) return;
    const timer = window.setInterval(async () => {
      if (authPoll.isPending) return;
      const status = await authPoll.mutateAsync(pendingLogin.loginId);
      if (typeof status === "object" && "success" in status) {
        setPendingLogin(null);
      }
      if (typeof status === "object" && "error" in status) {
        toast.error(status.error);
        setPendingLogin(null);
      }
    }, Math.max(pendingLogin.interval, 3) * 1000);
    return () => window.clearInterval(timer);
  }, [authPoll, pendingLogin]);

  const startAddAccount = async () => {
    const result = await authStart.mutateAsync();
    setPendingLogin({ loginId: result.login_id, interval: result.interval });
    await openUrl(result.verification_uri);
  };

  return (
    <div ref={menuRef} className="relative" onMouseDown={(event) => event.stopPropagation()}>
      <button
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-secondary cursor-pointer"
        title={account ? `${t("Microsoft account")}: ${account.username}` : t("Sign in with Microsoft")}
      >
        {account ? (
          <>
            <span className="relative flex h-5 w-5 items-center justify-center">
              <SkinHead url={account.skin_head_url} className="h-5 w-5 rounded-sm" />
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card bg-emerald-400" />
            </span>
            <span className="max-w-[140px] truncate text-xs font-semibold text-foreground">{account.username}</span>
          </>
        ) : (
          <>
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("Sign in")}</span>
          </>
        )}
      </button>

      {open && (
        <div className="kiza-enter absolute right-0 top-9 z-50 w-72 rounded-xl border border-border/80 bg-popover p-2 kiza-elevated">
          <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("Minecraft accounts")}
          </div>

          {(accounts ?? []).length > 0 ? (
            <div className="space-y-0.5">
              {(accounts ?? []).map((entry) => (
                <AccountRow
                  key={entry.uuid}
                  account={entry}
                  active={entry.uuid === account?.uuid}
                  onSelect={() => {
                    if (entry.uuid !== account?.uuid) {
                      setActiveAccount.mutate(entry.uuid);
                    }
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              {t("No Microsoft account connected yet.")}
            </p>
          )}

          <div className="my-1.5 h-px bg-border/70" />

          <button
            onClick={startAddAccount}
            disabled={authStart.isPending || !!pendingLogin}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-secondary/60 disabled:opacity-50"
          >
            {authStart.isPending || pendingLogin ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Plus className="h-4 w-4 text-primary" />
            )}
            {pendingLogin ? t("Waiting for Microsoft sign-in...") : t("Add Microsoft account")}
          </button>

          <button
            onClick={() => {
              setOpen(false);
              setShowSettings(true, "minecraft");
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-secondary/60"
          >
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            {t("Manage accounts")}
          </button>

          {account && (
            <button
              onClick={() => {
                logout.mutate();
                setOpen(false);
              }}
              disabled={logout.isPending}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              {t("Sign out")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
