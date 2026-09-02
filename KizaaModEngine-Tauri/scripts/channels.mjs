/**
 * Where each edition's releases live.
 *
 * Kiza ships as three separate applications built from one source tree, and
 * they must not be handed out from the same pile. A Stable user downloading
 * the launcher and a designer downloading the Maker are after different
 * binaries with different identities and different update channels; one
 * folder of `0.0.320` files cannot say which is which, and the first time it
 * matters is the time somebody installs the wrong one.
 *
 *     releases/
 *       stable/0.0.320/…      the launcher everybody gets
 *       maker/0.0.320/…       the launcher with the theme tools in it
 *       experimental/…        whatever is being tried
 *
 * Beside the project, never inside it: the repository holds sources, this
 * folder holds what is handed to people.
 */

import path from "node:path";

/** The editions, in the order a person would think of them. */
export const EDITIONS = ["stable", "maker", "experimental"];

/**
 * Which edition is being built.
 *
 * The same environment variable the bundler and the Rust crate read, so a
 * build cannot produce a Maker binary and file it under Stable.
 */
export function edition() {
  const wanted = (process.env.KIZA_EDITION ?? "stable").trim().toLowerCase();
  if (!EDITIONS.includes(wanted)) {
    throw new Error(
      `Unknown KIZA_EDITION "${wanted}". Use one of: ${EDITIONS.join(", ")}.`,
    );
  }
  return wanted;
}

/**
 * The streams each edition is allowed to publish into, the default first.
 *
 * The same table as `edition.rs`, and a test reads both files so they cannot
 * drift.
 *
 * Stable has three: a beta of Stable is still Stable, and so is an alpha. That
 * is what lets somebody with the ordinary installer be let into the alpha
 * without downloading a different application — they follow an earlier stream
 * of the launcher they already have.
 *
 * The other two have one each. A Maker or Experimental build carries its own
 * identity on disk; published into a stream the launcher follows, it would
 * arrive as an update and install itself as something else.
 */
export const CHANNELS_BY_EDITION = {
  stable: ["stable", "beta", "alpha"],
  maker: ["maker"],
  experimental: ["experimental"],
};

/** Where this edition may publish. */
export function channelsFor(which = edition()) {
  return CHANNELS_BY_EDITION[which] ?? ["stable"];
}

/** And where it goes when nobody says. */
export function defaultChannel(which = edition()) {
  return channelsFor(which)[0];
}

/** The folder this edition's version is delivered from. */
export function releaseDir(root, version, which = edition()) {
  return path.resolve(root, "..", "releases", which, version);
}

/** Every folder an edition has ever been delivered from. */
export function editionRoot(root, which = edition()) {
  return path.resolve(root, "..", "releases", which);
}
