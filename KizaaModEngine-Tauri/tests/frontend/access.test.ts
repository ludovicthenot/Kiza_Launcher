import { describe, expect, it } from "vitest";
import {
  admitMachine,
  CHANNELS,
  cleanChannels,
  DISCORD_CHANNELS,
  grants,
  hashKey,
  isChannel,
  isDiscordId,
  isGated,
  KEY_CHANNELS,
  MAX_MACHINES,
  onItsMachine,
  mintPass,
  randomToken,
  readPass,
} from "../../cloudflare/src/access.js";

const SECRET = "a-secret-that-only-the-service-knows";

/**
 * Who may have which build.
 *
 * The launcher is on somebody else's computer: its settings are a text file
 * and its binary can be edited. So none of this is about what a launcher says
 * about itself — it is about what the service can check. These tests are the
 * refusals, because a door that opens for the right person is obvious the
 * first time anyone tries it and a door that also opens for everybody else is
 * not.
 */
describe("what a channel asks of you", () => {
  /**
   * Before the release, every door is shut — including the front one.
   *
   * Stable is the channel that will be open one day; until Kiza is announced
   * an address somebody stumbles on should hand out nothing. It is not
   * unreachable, though — it is reached the way a private build is reached, by
   * being handed the installer that carries its key. Putting `"stable"` back
   * into `OPEN_CHANNELS` is what opens it to everybody, and this test is the
   * reminder that it has to be done on purpose.
   */
  it("keeps every channel shut until there is a release", () => {
    for (const channel of ["stable", "beta", "alpha", "experimental", "maker"]) {
      expect(isGated(channel), channel).toBe(true);
    }
    // And no sign-in reaches the front door. Stable is opened by a key an
    // installer carries and by nothing else, so there is no flow inside the
    // launcher that leads to it however somebody signs in.
    expect(DISCORD_CHANNELS.has("stable")).toBe(false);
    expect(KEY_CHANNELS.has("stable")).toBe(true);
    // A channel nobody has heard of is not a channel.
    expect(isChannel("allpha")).toBe(false);
    expect(isGated("allpha")).toBe(false);
    expect(CHANNELS).toContain("maker");
  });

  it("keeps Discord and the Setup key to their own channels", () => {
    // The bot may put somebody on a test channel; it may not hand out the
    // edition with the tools in it, which is given with an installer.
    expect(DISCORD_CHANNELS.has("maker")).toBe(false);
    expect(KEY_CHANNELS.has("maker")).toBe(true);
    expect(cleanChannels(["maker", "alpha"], DISCORD_CHANNELS)).toEqual(["alpha"]);
  });

  it("drops a channel the bot misspelled rather than granting nothing quietly", () => {
    expect(cleanChannels(["Beta", " alpha "], DISCORD_CHANNELS)).toEqual(["alpha", "beta"]);
    expect(cleanChannels(["allpha"], DISCORD_CHANNELS)).toEqual([]);
    expect(cleanChannels("beta", DISCORD_CHANNELS)).toEqual(["beta"]);
  });

  it("believes a Discord id only when it looks like one", () => {
    expect(isDiscordId("184700731213480000")).toBe(true);
    for (const bad of ["", "me", "18470073121348000018470073121348000018", "12;drop", null]) {
      expect(isDiscordId(bad as string), String(bad)).toBe(false);
    }
  });
});

