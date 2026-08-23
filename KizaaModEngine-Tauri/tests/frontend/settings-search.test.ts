import { describe, expect, it } from "vitest";
import { matchTabs } from "../../src/components/views/SettingsView";

/** The launcher's own French dictionary, reduced to the labels search uses. */
const FRENCH: Record<string, string> = {
  General: "Général",
  Appearance: "Apparence",
  "Language and region": "Langue et région",
  "Minecraft and Java": "Minecraft et Java",
  Downloads: "Téléchargements",
  Storage: "Stockage",
  Accounts: "Comptes",
  Connections: "Connexions",
  Notifications: "Notifications",
  Advanced: "Avancé",
  About: "À propos",
};

const fr = (key: string) => FRENCH[key] ?? key;
const en = (key: string) => key;

describe("an empty search", () => {
  it("shows every page rather than none", () => {
    expect(matchTabs("", en)).toHaveLength(11);
    expect(matchTabs("   ", en)).toHaveLength(11);
  });
});

describe("finding a page by its name", () => {
  it("matches the English label", () => {
    expect(matchTabs("storage", en)).toEqual(["storage"]);
  });

  it("matches the label in the language on screen", () => {
    // Someone reading "Stockage" types "stockage", not "storage".
    expect(matchTabs("stockage", fr)).toEqual(["storage"]);
    expect(matchTabs("comptes", fr)).toEqual(["accounts"]);
  });

  it("ignores case", () => {
    expect(matchTabs("STOCKAGE", fr)).toEqual(["storage"]);
  });
});

describe("accents", () => {
  it("finds an accented label typed without accents", () => {
    // Nobody reaches for the accent key while searching.
    expect(matchTabs("telechargements", fr)).toEqual(["downloads"]);
    expect(matchTabs("avance", fr)).toEqual(["advanced"]);
    expect(matchTabs("general", fr)).toEqual(["system"]);
  });

  it("still finds it when the accents are typed", () => {
    expect(matchTabs("téléchargements", fr)).toEqual(["downloads"]);
  });
});

describe("finding a page by what it does", () => {
  it("matches words that are not on the tab itself", () => {
    // The page is called Appearance; the word someone has in mind is "theme".
    expect(matchTabs("theme", en)).toContain("customisation");
    expect(matchTabs("java", en)).toContain("minecraft");
    expect(matchTabs("microsoft", en)).toContain("accounts");
    expect(matchTabs("modrinth", en)).toContain("apis");
  });

  it("sends someone hunting for space to Storage", () => {
    expect(matchTabs("disk", en)).toEqual(["storage"]);
    expect(matchTabs("cache", en)).toEqual(["storage"]);
  });

  it("accepts both spellings of colour", () => {
    expect(matchTabs("color", en)).toEqual(["customisation"]);
    expect(matchTabs("colour", en)).toEqual(["customisation"]);
  });
});

describe("a word that belongs to more than one page", () => {
  it("returns all of them rather than guessing", () => {
    // "update" is a General setting and an About action; both are honest
    // answers, and picking one would be the search deciding for the reader.
    const found = matchTabs("update", en);
    expect(found).toContain("system");
    expect(found).toContain("about");
  });
});

describe("a search that finds nothing", () => {
  it("returns an empty list rather than everything", () => {
    // Falling back to the whole list would look like the search was ignored.
    expect(matchTabs("zzzzz", en)).toEqual([]);
  });
});

describe("order", () => {
  it("keeps the sidebar's own order so results do not jump around", () => {
    expect(matchTabs("", en).slice(0, 3)).toEqual(["system", "customisation", "language"]);
  });
});
