import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { doorShut, isGatedChannel, mayFollow, type AccessStatus } from "../../src/lib/access";

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
 * never meets it, that a stale claim does not count as a claim, and that
 * nothing outside the door offers a way past it.
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
    expect(doorShut(null, "stable")).toBe(false);
  });

  it("stands in front of every invited one", () => {
    for (const channel of ["alpha", "beta", "experimental"]) {
      expect(isGatedChannel(channel), channel).toBe(true);
      expect(doorShut(granted([]), channel), channel).toBe(true);
      expect(doorShut(granted(["stable"]), channel), channel).toBe(true);
      expect(doorShut(granted([channel]), channel), channel).toBe(false);
    }
  });

  /**
   * The gate reads the same status the settings page does, and treats a pass
   * that has run out as no pass. Otherwise somebody would be let in to a
   * launcher that cannot fetch anything — the door open, the shop shut.
   */
  it("counts an expired pass as no pass", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(doorShut(granted(["alpha"], yesterday), "alpha")).toBe(true);
    expect(doorShut(granted(["alpha"], nextWeek), "alpha")).toBe(false);
  });

  /**
   * Three answers, not two. Anything that reveals part of the launcher has to
   * treat not-knowing as shut, or a slow read is a window to click through.
   */
  it("says it does not know rather than guessing", () => {
    expect(doorShut(null, null)).toBe(null);
    expect(doorShut(granted(["alpha"]), null)).toBe(null);
    expect(doorShut(null, "alpha")).toBe(null);
  });

  it("shows nothing at all until it knows", () => {
    const gate = readFileSync("src/components/access/AccessGate.tsx", "utf8");
    // A launcher that rendered its library for one frame and then covered it
    // would have shown its library.
    expect(gate).toContain("if (shut === null) return null");
  });

  it("is the only thing between the window and the launcher", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("<AccessGate>");
    // Inside the frame, not over it: somebody who cannot get in must still be
    // able to close the window.
    expect(app.indexOf("<TitleBar />")).toBeLessThan(app.indexOf("<AccessGate>"));
  });

  /**
   * The one that was actually wrong.
   *
   * The title bar sits outside the gate so the window stays closable — and it
   * carried a settings button, an account menu and an update pill. The view
   * behind them was never mounted, so nothing opened; but a door with a
   * settings button beside it is not a door, it is a suggestion.
   */
  it("leaves nothing but the window controls beside it", () => {
    const bar = readFileSync("src/components/layout/TitleBar.tsx", "utf8");
    expect(bar).toContain("doorShut(");
    // Not knowing counts as shut.
    expect(bar).toContain("!== false");

    const barred = bar.slice(bar.indexOf("{!barred && ("), bar.indexOf("</>"));
    expect(barred).toContain("<AccountMenu />");
    expect(barred).toContain('title={t("Settings")}');
    expect(bar).toContain("{updateVisible && !barred && (");

    // And the three that must survive it, so the window can still be moved,
    // hidden and closed.
    for (const control of ["appWindow.minimize()", "appWindow.toggleMaximize()", "appWindow.close()"]) {
      expect(bar.slice(bar.indexOf("</>")), control).toContain(control);
    }
  });
});
