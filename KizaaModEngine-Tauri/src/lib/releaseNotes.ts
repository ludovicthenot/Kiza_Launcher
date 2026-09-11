/**
 * The release notes, read out of the files that already ship them.
 *
 * `release-notes/<version>.md` is what goes out with every release — it is
 * written for somebody deciding whether to install, and it is the same text the
 * update manifest quotes. Bundling those files rather than fetching them means
 * the notes are there the moment the launcher opens, on a machine that has just
 * updated and may not be online, and that they cannot disagree with the build
 * they shipped in.
 *
 * Sixty kilobytes of markdown for every version Kiza has had. That is smaller
 * than one of the icons.
 */

const FILES = import.meta.glob("../../release-notes/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * One item under a heading, split where the notes already split it.
 *
 * The notes are written with a bold sentence naming the thing, then the
 * explanation: "**A refused update says why.** A launcher following a channel
 * it has no key for..." That shape is what makes them scannable on the page,
 * and it was being thrown away -- the dialog printed the asterisks and ran the
 * two together, so every item read as one grey wall and the markup showed.
 */
export interface NotesEntry {
  /** The bold sentence, without its asterisks. Null when there is none. */
  lead: string | null;
  /** Everything after it, or the whole line when there is no lead. */
  body: string;
}

/** One `## Heading` and the prose under it. */
export interface NotesSection {
  /** "New", "Fixed", "Changed"… as written in the file. */
  title: string;
  /** Bullet lines, in order. A paragraph with no bullet becomes one entry. */
  entries: NotesEntry[];
}

/**
 * Splits "**Name.** Explanation" into its two halves.
 *
 * Deliberately only the leading bold run. Bold in the middle of a sentence is
 * emphasis and stays as written; bold at the start is a title, and that is the
 * only one this needs to know about.
 */
export function splitEntry(text: string): NotesEntry {
  const match = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(text.trim());
  if (!match) return { lead: null, body: text.trim() };
  const [, lead, body] = match;
  return { lead: lead.trim(), body: body.trim() };
}

export interface ReleaseNotes {
  version: string;
  /** The line under the title: what this release is about, in one breath. */
  summary: string | null;
  sections: NotesSection[];
}

const byVersion = new Map<string, string>();
for (const [path, text] of Object.entries(FILES)) {
  const version = path.replace(/^.*\/(.+)\.md$/, "$1");
  byVersion.set(version, text);
}

/** Every version that shipped written notes, newest first. */
export function versionsWithNotes(): string[] {
  return [...byVersion.keys()].sort(compareVersions).reverse();
}

export function notesFor(version: string): ReleaseNotes | null {
  const text = byVersion.get(version.trim());
  if (!text) return null;
  return parse(version.trim(), text);
}

/**
 * The notes for everything between the version somebody last acknowledged and
 * the one they are running, newest first.
 *
 * Somebody who skipped three releases should see three, not only the last:
 * "what changed since I last looked" is the question being asked, and answering
 * it with the final increment would hide most of the answer.
 */
export function notesSince(seen: string | null, current: string): ReleaseNotes[] {
  return versionsWithNotes()
    .filter((version) => {
      if (compareVersions(version, current) > 0) return false;
      return seen === null || compareVersions(version, seen) > 0;
    })
    .map((version) => notesFor(version))
    .filter((notes): notes is ReleaseNotes => notes !== null);
}

/**
 * Splits the markdown into its headings.
 *
 * Deliberately not a markdown renderer. These files are written to one shape —
 * a title, a paragraph, then `##` sections of bullets and prose — and a
 * hundred-kilobyte parser to read a shape we control would be a dependency
 * bought for nothing. Bold and inline code survive as text; nothing else in
 * these files needs to.
 */
function parse(version: string, text: string): ReleaseNotes {
  const lines = text.split("\n");
  const sections: NotesSection[] = [];
  let summary: string[] = [];
  let current: NotesSection | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join(" ").trim();
    paragraph = [];
    if (!joined) return;
    if (current) current.entries.push(splitEntry(joined));
    else summary.push(joined);
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("## ")) {
      flushParagraph();
      current = { title: line.slice(3).trim(), entries: [] };
      sections.push(current);
      continue;
    }
    // The file's own first line is the version, which the dialog already shows.
    if (line.startsWith("# ") || line === `Kiza Launcher ${version}`) continue;

    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      const entry = line.slice(2).trim();
      if (entry) {
        if (current) current.entries.push(splitEntry(entry));
        else summary.push(entry);
      }
      continue;
    }

    if (line === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  return {
    version,
    summary: summary.length > 0 ? summary.join(" ") : null,
    // A heading somebody left empty is not a category.
    sections: sections.filter((section) => section.entries.length > 0),
  };
}

/** Compares `0.0.331` style versions numerically, part by part. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const one = Number.isFinite(a[index]) ? a[index] : 0;
    const other = Number.isFinite(b[index]) ? b[index] : 0;
    if (one !== other) return one - other;
  }
  return 0;
}
