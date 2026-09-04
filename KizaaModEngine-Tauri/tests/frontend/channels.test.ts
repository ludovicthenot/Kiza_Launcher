import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHANNELS_BY_EDITION, channelsFor, defaultChannel } from "../../scripts/channels.mjs";
import { CHANNELS, DISCORD_CHANNELS, isGated, KEY_CHANNELS } from "../../cloudflare/src/access.js";

/**
 * Three places decide what a channel is, and they must agree.
 *
 * The launcher refuses to follow a channel its edition may not have; the
 * publish script refuses to put a build somewhere its edition may not go; the
 * update service refuses to hand one over to somebody with no claim on it.
 * Any two of those agreeing while the third does not is how a Maker build ends
 * up in front of everybody who ever downloaded Kiza — so the lists are
 * compared here rather than kept in step by memory.
 */
describe("what each edition may publish", () => {
  it("matches the table the launcher itself uses", () => {
    const rust = readFileSync("src-tauri/src/edition.rs", "utf8");

    // `Edition::channels()` in Rust, read as text: a test that imported it
    // would need the crate built, and this catches the thing that actually
    // goes wrong — somebody editing one file and not the other.
    const table = rust.slice(rust.indexOf("pub fn channels("), rust.indexOf("/// Whether this edition may follow"));
    for (const [edition, channels] of Object.entries(CHANNELS_BY_EDITION)) {
      const arm = table.slice(table.indexOf(`Self::${edition[0].toUpperCase()}${edition.slice(1)} =>`));
      const listed = arm.slice(0, arm.indexOf("\n")).match(/"[a-z]+"/g) ?? [];
      expect(listed.map((name) => name.replace(/"/g, "")), `${edition} in edition.rs`).toEqual(
        channels,
      );
    }
  });

  it("sends each edition to its own stream by default", () => {
    expect(defaultChannel("stable")).toBe("stable");
    expect(defaultChannel("maker")).toBe("maker");
    expect(defaultChannel("experimental")).toBe("experimental");
  });

  it("never lets a Maker or Experimental build reach everybody", () => {
    expect(channelsFor("maker")).not.toContain("stable");
    expect(channelsFor("experimental")).not.toContain("stable");
    expect(channelsFor("experimental")).not.toContain("beta");
    // The one that matters now: alpha is a stream of the launcher itself, so a
    // build carrying another identity must not be publishable into it.
    expect(channelsFor("experimental")).not.toContain("alpha");
    expect(channelsFor("maker")).not.toContain("alpha");
  });

  /** And an ordinary install can be let in without changing application. */
  it("lets the launcher itself follow the alpha", () => {
    expect(channelsFor("stable")).toContain("alpha");
  });

  it("knows the same channels as the service", () => {
    const everywhere = new Set(Object.values(CHANNELS_BY_EDITION).flat());
    expect([...everywhere].sort()).toEqual([...CHANNELS].sort());
  });

  /**
   * The point of the whole exercise: nothing is served to somebody who cannot
   * show a claim on it — and until the release, that includes Stable.
   */
  it("closes every channel while there is nothing to release", () => {
    const open = CHANNELS.filter((channel) => !isGated(channel));
    expect(open).toEqual([]);
    for (const channel of ["beta", "alpha", "experimental"]) {
      expect(DISCORD_CHANNELS.has(channel), channel).toBe(true);
    }
    expect(KEY_CHANNELS.has("maker")).toBe(true);
    expect(DISCORD_CHANNELS.has("maker")).toBe(false);
  });

  /**
   * Closed and ungrantable are two different rules, and conflating them cost a
   * real person a real fix: Stable was in neither set, so a build published
   * there reached nobody — not even the people who had been handed the launcher
   * by hand, who had no way to be told why their updater kept failing.
   *
   * Stable is now reached the way a private build is reached: somebody hands
   * you the installer that carries its key. Nothing inside the launcher leads
   * there, which is what makes it different from the test channels.
   */
  it("keeps Stable shut to everybody and open to whoever was handed it", () => {
    expect(isGated("stable"), "nobody walks into Stable").toBe(true);
    expect(
      DISCORD_CHANNELS.has("stable"),
      "and no sign-in leads there, however somebody signs in",
    ).toBe(false);
    expect(KEY_CHANNELS.has("stable"), "but the installer that carries its key does").toBe(true);
  });
});
