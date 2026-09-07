import { describe, expect, it } from "vitest";
import { mintPass, readPass, memberKey } from "../../cloudflare/src/access.js";
import { renewPass } from "../../cloudflare/src/gate.js";

const SECRET = "a-secret-that-only-the-service-knows";
const MACHINE = "a1b2c3d4e5f60718";
const WHO = "123456789012345678";

/** A service with one entry in its list, or none. */
function service(list: Record<string, unknown> | null) {
  return {
    ACCESS_SECRET: SECRET,
    DISCORD_CLIENT_ID: "an-app",
    DISCORD_CLIENT_SECRET: "a-secret",
    ACCESS: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      get: async (key: string) => (list && key === memberKey(WHO) ? list : null),
    },
  };
}

function asking(pass: string, machine: string | null = MACHINE) {
  return new Request("https://service/v1/access/renew", {
    method: "POST",
    headers: {
      authorization: `Bearer ${pass}`,
      ...(machine ? { "x-kiza-machine": machine } : {}),
    },
  });
}

/**
 * Trading a pass that still works for a fresh one.
 *
 * A pass lasts a week so that a revocation lands within a week. Renewal exists
 * so that fact stops doubling as "a tester signs in every Monday" — and the
 * whole design rests on one thing: renewing re-asks the list. Copy the old
 * pass forward instead and the week means nothing, because the first pass ever
 * issued would keep renewing itself long after somebody was removed.
 */
describe("renewing a pass", () => {
  it("gives a fresh pass to somebody still on the list", async () => {
    const pass = await mintPass(SECRET, {
      subject: WHO,
      channels: ["alpha"],
      machine: MACHINE,
    });
    const answer = await renewPass(asking(pass), service({ channels: ["alpha"] }));
    expect(answer.status).toBe(200);

    const body = await answer.json();
    const read = await readPass(SECRET, body.pass);
    expect(read.ok).toBe(true);
    expect(read.pass.sub).toBe(WHO);
    expect(read.pass.ch).toEqual(["alpha"]);
    // Still bound to the same computer: renewal is not a sign-in, and a pass
    // that came back unbound would be one that works anywhere.
    expect(read.pass.mac).toBe(MACHINE);
    // And it is actually further out than the one handed in.
    const old = await readPass(SECRET, pass);
    expect(read.pass.exp).toBeGreaterThanOrEqual(old.pass.exp);
  });

  /** The reason this endpoint reads the list instead of trusting the pass. */
  it("refuses somebody who has been removed", async () => {
    const pass = await mintPass(SECRET, {
      subject: WHO,
      channels: ["alpha"],
      machine: MACHINE,
    });
    const answer = await renewPass(asking(pass), service(null));
    expect(answer.status).toBe(403);
    expect((await answer.json()).reason).toBe("not-listed");
  });

  /**
   * A grant narrowed since the pass was written must narrow the pass too.
   * Otherwise moving somebody from alpha to beta leaves them on alpha for as
   * long as they keep renewing.
   */
  it("hands back the channels somebody has now, not the ones they had", async () => {
    const pass = await mintPass(SECRET, {
      subject: WHO,
      channels: ["alpha", "beta"],
      machine: MACHINE,
    });
    const answer = await renewPass(asking(pass), service({ channels: ["beta"] }));
    expect(answer.status).toBe(200);

    const read = await readPass(SECRET, (await answer.json()).pass);
    expect(read.pass.ch).toEqual(["beta"]);
  });

  it("refuses a pass presented from another computer", async () => {
    const pass = await mintPass(SECRET, {
      subject: WHO,
      channels: ["alpha"],
      machine: MACHINE,
    });
    const answer = await renewPass(
      asking(pass, "ffffffffffffffff"),
      service({ channels: ["alpha"] }),
    );
    expect(answer.status).toBe(403);
    expect((await answer.json()).reason).toBe("another-machine");
  });

  /**
   * Past the week there is no shortcut back. The service refuses an expired
   * pass everywhere else, and an endpoint that accepted one would be a way to
   * hold access indefinitely by never quite letting it lapse.
   */
  it("will not resurrect a pass that has already run out", async () => {
    const expired = await mintPass(SECRET, {
      subject: WHO,
      channels: ["alpha"],
      machine: MACHINE,
      seconds: 60,
      now: Date.now() - 3600 * 1000,
    });
    const answer = await renewPass(asking(expired), service({ channels: ["alpha"] }));
    expect(answer.status).toBe(401);
    expect((await answer.json()).reason).toBe("expired");
  });

  it("refuses a request carrying no pass at all", async () => {
    const bare = new Request("https://service/v1/access/renew", { method: "POST" });
    const answer = await renewPass(bare, service({ channels: ["alpha"] }));
    expect(answer.status).toBe(401);
  });
});
