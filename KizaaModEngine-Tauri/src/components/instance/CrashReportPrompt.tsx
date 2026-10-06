import { useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { useAppConfig, useCrashReportPreview, useCrashReportSend } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";

/**
 * "Send this crash to Kiza?" -- asked once per crash, answered in one click.
 *
 * <p>Shown only while the setting is "ask". "Always" sends on its own from
 * the watcher and this stays quiet; "never" never shows it. What would be
 * sent can be unfolded and read first, because a person handing over a
 * description of their machine is entitled to see it.
 */
export function CrashReportPrompt({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data: config } = useAppConfig();
  const consent = config?.crash_reports ?? "ask";
  const { data: preview } = useCrashReportPreview(instanceId, consent === "ask");
  const send = useCrashReportSend();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (consent !== "ask" || !preview) return null;

  if (done) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-400" />
        {done}
      </p>
    );
  }

  const sendWith = (remember?: "always" | "never") =>
    send.mutate(
      { instanceId, remember },
      {
        onSuccess: (sent) =>
          setDone(
            remember === "never"
              ? t("Crash reports are off. You can turn them on in Settings.")
              : sent
                ? t("Sent as {reference}. Thank you.").replace("{reference}", sent.reference)
                : t("Sent."),
          ),
      },
    );

  return (
    <div className="mt-3 rounded-md border border-border/60 bg-background/60 p-3">
      <div className="text-sm font-medium">
        {preview.already_sent ? t("This crash was already reported today.") : t("Send this crash to Kiza?")}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("What the doctor found, what the launch was and the end of the log. Never your account or anything you typed.")}{" "}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setOpen((v) => !v)}>
          {open ? t("Hide what would be sent") : t("See what would be sent")}
        </button>
      </p>
      {open && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/50 bg-background/80 p-2 font-mono text-[0.625rem] leading-relaxed text-muted-foreground">
          {preview.draft.summary}
          {"\n\n"}
          {preview.draft.details}
        </pre>
      )}
      {!preview.already_sent && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => sendWith()}
            disabled={send.isPending}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-2.5 text-xs font-medium text-primary transition hover:bg-primary/25 active:scale-[0.96] disabled:opacity-50"
          >
            {send.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {t("Send")}
          </button>
          <button
            onClick={() => sendWith("always")}
            disabled={send.isPending}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 text-xs font-medium transition hover:bg-secondary active:scale-[0.96] disabled:opacity-50"
          >
            {t("Always send")}
          </button>
          <button
            onClick={() => sendWith("never")}
            disabled={send.isPending}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/40 hover:text-foreground active:scale-[0.96] disabled:opacity-50"
          >
            {t("Never")}
          </button>
        </div>
      )}
    </div>
  );
}
