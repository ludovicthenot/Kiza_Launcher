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

/** The folder this edition's version is delivered from. */
export function releaseDir(root, version, which = edition()) {
  return path.resolve(root, "..", "releases", which, version);
}

/** Every folder an edition has ever been delivered from. */
export function editionRoot(root, which = edition()) {
  return path.resolve(root, "..", "releases", which);
}
