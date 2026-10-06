import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { Bug, ChevronDown, Palette, Plus, Sparkles, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/primitives";
import { useAppConfig, useSaveAppConfig } from "../../lib/queries";
import { digest, digestSize, notesSince, type DigestEntry, type DigestSection } from "../../lib/releaseNotes";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

/**
 * What changed, shown once after an update.
 *
 * Kiza updates itself and restarts, and until now the only sign was a version
 * number that had gone up. A launcher that changes under somebody without
 * saying what it changed is asking them to notice on their own.
 *
 * <p>Once is the whole design. It appears when the running version is newer
 * than the one last acknowledged, and dismissing it records the version — so it
 * does not come back on the next launch, and does come back on the next update.
 * The acknowledgement is a line in the configuration rather than browser
 * storage: it is the same fact as every other preference, and it should survive
 * the same things they do.
 *
 * <p>Somebody who skipped three releases sees three. "What changed since I last
 * looked" is the question, and answering it with only the final increment would
 * hide most of the answer.
 */
/**
 * Whether this run has already written the first-run mark.
 *
 * Module scope rather than state: the write is asynchronous and the component
 * re-renders while it is in flight, so a flag inside it would fire the same
 * write several times over.
 */
let recordedFirstRun = false;

export function ReleaseNotesDialog() {
  const { t } = useI18n();
  const { data: config } = useAppConfig();
  const saveConfig = useSaveAppConfig();
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setVersion).catch(() => undefined);
  }, []);

  if (!version || !config || dismissed) return null;

  const seen = config.last_seen_release_notes?.trim() || null;

  // Nothing recorded means one of two things -- a fresh install, or an update
  // from a version that predates this dialog -- and neither wants the whole
  // history. Thirteen releases at once is not "what's new", it is an archive.
  // So the first run records where it is and shows nothing; from the next
  // update onwards there is a mark to measure from.
  if (seen === null) {
    if (!recordedFirstRun) {
      recordedFirstRun = true;
      saveConfig.mutate({ ...config, last_seen_release_notes: version });
    }
    return null;
  }

  const releases = notesSince(seen, version);
  if (releases.length === 0) return null;

  const close = () => {
    setDismissed(true);
    // Recorded even if the write fails: the dialog has been read, and showing
    // it again on the next launch would be worse than losing the record.
    saveConfig.mutate({ ...config, last_seen_release_notes: version });
  };

  // One list per heading across every release, rather than one changelog
  // after another: "what is new" is one question, however many releases
  // it took to answer it.
  const sections = digest(releases);
  const total = digestSize(sections);
  // Past a dozen changes the explanations are folded and the bold sentences
  // stand alone: a page of leads reads in ten seconds, a page of paragraphs
  // is closed unread. Each one opens on its own; "Read everything" opens all.
  const folded = total > 12 && !expanded;
  const newest = releases[0];
  const oldest = releases[releases.length - 1];

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
        {/* A soft violet light behind the header, like the app's own. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(70%_100%_at_50%_0%,hsl(var(--primary)/0.28),transparent)]" />

        <DialogHeader className="relative items-center space-y-0 px-8 pb-5 pt-9 text-center">
          <img
            src="/favicon.png"
            alt=""
            className="h-16 w-16 rounded-[18px] shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.12),0_14px_34px_-10px_hsl(var(--primary)/0.6)] animate-in zoom-in-75 fade-in-0 duration-500 ease-spring motion-reduce:animate-none"
          />
          <DialogTitle className="mt-4 text-center text-2xl font-bold tracking-tight">
            {releases.length === 1
              ? t("What's new in {version}").replace("{version}", newest.version)
              : t("What's new since you last looked")}
          </DialogTitle>
          <DialogDescription className="mt-1.5 max-w-sm text-center text-[0.8438rem] leading-relaxed">
            {newest.summary ?? t("Kiza has been updated.")}
          </DialogDescription>
          {releases.length > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{oldest.version} → {newest.version}</span> · {total} {t("changes")}
            </p>
          )}
        </DialogHeader>

        <div className="relative max-h-[52vh] space-y-6 overflow-y-auto px-8 pb-2 [mask-image:linear-gradient(to_bottom,black_calc(100%-16px),transparent)]">
          {sections.map((section, index) => (
            <Category
              key={section.title}
              section={section}
              folded={folded}
              showVersion={releases.length > 1}
              delay={index * 80}
            />
          ))}
        </div>

        <div className="relative space-y-2 px-8 pb-7 pt-4">
          <Button variant="primary" className="h-11 w-full text-[0.9375rem]" onClick={close}>
            {t("Continue")}
          </Button>
          {total > 12 && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="mx-auto flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-180")} />
              {expanded ? t("Just the headlines") : t("Read everything")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One heading and its entries.
 *
 * The mark comes from the heading the notes already use — New, Fixed, Changed —
 * rather than from a category somebody has to remember to tag. A heading this
 * does not recognise still renders, with the neutral mark: an unknown section
 * is a section somebody wrote on purpose, and dropping it to keep the icons
 * tidy would be losing the content to protect the decoration.
 */
function Category({
  section,
  folded,
  showVersion,
  delay,
}: {
  section: DigestSection;
  folded: boolean;
  showVersion: boolean;
  delay: number;
}) {
  const key = section.title.toLowerCase();
  const style = key.startsWith("new")
    ? { icon: Plus, tone: "bg-emerald-500/20 text-emerald-300" }
    : key.startsWith("fix")
      ? { icon: Bug, tone: "bg-amber-500/20 text-amber-300" }
      : key.startsWith("chang")
        ? { icon: Wrench, tone: "bg-sky-500/20 text-sky-300" }
        : key.startsWith("look") || key.startsWith("design")
          ? { icon: Palette, tone: "bg-primary/20 text-primary" }
          : { icon: Sparkles, tone: "bg-secondary/80 text-muted-foreground" };

  return (
    <section
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 [animation-fill-mode:both] motion-reduce:animate-none"
      style={{ animationDelay: `${150 + delay}ms` }}
    >
      <h3 className="mb-3 text-[0.75rem] font-semibold text-muted-foreground">
        {section.title}
        <span className="font-normal text-muted-foreground/60"> · {section.entries.length}</span>
      </h3>
      <ul className="space-y-4">
        {section.entries.map((entry, index) => (
          <Entry key={index} entry={entry} folded={folded} showVersion={showVersion} icon={style.icon} tone={style.tone} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One change: the bold sentence, the version it came in, and the
 * explanation — shown, or a click away when the list is long.
 */
function Entry({
  entry,
  folded,
  showVersion,
  icon: Icon,
  tone,
}: {
  entry: DigestEntry;
  folded: boolean;
  showVersion: boolean;
  icon: typeof Plus;
  tone: string;
}) {
  const [open, setOpen] = useState(false);
  const showBody = !folded || open;
  const canFold = folded && entry.lead && entry.body;
  return (
    <li className="flex gap-3.5">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 text-[0.8438rem] leading-snug">
        <div className="flex items-baseline gap-2">
          {canFold ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="min-w-0 text-left font-semibold text-foreground transition-colors hover:text-primary"
            >
              {entry.lead}
            </button>
          ) : (
            entry.lead && <span className="font-semibold text-foreground">{entry.lead}</span>
          )}
          {showVersion && (
            <span className="shrink-0 rounded-full bg-secondary/70 px-1.5 text-[0.625rem] tabular-nums text-muted-foreground">
              {entry.version}
            </span>
          )}
        </div>
        {showBody && entry.body && (
          <p className={cn("text-muted-foreground", entry.lead && "mt-0.5")}>
            <Inline text={entry.body} />
          </p>
        )}
        {!entry.lead && !showBody && (
          <span className="text-muted-foreground">
            <Inline text={entry.body} />
          </span>
        )}
      </div>
    </li>
  );
}

/** Backticks become code; the only markup these notes use inside a line. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={index} className="rounded bg-secondary/50 px-1 text-[0.9em] text-foreground/90">{part.slice(1, -1)}</code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
