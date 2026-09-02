import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isGatedChannel, mayFollow, type AccessStatus } from "../../src/lib/access";

/**
 * The door in front of a test build.
 *
 * What it is worth is worth stating: it runs on the tester's computer, so
 * somebody determined can take it apart. It is a door, not a vault. The vault
 * is the service, which hands out no build to a launcher with no claim on it —
 * so a forced door opens onto a copy of what that person already had, never
 * the next one.
 *
 * What these hold is the part that would be quietly wrong: that a public build
 * never meets it, and that a stale claim does not count as a claim.
 */
describe("who meets the door", () => {
  const granted = (channels: string[], expires: string | null = null): AccessStatus => ({
    connected: true,
    channels,
    expires,
    account: "1847",
    has_setup_key: false,
  });

  it("never stands in front of a public build", () => {
    expect(isGatedChannel("stable")).toBe(false);
    // Nobody signed in, no pass at all, and Stable still opens: putting a door
    // in front of the released launcher would be putting a door in front of
    // Kiza.
    expect(mayFollow(null, "stable")).toBe(true);
  });

  it("stands in front of every invited one", () => {
    for (const channel of ["alpha", "beta", "experimental"]) {
      expect(isGatedChannel(channel), channel).toBe(true);
      expect(mayFollow(null, channel), channel).toBe(false);
      expect(mayFollow(granted([]), channel), channel).toBe(false);
      expect(mayFollow(granted(["stable"]), channel), channel).toBe(false);
      expect(mayFollow(granted([channel]), channel), channel).toBe(true);
    }
  });

  /**
   * The gate reads the same status the settings page does, and treats a pass
   * that has run out as no pass. Otherwise somebody would be let in to a
   * launcher that cannot fetch anything — the door open, the shop shut.
   */
  it("counts an expired pass as no pass", () => {
    const gate = readFileSync("src/components/access/AccessGate.tsx", "utf8");
    expect(gate).toContain("status.expires");
    expect(gate).toContain("<= Date.now()");
  });

  it("shows nothing at all until it knows", () => {
    const gate = readFileSync("src/components/access/AccessGate.tsx", "utf8");
    // A launcher that rendered its library for one frame and then covered it
    // would have shown its library.
    expect(gate).toContain("return null");
  });

  it("is the only thing between the window and the launcher", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("<AccessGate>");
    // Inside the frame, not over it: somebody who cannot get in must still be
    // able to close the window.
    expect(app.indexOf("<TitleBar />")).toBeLessThan(app.indexOf("<AccessGate>"));
  });
});
