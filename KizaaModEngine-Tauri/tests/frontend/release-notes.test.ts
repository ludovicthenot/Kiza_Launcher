import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compareVersions,
  notesFor,
  notesSince,
  versionsWithNotes,
} from "../../src/lib/releaseNotes";

/**
 * What the launcher tells somebody after it has changed under them.
 *
 * The failures here are quiet ones. A dialog that shows every release ever
 * written is an archive rather than an announcement; one that compares versions
 * as strings decides 0.0.9 is newer than 0.0.331; one that comes back after
 * being dismissed is worse than never having appeared.
 */
describe("release notes", () => {
  it("reads the files that already ship with a release", () => {
    const versions = versionsWithNotes();
    expect(versions.length).toBeGreaterThan(0);

    // Newest first, so the dialog reads downwards through time.
    for (let index = 1; index < versions.length; index += 1) {
      expect(compareVersions(versions[index - 1], versions[index])).toBeGreaterThan(0);
    }
  });

  /**
   * Numerically, part by part.
   *
   * A string comparison puts 0.0.9 after 0.0.331, which would show somebody
   * the notes for a version they had already read and hide the one they had
   * not — and it would do it silently, because both are plausible strings.
   */
  it("compares versions by number and not by spelling", () => {
    expect(compareVersions("0.0.331", "0.0.9")).toBeGreaterThan(0);
    expect(compareVersions("0.0.9", "0.0.331")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.0.999")).toBeGreaterThan(0);
    expect(compareVersions("0.0.331", "0.0.331")).toBe(0);
  });

  it("splits a release into the headings it was written with", () => {
    const written = versionsWithNotes().find((version) => {
      const source = readFileSync(`release-notes/${version}.md`, "utf8");
      return source.includes("## ");
    });
    expect(written, "at least one release should have sections").toBeDefined();

    const notes = notesFor(written!)!;
    expect(notes.version).toBe(written);
    expect(notes.sections.length).toBeGreaterThan(0);
    for (const section of notes.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      // A heading with nothing under it is not a category, and rendering one
      // would put an empty box on screen.
      expect(section.entries.length).toBeGreaterThan(0);
      expect(section.title.startsWith("#")).toBe(false);
    }
  });

  it("answers what changed since a given version, newest first", () => {
    const versions = versionsWithNotes();
    const newest = versions[0];
    const third = versions[2];

    const since = notesSince(third, newest);
    expect(since.map((notes) => notes.version)).toEqual([newest, versions[1]]);
    // Never the version already acknowledged: somebody read that one.
    expect(since.map((notes) => notes.version)).not.toContain(third);
  });

  it("says nothing when the launcher has not moved", () => {
    const newest = versionsWithNotes()[0];
    expect(notesSince(newest, newest)).toEqual([]);
  });

  /**
   * A version ahead of every written note has nothing to announce, and must not
   * fall back to the last one it can find: that would announce an old release
   * as though it were the new one.
   */
  it("says nothing for a release that shipped no notes", () => {
    expect(notesSince("0.0.320", "9.9.9")).not.toContainEqual(
      expect.objectContaining({ version: "9.9.9" }),
    );
    expect(notesFor("9.9.9")).toBeNull();
  });

  /**
   * The rule that keeps a first launch from becoming a history lesson.
   *
   * Nothing recorded means a fresh install or an update from before this
   * existed, and neither wants thirteen releases at once. The component records
   * where it is and shows nothing; this is the check that it still does.
   */
  it("records a first run rather than announcing everything", () => {
    const dialog = readFileSync("src/components/common/ReleaseNotesDialog.tsx", "utf8");
    expect(dialog).toContain("seen === null");
    expect(dialog).toContain("recordedFirstRun");
    // And the acknowledgement is a preference, not browser storage: a cleared
    // cache should not re-announce an update from three weeks ago.
    expect(dialog).toContain("last_seen_release_notes");
    expect(dialog).not.toContain("localStorage");
  });
});
