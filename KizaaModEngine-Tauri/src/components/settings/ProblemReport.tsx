import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Send, Ticket } from "lucide-react";
import { toast } from "sonner";
import {
  TicketDraft,
  useSupportCooldown,
  useSupportPreview,
  useSupportSubmit,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { cn } from "../../lib/utils";
import { ActionButton, Row, Section } from "./controls";

/**
 * A problem report, sent from inside the launcher.
 *
 * The alternative was what the page offered before: write a file, find it,
 * open Discord, describe the problem again from memory and attach it. Most
 * people stop at step two, which is why most problems are never reported.
 *
 * Two things this deliberately does. It shows exactly what will be sent before
 * anything is sent — someone handing over a description of their machine is
 * entitled to read it back first, including what the redaction did to it. And
 * it never touches the address it sends to: that lives in Kiza's service, not
 * in the binary, because a webhook URL compiled into a downloadable .exe can be
 * read straight back out of it.
 */

const CATEGORIES = [
  { value: "crash", label: "The game crashes" },
  { value: "launch", label: "The game will not start" },
  { value: "mods", label: "A mod or a pack" },
  { value: "download", label: "A download or an update" },
  { value: "account", label: "Signing in" },
  { value: "interface", label: "The launcher itself" },
  { value: "other", label: "Something else" },
];

const MAX_SUMMARY = 160;
const MAX_DETAILS = 4000;

export function ProblemReport() {
  const { t } = useI18n();
  const { data: cooldown = 0, refetch: refetchCooldown } = useSupportCooldown();
  const preview = useSupportPreview();
  const submit = useSupportSubmit();

  const [open, setOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [draft, setDraft] = useState<TicketDraft>({
    category: "crash",
    summary: "",
    details: "",
    include_diagnostic: true,
  });

  // Counted down here rather than refetched every second: the value came from
  // Rust once and a subtraction is cheaper than an invoke sixty times a minute.
  const [left, setLeft] = useState(cooldown);
  useEffect(() => setLeft(cooldown), [cooldown]);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [left]);

  const ready = draft.summary.trim().length > 0 && left <= 0;

  const send = () => {
    submit.mutate(draft, {
      onSuccess: (result) => {
        setSent(result.reference);
        setDraft({ category: "crash", summary: "", details: "", include_diagnostic: true });
        setShowPreview(false);
        void refetchCooldown();
        toast.success(t("Report sent."), { description: result.reference });
      },
    });
  };

  if (sent) {
    return (
      <Section icon={Ticket} title={t("Report a problem")}>
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-emerald-400" />
              {t("Sent. Your reference is {reference}.").replace("{reference}", sent)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Quote it if you follow up on Discord — it is how your report is found again.")}
            </p>
          </div>
          <ActionButton onClick={() => setSent(null)}>{t("Report something else")}</ActionButton>
        </div>
      </Section>
    );
  }

  return (
    <Section
      icon={Ticket}
      title={t("Report a problem")}
      hint={t("Sent straight to the Kiza support channel. Nothing is sent until you press Send, and you can read it first.")}
    >
      {!open ? (
        <Row
          label={t("Tell us what went wrong")}
          hint={t("A few lines is enough. The diagnostic report can travel with it.")}
        >
          <ActionButton onClick={() => setOpen(true)} icon={Ticket}>
            {t("Write a report")}
          </ActionButton>
        </Row>
      ) : (
        <div className="space-y-3 py-3">
          <Row label={t("What is it about?")}>
            <div className="w-72">
              <LauncherOptionPicker
                ariaLabel={t("What is it about?")}
                options={CATEGORIES.map((entry) => ({
                  value: entry.value,
                  label: t(entry.label),
                }))}
                value={draft.category}
                onValueChange={(value) => setDraft({ ...draft, category: value })}
                placeholder={t("The game crashes")}
              />
            </div>
          </Row>

          <div>
            <label className="mb-1 block text-sm" htmlFor="report-summary">
              {t("In one line")}
            </label>
            <input
              id="report-summary"
              value={draft.summary}
              maxLength={MAX_SUMMARY}
              placeholder={t("Crashes as soon as I press Play on 1.20.4")}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
              className="w-full rounded-lg border border-border bg-secondary/25 px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
              {draft.summary.length} / {MAX_SUMMARY}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm" htmlFor="report-details">
              {t("Anything else that helps")}
            </label>
            <textarea
              id="report-details"
              value={draft.details}
              maxLength={MAX_DETAILS}
              rows={5}
              placeholder={t("What you were doing, what you expected, and what happened instead.")}
              onChange={(event) => setDraft({ ...draft, details: event.target.value })}
              className="w-full resize-y rounded-lg border border-border bg-secondary/25 px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
              {draft.details.length} / {MAX_DETAILS}
            </div>
          </div>

          <Row
            label={t("Attach the diagnostic report")}
            hint={t("Version, system, storage, which services answered, and the end of the last log. No account, no e-mail, no token.")}
          >
            <input
              type="checkbox"
              checked={draft.include_diagnostic}
              aria-label={t("Attach the diagnostic report")}
              onChange={(event) =>
                setDraft({ ...draft, include_diagnostic: event.target.checked })
              }
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
          </Row>

          {/* Read before sending, not after. The redaction rewrites e-mail
              addresses and tokens out of the free text, and someone should see
              what that did to their own words before they leave the machine. */}
          <div className="rounded-lg border border-border/60 bg-secondary/10 p-3">
            <button
              type="button"
              onClick={() => {
                if (!showPreview) preview.mutate(draft);
                setShowPreview(!showPreview);
              }}
              className="flex w-full items-center justify-between gap-2 text-sm"
            >
              <span className="flex items-center gap-2">
                {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showPreview ? t("Hide what will be sent") : t("Show exactly what will be sent")}
              </span>
              {preview.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            </button>

            {showPreview && preview.data && (
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-3 text-[11px] leading-4 text-muted-foreground">
                {[
                  `${t("About")}: ${preview.data.category}`,
                  `${t("Summary")}: ${preview.data.summary}`,
                  preview.data.details ? `${t("Details")}: ${preview.data.details}` : null,
                  `${t("Version")}: ${preview.data.version} (${preview.data.channel})`,
                  `${t("Installation")}: ${preview.data.installId || "—"}`,
                  "",
                  preview.data.diagnostic
                    ? preview.data.diagnostic
                    : t("(no diagnostic report attached)"),
                ]
                  .filter((line) => line !== null)
                  .join("\n")}
              </pre>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {left > 0
                ? t("Another report can be sent in {seconds} s.").replace(
                    "{seconds}",
                    String(left),
                  )
                : t("Your Discord name is not sent. Nothing here identifies you.")}
            </p>
            <div className="flex gap-2">
              <ActionButton onClick={() => setOpen(false)}>{t("Cancel")}</ActionButton>
              <button
                type="button"
                onClick={send}
                disabled={!ready || submit.isPending}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
                  ready && !submit.isPending
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "cursor-not-allowed bg-secondary/40 text-muted-foreground",
                )}
              >
                {submit.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {t("Send")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
