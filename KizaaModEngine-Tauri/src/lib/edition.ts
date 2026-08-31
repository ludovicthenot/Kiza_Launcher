/**
 * Which Kiza this build is.
 *
 * One codebase, three products. The edition is decided when the bundle is
 * built and never at runtime: Stable does not contain the Maker tools at all,
 * so there is nothing for a setting to switch on.
 *
 * `import.meta.env.VITE_KIZA_EDITION` is replaced by Vite with a string
 * literal at build time, so `EDITION === "maker"` folds to `false` in a Stable
 * build and everything behind it is dropped by the bundler. That is the whole
 * reason this is a constant and not a store value.
 *
 * Do not confuse this with the update channel. The edition is what the binary
 * is; the channel is which stream of releases it follows. A Stable build can
 * follow `stable` or `beta` — both are Stable builds — and must never be
 * offered a Maker or Experimental one, which is why the channel a build is
 * allowed to ask for is derived from here rather than typed by the user.
 */
export type Edition = "stable" | "maker" | "experimental";

const EDITIONS: readonly Edition[] = ["stable", "maker", "experimental"];

function declared(): Edition {
  const value = import.meta.env.VITE_KIZA_EDITION;
  return EDITIONS.includes(value as Edition) ? (value as Edition) : "stable";
}

/** This build's edition. A literal after bundling. */
export const EDITION: Edition = declared();

/** True only in the Maker build. Guards every import of the Maker tools. */
export const IS_MAKER = EDITION === "maker";

/** True only in the Experimental build. */
export const IS_EXPERIMENTAL = EDITION === "experimental";

/** What this edition is called on screen. */
export const EDITION_NAME: Record<Edition, string> = {
  stable: "Kiza Launcher",
  maker: "Kiza Maker",
  experimental: "Kiza Experimental",
};

/**
 * The update channels a build of this edition may follow.
 *
 * The first is the default. A Stable user must never be handed a Maker or an
 * Experimental build by mistake, and the way to guarantee that is not to trust
 * a string in a config file: an edition can only ask for a channel on its own
 * list, and the server is told which edition is asking.
 */
export const CHANNELS_FOR: Record<Edition, readonly string[]> = {
  stable: ["stable", "beta"],
  maker: ["maker"],
  experimental: ["experimental"],
};

/** Whether this edition is allowed to follow that channel. */
export function channelAllowed(channel: string): boolean {
  return CHANNELS_FOR[EDITION].includes(channel.trim().toLowerCase());
}

/** The channel to fall back to when a stored one is not allowed here. */
export function defaultChannel(): string {
  return CHANNELS_FOR[EDITION][0];
}

/**
 * Whether this build should say so on screen.
 *
 * Experimental is explicitly a build that may break, so it says which one it
 * is. Maker says so because a designer needs to know they are not looking at
 * what a player will run.
 */
export const NEEDS_A_BADGE = EDITION !== "stable";
