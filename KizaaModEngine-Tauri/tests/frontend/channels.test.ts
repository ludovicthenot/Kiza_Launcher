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
  });

  it("knows the same four channels as the service", () => {
    const everywhere = new Set(Object.values(CHANNELS_BY_EDITION).flat());
    expect([...everywhere].sort()).toEqual([...CHANNELS].sort());
  });

  /**
   * The point of the whole exercise: exactly one channel is public, and the
   * three that are not are each closed by something a client cannot fake.
   */
  it("leaves one channel open and closes the rest", () => {
    const open = CHANNELS.filter((channel) => !isGated(channel));
    expect(open).toEqual(["stable"]);
    for (const channel of ["beta", "experimental"]) {
      expect(DISCORD_CHANNELS.has(channel), channel).toBe(true);
    }
    expect(KEY_CHANNELS.has("maker")).toBe(true);
    expect(DISCORD_CHANNELS.has("maker")).toBe(false);
  });
});