describe("the pass a launcher carries", () => {
  it("says who it is for and what it opens", async () => {
    const token = await mintPass(SECRET, {
      subject: "184700731213480000",
      channels: ["alpha", "beta"],
    });
    const read = await readPass(SECRET, token);
    expect(read.ok).toBe(true);
    expect(read.pass?.sub).toBe("184700731213480000");
    expect(read.pass?.ch).toEqual(["alpha", "beta"]);
    expect(grants(read.pass, "alpha")).toBe(true);
    expect(grants(read.pass, "maker")).toBe(false);
  });

  it("cannot be written by anybody else", async () => {
    const token = await mintPass(SECRET, { subject: "1847", channels: ["beta"] });
    const forged = await readPass("a-secret-somebody-guessed", token);
    expect(forged.ok).toBe(false);
    expect(forged.reason).toBe("signature");
  });

  /**
   * The interesting attack, and the reason the channels are inside the
   * signature rather than beside it.
   */
  it("cannot be edited into opening more", async () => {
    const token = await mintPass(SECRET, { subject: "1847", channels: ["beta"] });
    const [body, signature] = token.split(".");
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    payload.ch = ["beta", "alpha", "maker"];
    const rewritten = Buffer.from(JSON.stringify(payload))
      .toString("base64url")
      .replace(/=+$/, "");

    const tampered = await readPass(SECRET, `${rewritten}.${signature}`);
    expect(tampered.ok).toBe(false);
    expect(tampered.reason).toBe("signature");
  });

  it("stops working when it runs out", async () => {
    const token = await mintPass(SECRET, {
      subject: "1847",
      channels: ["beta"],
      seconds: 60,
      now: Date.UTC(2026, 0, 1),
    });
    const later = await readPass(SECRET, token, Date.UTC(2026, 0, 1) + 61_000);
    expect(later.ok).toBe(false);
    expect(later.reason).toBe("expired");

    const sooner = await readPass(SECRET, token, Date.UTC(2026, 0, 1) + 30_000);
    expect(sooner.ok).toBe(true);
  });

  it("refuses nonsense without throwing", async () => {
    for (const rubbish of ["", "not-a-pass", "a.b", "....", "x"]) {
      const read = await readPass(SECRET, rubbish);
      expect(read.ok, rubbish).toBe(false);
    }
  });
});

describe("the Setup key", () => {
  it("is stored as a hash, so the store cannot leak the keys", async () => {
    const key = randomToken();
    const hash = await hashKey(key);
    expect(hash).not.toContain(key);
    expect(await hashKey(key)).toBe(hash);
    expect(await hashKey(randomToken())).not.toBe(hash);
  });

  it("is long enough not to be guessed", () => {
    const key = randomToken(24);
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(randomToken()).not.toBe(randomToken());
  });
});

/**
 * Two machines, and the reason it is two.
 *
 * One would be wrong: a tester with a desktop and a laptop is the ordinary
 * case, and locking them to one turns somebody helping for free into a support
 * ticket. Three starts being somebody else's computer. So the rule counts
 * rather than forbids, and the third is refused with a sentence rather than a
 * shrug.
 */
describe("how many computers one account may have", () => {
  it("lets the same machine come back without counting twice", () => {
    const first = admitMachine([], "aaaa", 1000);
    expect(first.allowed).toBe(true);
    expect(first.machines).toHaveLength(1);

    const again = admitMachine(first.machines, "aaaa", 2000);
    expect(again.allowed).toBe(true);
    expect(again.machines).toHaveLength(1);
    // Seen again, not seen anew: the first sighting is what it always was.
    expect(again.machines[0].first).toBe(1000);
    expect(again.machines[0].last).toBe(2000);
  });

  it("allows a second computer and refuses a third", () => {
    const one = admitMachine([], "aaaa");
    const two = admitMachine(one.machines, "bbbb");
    expect(two.allowed).toBe(true);
    expect(two.machines).toHaveLength(MAX_MACHINES);

    const three = admitMachine(two.machines, "cccc");
    expect(three.allowed).toBe(false);
    expect(three.count).toBe(MAX_MACHINES);
    // And nothing is written: a refusal does not quietly record the attempt.
    expect(three.machines).toHaveLength(MAX_MACHINES);
  });

  it("survives a store that holds rubbish", () => {
    const verdict = admitMachine([null, {}, { id: "aaaa" }], "aaaa");
    expect(verdict.allowed).toBe(true);
    expect(verdict.machines).toHaveLength(1);
  });
});

describe("a pass on the wrong computer", () => {
  it("is refused where it was not issued", () => {
    const pass = { ch: ["alpha"], mac: "aaaa" };
    expect(onItsMachine(pass, "aaaa")).toBe(true);
    expect(onItsMachine(pass, "bbbb")).toBe(false);
    // A copied file arriving with no machine at all is not a free pass.
    expect(onItsMachine(pass, null)).toBe(false);
  });

  /**
   * A pass issued before this rule existed names no machine. Those are let
   * through rather than locked out — the alternative is refusing everybody who
   * signed in last week to close a hole that closes itself when their pass
   * expires, which is now a week.
   */
  it("lets an older pass finish its week", () => {
    expect(onItsMachine({ ch: ["alpha"] }, null)).toBe(true);
    expect(onItsMachine({ ch: ["alpha"] }, "anything")).toBe(true);
  });
});
