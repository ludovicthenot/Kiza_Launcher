import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SkinHead } from "../common/SkinHead";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  PlugZap,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  useApiConnections,
  useCompleteFirstRunSetup,
  useDetectMinecraftRuntime,
  useInstallMinecraftRuntime,
  useMinecraftAccount,
  useMinecraftAccounts,
  useMinecraftAuthPoll,
  useMinecraftAuthStart,
  usePerformanceProfiles,
} from "../../lib/queries";
import { cn } from "../../lib/utils";

type SetupStep = "account" | "runtime" | "performance" | "apis" | "finish";

const steps: Array<{ id: SetupStep; label: string; icon: typeof ShieldCheck }> = [
  { id: "account", label: "Microsoft", icon: ShieldCheck },
  { id: "runtime", label: "Runtime", icon: Cpu },
  { id: "performance", label: "Performance", icon: SlidersHorizontal },
  { id: "apis", label: "APIs", icon: PlugZap },
  { id: "finish", label: "Ready", icon: CheckCircle2 },
];

export function FirstRunSetupView() {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState("balanced");
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);
  const [minecraftLogin, setMinecraftLogin] = useState<{
    loginId: string;
    userCode: string;
    verificationUri: string;
    interval: number;
  } | null>(null);

  const currentStep = steps[stepIndex];
  const { data: account } = useMinecraftAccount();
  const { data: accounts } = useMinecraftAccounts();
  const { data: connections } = useApiConnections();
  const { data: runtime, refetch: refetchRuntime } = useDetectMinecraftRuntime("1.20.5");
  const { data: profiles } = usePerformanceProfiles();
  const installRuntime = useInstallMinecraftRuntime();
  const authStart = useMinecraftAuthStart();
  const authPoll = useMinecraftAuthPoll();
  const completeSetup = useCompleteFirstRunSetup();

  const apiSummary = useMemo(() => {
    const list = connections ?? [];
    const ready = list.filter((item) => item.status === "connected" || item.status === "configured" || item.status === "available").length;
    return { ready, total: list.length };
  }, [connections]);

  useEffect(() => {
    if (!minecraftLogin) return;
    const timer = window.setInterval(async () => {
      if (authPoll.isPending) return;
      const status = await authPoll.mutateAsync(minecraftLogin.loginId);
      if (typeof status === "object" && "success" in status) {
        setMinecraftLogin(null);
      }
      if (typeof status === "object" && "error" in status) {
        toast.error(status.error);
        setMinecraftLogin(null);
      }
    }, Math.max(minecraftLogin.interval, 3) * 1000);

    return () => window.clearInterval(timer);
  }, [authPoll, minecraftLogin]);

  const markSkipped = (id: string) => {
    setSkippedSteps((current) => current.includes(id) ? current : [...current, id]);
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  const startMicrosoftLogin = async () => {
    const result = await authStart.mutateAsync();
    setMinecraftLogin({
      loginId: result.login_id,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      interval: result.interval,
    });
    await openUrl(result.verification_uri);
  };

  const complete = () => {
    completeSetup.mutate({
      selectedPerformanceProfile: selectedProfile,
      skippedSteps,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 border-r border-border/70 bg-card/50 p-5 md:block">
        <div className="mb-8">
          <div className="text-sm font-semibold text-foreground">Kiza Launcher setup</div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">Configure Kiza Launcher before your first game.</p>
        </div>
        <div className="space-y-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const active = index === stepIndex;
            const done = index < stepIndex;
            return (
              <button
                key={step.id}
                onClick={() => setStepIndex(index)}
                className={cn(
                  "flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                <span className="font-medium">{step.label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border/70 px-6 py-5">
          <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">First launch</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Essential configuration</h1>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {currentStep.id === "account" && (
              <section className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Secure Microsoft login</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Connect your Microsoft account to play Minecraft online.</p>
                  </div>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">{account ? `Active: ${account.username}` : "No Minecraft account connected"}</div>
                      <p className="mt-1 text-sm text-muted-foreground">You can add more accounts later in Settings.</p>
                    </div>
                    {!account && (
                      <button
                        onClick={startMicrosoftLogin}
                        disabled={authStart.isPending || !!minecraftLogin}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                      >
                        {authStart.isPending || minecraftLogin ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                        Connect Microsoft
                      </button>
                    )}
                  </div>

                  {minecraftLogin && (
                    <div className="mt-4 grid gap-3 rounded-md border border-border/70 bg-background/60 p-3 md:grid-cols-[1fr_auto]">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                          {minecraftLogin.userCode ? "Code" : "Browser login"}
                        </div>
                        {minecraftLogin.userCode && <div className="mt-1 font-mono text-2xl font-semibold tracking-normal">{minecraftLogin.userCode}</div>}
                        <p className="mt-1 text-xs text-muted-foreground">Finish login in the browser, then return to Kiza Launcher.</p>
                      </div>
                      <button
                        onClick={() => openUrl(minecraftLogin.verificationUri)}
                        className="h-10 self-center rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary"
                      >
                        Open browser
                      </button>
                    </div>
                  )}

                  {(accounts ?? []).length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(accounts ?? []).map((item) => (
                        <div key={item.uuid} className="flex items-center gap-2 rounded-md border border-border/70 bg-background/45 px-2 py-1.5">
                          <div className="h-7 w-7 overflow-hidden rounded border border-border bg-secondary/40">
                            <SkinHead url={item.skin_head_url} className="h-full w-full" />
                          </div>
                          <span className="text-sm font-medium">{item.username}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {currentStep.id === "runtime" && (
              <section className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                    <Cpu className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Managed Java runtime</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Modern Minecraft needs Java {runtime?.required_major ?? 21}. Kiza Launcher can install a managed Temurin runtime without touching the official launcher.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">{runtime?.valid ? "Runtime ready" : "Runtime missing"}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{runtime?.message ?? "Checking runtime..."}</p>
                      {runtime?.java_path && <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{runtime.java_path}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => refetchRuntime()}
                        className="h-10 rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary"
                      >
                        Refresh
                      </button>
                      <button
                        onClick={() => installRuntime.mutate({ mcVersion: "1.20.5", javaMajor: runtime?.required_major ?? 21 }, { onSuccess: () => refetchRuntime() })}
                        disabled={installRuntime.isPending}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                      >
                        {installRuntime.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                        Install runtime
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {currentStep.id === "performance" && (
              <section className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                    <SlidersHorizontal className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Default performance profile</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      This profile controls safe JVM and memory defaults. Performance mods remain entirely under your control.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {(profiles ?? []).map((profile) => (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedProfile(profile.id)}
                      className={cn(
                        "rounded-lg border p-4 text-left transition active:scale-[0.99]",
                        selectedProfile === profile.id ? "border-primary bg-primary/10" : "border-border/70 bg-secondary/10 hover:bg-secondary/20",
                      )}
                    >
                      <div className="text-sm font-semibold">{profile.label}</div>
                      <p className="mt-2 min-h-16 text-sm leading-5 text-muted-foreground">{profile.description}</p>
                      <div className="mt-4 font-mono text-xs text-muted-foreground">
                        {profile.min_memory_mb}M - {profile.max_memory_mb}M
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {currentStep.id === "apis" && (
              <section className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                    <PlugZap className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">External APIs</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Check that content and account services are ready.</p>
                  </div>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                  <div className="text-sm font-semibold">{apiSummary.ready}/{apiSummary.total} services ready</div>
                  <div className="mt-4 grid gap-2">
                    {(connections ?? []).map((connection) => (
                      <div key={connection.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
                        <span className="text-sm font-medium">{connection.label}</span>
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">{connection.status.replace("_", " ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {currentStep.id === "finish" && (
              <section className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Setup ready</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Kiza Launcher is ready.</p>
                  </div>
                </div>

                <div className="grid gap-3 rounded-lg border border-border/70 bg-secondary/10 p-4 text-sm">
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Microsoft</span><span>{account ? account.username : "Offline fallback"}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Runtime</span><span>{runtime?.valid ? `Java ${runtime.required_major}` : "Not installed"}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Performance</span><span>{selectedProfile}</span></div>
                </div>
              </section>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-6 py-4">
          <button
            onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
            disabled={stepIndex === 0}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-secondary/30 px-4 text-sm font-medium transition hover:bg-secondary disabled:opacity-45"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex gap-2">
            {currentStep.id !== "finish" && (
              <button
                onClick={() => markSkipped(currentStep.id)}
                className="h-10 rounded-md border border-border bg-secondary/20 px-4 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                Skip
              </button>
            )}
            {currentStep.id === "finish" ? (
              <button
                onClick={complete}
                disabled={completeSetup.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {completeSetup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Finish setup
              </button>
            ) : (
              <button
                onClick={() => setStepIndex((current) => Math.min(current + 1, steps.length - 1))}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
