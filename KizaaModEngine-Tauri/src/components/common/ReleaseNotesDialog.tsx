import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { Bug, Check, ChevronDown, Palette, Plus, Sparkles, Wrench } from "lucide-react";
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-8">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-left">
                {releases.length === 1
                  ? t("What's new in {version}").replace("{version}", newest.version)
                  : t("What's new since you last looked")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-left">
                {newest.summary ?? t("Kiza has been updated.")}
              </DialogDescription>
              {releases.length > 1 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("{count} releases arrived while you were away.").replace("{count}", String(releases.length))}{" "}
                  <span className="tabular-nums">{oldest.version} → {newest.version}</span> · {total} {t("changes")}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[58vh] space-y-5 overflow-y-auto pr-2">
          {sections.map((section) => (
            <Category
              key={section.title}
              section={section}
              folded={folded}
              showVersion={releases.length > 1}
            />
          ))}
        </div>

        <div className="flex items-center gap-3 self-end">
          {total > 12 && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
              {expanded ? t("Just the headlines") : t("Read everything")}
            </button>
          )}
          <Button variant="primary" onClick={close}>
            <Check className="h-4 w-4" />
            {t("Got it")}
          </Button>
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
}: {
  section: DigestSection;
  folded: boolean;
  showVersion: boolean;
}) {
  const key = section.title.toLowerCase();
  const style = key.startsWith("new")
    ? { icon: Plus, tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" }
    : key.startsWith("fix")
      ? { icon: Bug, tone: "border-amber-500/25 bg-amber-500/10 text-amber-300" }
      : key.startsWith("chang")
        ? { icon: Wrench, tone: "border-sky-500/25 bg-sky-500/10 text-sky-300" }
        : key.startsWith("look") || key.startsWith("design")
          ? { icon: Palette, tone: "border-primary/25 bg-primary/10 text-primary" }
          : { icon: Sparkles, tone: "border-border/60 bg-secondary/25 text-muted-foreground" };
  const Icon = style.icon;

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-md border", style.tone)}>
          <Icon className="h-3 w-3" />
        </span>
        {section.title}
        <span className="font-normal normal-case tracking-normal text-muted-foreground/60">· {section.entries.length}</span>
      </h3>
      <ul className="space-y-2 border-l border-border/40 pl-4">
        {section.entries.map((entry, index) => (
          <Entry key={index} entry={entry} folded={folded} showVersion={showVersion} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One change: the bold sentence, the version it came in, and the
 * explanation — shown, or a click away when the list is long.
 */
function Entry({ entry, folded, showVersion }: { entry: DigestEntry; folded: boolean; showVersion: boolean }) {
  const [open, setOpen] = useState(false);
  const showBody = !folded || open;
  const canFold = folded && entry.lead && entry.body;
  return (
    <li className="text-sm leading-snug">
      <div className="flex items-baseline gap-2">
        {canFold ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="min-w-0 text-left font-medium text-foreground hover:text-primary"
          >
            {entry.lead}
          </button>
        ) : (
          entry.lead && <span className="font-medium text-foreground">{entry.lead}</span>
        )}
        {showVersion && (
          <span className="shrink-0 rounded-full border border-border/60 px-1.5 text-[10px] tabular-nums text-muted-foreground/70">
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
