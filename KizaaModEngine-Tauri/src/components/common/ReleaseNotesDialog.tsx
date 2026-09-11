import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { Bug, Check, Palette, Plus, Sparkles, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/primitives";
import { useAppConfig, useSaveAppConfig } from "../../lib/queries";
import { notesSince, type NotesSection } from "../../lib/releaseNotes";
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

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-8">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-left">
                {releases.length === 1
                  ? t("What's new in {version}").replace("{version}", releases[0].version)
                  : t("What's new since you last looked")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-left">
                {releases.length === 1
                  ? (releases[0].summary ?? t("Kiza has been updated."))
                  : t("{count} releases arrived while you were away.").replace(
                      "{count}",
                      String(releases.length),
                    )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-2">
          {releases.map((release, index) => (
            <div key={release.version}>
              {/* The version is a heading only when there is more than one:
                  repeating it above a single release restates the title. */}
              {releases.length > 1 && (
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{release.version}</span>
                  {release.summary && index === 0 && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {release.summary}
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-4">
                {release.sections.map((section) => (
                  <Category key={section.title} section={section} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <Button variant="primary" onClick={close} className="self-end">
          <Check className="h-4 w-4" />
          {t("Got it")}
        </Button>
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
function Category({ section }: { section: NotesSection }) {
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

  // A list, not a stack of boxes. Each item is a bold sentence naming the
  // change and a quieter one explaining it -- which is how the notes are
  // written, and which the previous box-per-item layout buried: the box drew
  // the eye, the asterisks showed, and every item read as one grey wall.
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-md border",
            style.tone,
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        {section.title}
      </h3>
      <ul className="space-y-2.5 border-l border-border/40 pl-4">
        {section.entries.map((entry, index) => (
          <li key={index} className="text-sm leading-snug">
            {entry.lead && <span className="font-medium text-foreground">{entry.lead} </span>}
            <span className="text-muted-foreground">{entry.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
