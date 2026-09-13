import { describe, expect, it } from "vitest";
import { digest, digestSize, type ReleaseNotes } from "../../src/lib/releaseNotes";

const release = (version: string, sections: Array<[string, string[]]>): ReleaseNotes => ({
  version,
  summary: null,
  sections: sections.map(([title, leads]) => ({
    title,
    entries: leads.map((lead) => ({ lead, body: `${lead} explained.` })),
  })),
});

describe("several releases folded into one changelog", () => {
  it("merges the headings, keeps each change's version, newest first", () => {
    const merged = digest([
      release("0.0.336", [["New", ["Names"]], ["Changed", ["Reactivity"]]]),
      release("0.0.335", [["Fixed", ["Vanilla client"]], ["New", ["Servers"]]]),
    ]);
    expect(merged.map((s) => s.title)).toEqual(["New", "Fixed", "Changed"]);
    expect(merged[0].entries.map((e) => `${e.version} ${e.lead}`)).toEqual(["0.0.336 Names", "0.0.335 Servers"]);
    expect(digestSize(merged)).toBe(4);
  });

  it("puts a heading it does not know after the ones it does, and never drops it", () => {
    const merged = digest([release("0.0.1", [["Notes for testers", ["Try the port"]], ["New", ["X"]]])]);
    expect(merged.map((s) => s.title)).toEqual(["New", "Notes for testers"]);
  });

  it("treats 'New' and 'new' as the same heading", () => {
    const merged = digest([release("2", [["New", ["a"]]]), release("1", [["new", ["b"]]])]);
    expect(merged).toHaveLength(1);
    expect(merged[0].entries).toHaveLength(2);
  });
});

import { notesFor } from "../../src/lib/releaseNotes";

describe("a paragraph that continues an item", () => {
  it("is folded into it rather than counted as a change of its own", () => {
    const notes = notesFor("0.0.333");
    expect(notes).not.toBeNull();
    for (const section of notes!.sections) {
      for (const entry of section.entries) {
        expect(entry.lead, `${section.title}: ${entry.body.slice(0, 40)}`).not.toBeNull();
      }
    }
  });
});
