// Decides when a Modrinth listing and a CurseForge listing are the same
// project, so a merged search shows one card carrying both sources instead of
// the same mod twice.
//
// The rule is deliberately strict: normalised titles must be *equal*. Merging
// two different mods is far worse than showing a duplicate — it would hide one
// behind the other's name and install the wrong file. Under-merging is visible
// and harmless; over-merging is invisible and wrong.
//
// An earlier version of this dropped generic words like "shaders" and "api"
// before comparing. That looked tidier and was wrong: it made "Iris" and "Iris
// Shaders" the same project, and "Fabric" the same as "Fabric API". Those words
// are part of the names.

/**
 * A comparable identity for a project title.
 *
 * Only presentation differences are removed — case, spacing, punctuation, and a
 * bracketed acronym that one catalogue appends and the other does not
 * ("Just Enough Items (JEI)" against "Just Enough Items"). Every remaining word
 * is kept, because every remaining word distinguishes something.
 *
 * Returns an empty string when nothing is left, which callers must treat as
 * "do not merge".
 */
export function projectKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

/** True when two titles name the same project. */
export function isSameProject(left: string, right: string): boolean {
  const leftKey = projectKey(left);
  if (!leftKey) return false;
  return leftKey === projectKey(right);
}
