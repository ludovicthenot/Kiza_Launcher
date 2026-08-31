import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCompleteFirstRunSetup,
  useMinecraftAccount,
  useMinecraftAuthPoll,
  useMinecraftAuthStart,
  usePerformanceProfiles,
} from "../../lib/queries";
import { SkinHead } from "../common/SkinHead";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { useThemeAsset } from "../../lib/theme/assets";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

/**
 * The first thing anyone sees.
 *
 * It used to be five steps down a sidebar: Microsoft, Runtime, Performance,
 * APIs, Ready. Four of them asked for nothing the launcher could not do itself.
 * The runtime step offered to install Java, which Kiza already installs on its
 * own at the first launch. The APIs step was a read-only list of service
 * statuses with no action on it at all. And every word of it was in English
 * while the launcher speaks French.
 *
 * There is one real decision on a first launch — whether to sign in — so there
 * is one screen. The memory profile stays because it is a genuine choice with a
 * real consequence, but it sits on one line and is already answered.
 *
 * Drawn like the startup overlay rather than like a form, because this is the
 * same moment: the launcher introducing itself.
 */

export function FirstRunSetupView() {
  const kizaHeader = useThemeAsset("logo");
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: account } = useMinecraftAccount();
  const { data: profiles } = usePerformanceProfiles();
  const authStart = useMinecraftAuthStart();
  const authPoll = useMinecraftAuthPoll();
  const completeSetup = useCompleteFirstRunSetup();

  const [profile, setProfile] = useState("balanced");
  const [login, setLogin] = useState<{
    loginId: string;
    userCode: string;
    verificationUri: string;
    interval: number;
  } | null>(null);

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap
      .timeline({ defaults: { ease: "power3.out" } })
      .from('[data-anim="intro-logo"]', {
        scale: 0.86,
        opacity: 0,
        duration: 0.55,
        ease: "back.out(1.5)",
        clearProps: "opacity,transform",
      })
      .from(
        '[data-anim="intro-body"] > *',
        {
          y: 12,
          opacity: 0,
          duration: 0.4,
          stagger: 0.07,
          // Cleared when the tween ends, so nothing is left holding an inline
          // `opacity: 0`. Without it the way out of this screen was drawn,
          // measured, clickable and invisible.
          clearProps: "opacity,transform",
        },
        "-=0.2",
      );
  }, { scope: containerRef });

  // The browser half of the sign-in reports back by polling, so the screen
  // never has to ask "have you finished yet".
  useEffect(() => {
    if (!login) return;
    const timer = window.setInterval(async () => {
      if (authPoll.isPending) return;
      const status = await authPoll.mutateAsync(login.loginId);
      if (typeof status === "object" && "success" in status) setLogin(null);
      if (typeof status === "object" && "error" in status) {
        toast.error(status.error);
        setLogin(null);
      }
    }, Math.max(login.interval, 3) * 1000);
    return () => window.clearInterval(timer);
  }, [authPoll, login]);

  const signIn = async () => {
    try {
      const result = await authStart.mutateAsync();
      setLogin({
        loginId: result.login_id,
        userCode: result.user_code,
        verificationUri: result.verification_uri,
        interval: result.interval,
      });
      await openUrl(result.verification_uri);
    } catch {
      // The mutation already says what went wrong.
    }
  };

  /**
   * `skipped` records what was not done, which is what the launcher reads later
   * to decide whether to offer it again.
   */
  const finish = (skipped: string[]) =>
    completeSetup.mutate({ selectedPerformanceProfile: profile, skippedSteps: skipped });

  const busy = completeSetup.isPending;

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-background px-6 py-10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(50rem 30rem at 50% -10%, hsl(var(--primary) / 0.14), transparent 60%), radial-gradient(40rem 24rem at 50% 115%, hsl(var(--primary) / 0.08), transparent 65%)",
        }}
      />

      <div className="relative flex w-full max-w-[440px] flex-col items-center text-center">
        <img
          data-anim="intro-logo"
          src={kizaHeader}
          alt="Kiza Launcher"
          draggable={false}
          className="h-24 w-auto select-none drop-shadow-[0_0_24px_hsl(var(--primary)/0.35)]"
        />

        <div data-anim="intro-body" className="contents">
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("Welcome to Kiza")}</h1>

          {account ? (
            <>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("You are signed in. Everything else is ready.")}
              </p>

              <div className="mt-6 flex w-full items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.07] p-3 text-left">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-secondary/40">
                  <SkinHead url={account.skin_head_url} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{account.username}</div>
                  <div className="text-xs text-muted-foreground">{t("Microsoft account")}</div>
                </div>
                <Check className="h-5 w-5 shrink-0 text-emerald-400" />
              </div>
            </>
          ) : login ? (
            <>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("Finish in your browser, then come back here. This screen notices on its own.")}
              </p>

              {/* The code stays on screen rather than only in the browser: the
                  browser tab is where it is typed, and a code you have to go
                  back and forth for is the thing people give up on. */}
              {login.userCode && (
                <div className="mt-6 w-full rounded-xl border border-border/70 bg-card/40 p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t("Your code")}
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-3">
                    <span className="font-mono text-3xl font-bold tracking-[0.2em]">
                      {login.userCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(login.userCode);
                        toast.success(t("Code copied."));
                      }}
                      title={t("Copy the code")}
                      aria-label={t("Copy the code")}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => void openUrl(login.verificationUri)}
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-secondary/25 text-sm font-medium transition hover:border-primary/40 hover:bg-secondary/40"
              >
                <ExternalLink className="h-4 w-4" />
                {t("Open the browser again")}
              </button>

              <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("Waiting for Microsoft...")}
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("Sign in with the Microsoft account that owns Minecraft, and you are done.")}
              </p>

              <button
                type="button"
                onClick={() => void signIn()}
                disabled={authStart.isPending}
                className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(139,92,246,0.95)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
              >
                {authStart.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {t("Sign in with Microsoft")}
              </button>
            </>
          )}

          {/* One line, already answered, and it changes how much memory the
              game gets — which is worth one line and not a page. */}
          <div className="mt-8 w-full text-left">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("Memory for the game")}
            </div>
            <div className="flex gap-1.5 rounded-xl border border-border/70 bg-card/30 p-1">
              {(profiles ?? []).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setProfile(entry.id)}
                  title={entry.description}
                  className={cn(
                    "flex-1 rounded-lg px-2 py-2 text-xs font-medium transition",
                    profile === entry.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                  )}
                >
                  <span className="block truncate">{t(entry.label)}</span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[10px] tabular-nums",
                      profile === entry.id ? "opacity-80" : "opacity-60",
                    )}
                  >
                    {Math.round(entry.max_memory_mb / 1024)} GB
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => finish(account ? [] : ["account"])}
            disabled={busy}
            className={cn(
              "mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:opacity-60",
              account
                ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-[0_8px_24px_-10px_rgba(139,92,246,0.95)] hover:brightness-110 active:scale-[0.99]"
                // Legible on its own. At border-70 over a near-black page this
                // read as empty space, which for the one way out of the screen
                // is worse than not drawing it.
                : "border border-border bg-secondary/60 text-foreground hover:border-primary/45 hover:bg-secondary",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {account ? t("Start") : t("Continue without an account")}
          </button>

          {/* Said once, quietly, because it is the reason there is nothing else
              to do on this screen. */}
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            {t("Java and Minecraft install themselves the first time you play. You can sign in, add accounts and change anything in Settings.")}
          </p>
        </div>
      </div>
    </div>
  );
}
