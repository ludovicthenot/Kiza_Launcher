/**
 * The four themes that ship with Kiza.
 *
 * Generated from the values that were in `App.css` before the theme engine
 * existed, so the migration could not quietly restyle them. They are ordinary
 * `ThemeDefinition`s: the launcher applies one of these exactly the way it
 * applies a `.kizatheme` somebody made, and nothing downstream knows which is
 * which.
 *
 * `tests/frontend/theme-parity.test.ts` compares what the engine produces from
 * these against a snapshot of the original stylesheet.
 */

import { THEME_SCHEMA_VERSION, type ThemeDefinition } from "./definition";

export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: "nebula",
    name: "Kiza Nebula",
    description:
      "Deep violet void with an electric violet primary. The signature Kiza look.",
    readOnly: true,
    colors: {
      "background": "242 30% 5%",
      "foreground": "240 25% 96%",
      "card": "241 26% 8%",
      "card-foreground": "240 25% 96%",
      "popover": "242 28% 7%",
      "popover-foreground": "240 25% 96%",
      "primary": "258 90% 66%",
      "primary-foreground": "0 0% 100%",
      "secondary": "240 18% 14%",
      "secondary-foreground": "240 25% 96%",
      "muted": "240 18% 14%",
      "muted-foreground": "237 13% 66%",
      "accent": "240 18% 14%",
      "accent-foreground": "240 25% 96%",
      "destructive": "0 68% 58%",
      "destructive-foreground": "0 0% 100%",
      "border": "240 16% 18%",
      "input": "240 16% 18%",
      "ring": "258 90% 66%",
    },
    ambient: [
      { color: "258 90% 66%", alpha: 0.09 },
      { color: "224 90% 60%", alpha: 0.06 },
    ],
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: "cyber",
    name: "Cyber",
    description:
      "Saturated neons on a near-black night: electric cyan and magenta.",
    readOnly: true,
    colors: {
      "background": "228 40% 6%",
      "foreground": "210 30% 96%",
      "card": "230 35% 9%",
      "card-foreground": "210 30% 96%",
      "popover": "230 38% 8%",
      "popover-foreground": "210 30% 96%",
      "primary": "184 96% 46%",
      "primary-foreground": "228 40% 8%",
      "secondary": "230 25% 13%",
      "secondary-foreground": "210 30% 96%",
      "muted": "230 25% 13%",
      "muted-foreground": "220 15% 65%",
      "accent": "341 100% 58%",
      "accent-foreground": "0 0% 100%",
      "destructive": "0 68% 58%",
      "destructive-foreground": "0 0% 100%",
      "border": "228 25% 16%",
      "input": "228 25% 16%",
      "ring": "184 96% 46%",
    },
    ambient: [
      { color: "184 96% 46%", alpha: 0.08 },
      { color: "341 100% 58%", alpha: 0.06 },
    ],
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: "toxic",
    name: "Toxic",
    description:
      "Carbon black, industrial grey, and a sharp radioactive green.",
    readOnly: true,
    colors: {
      "background": "120 2% 9%",
      "foreground": "220 5% 77%",
      "card": "120 2% 11%",
      "card-foreground": "220 5% 88%",
      "popover": "120 2% 10%",
      "popover-foreground": "220 5% 88%",
      "primary": "136 100% 50%",
      "primary-foreground": "136 75% 6%",
      "secondary": "213 6% 19%",
      "secondary-foreground": "220 5% 84%",
      "muted": "213 6% 17%",
      "muted-foreground": "216 6% 60%",
      "accent": "213 6% 30%",
      "accent-foreground": "220 5% 94%",
      "destructive": "355 72% 54%",
      "destructive-foreground": "0 0% 100%",
      "border": "213 6% 24%",
      "input": "213 6% 24%",
      "ring": "136 100% 50%",
    },
    ambient: [
      { color: "136 100% 50%", alpha: 0.07 },
      { color: "213 6% 30%", alpha: 0.08 },
    ],
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: "chinese-road",
    name: "Chinese Road",
    description:
      "Deep black lacquer with imperial red and warm antique gold.",
    readOnly: true,
    colors: {
      "background": "120 3% 7%",
      "foreground": "37 28% 84%",
      "card": "40 6% 9%",
      "card-foreground": "37 28% 88%",
      "popover": "40 7% 8%",
      "popover-foreground": "37 28% 88%",
      "primary": "353 100% 34%",
      "primary-foreground": "36 35% 94%",
      "secondary": "36 24% 16%",
      "secondary-foreground": "36 32% 78%",
      "muted": "36 18% 14%",
      "muted-foreground": "35 15% 59%",
      "accent": "35 42% 46%",
      "accent-foreground": "120 3% 7%",
      "destructive": "2 72% 52%",
      "destructive-foreground": "0 0% 100%",
      "border": "35 22% 24%",
      "input": "35 22% 24%",
      "ring": "35 42% 46%",
    },
    ambient: [
      { color: "353 100% 34%", alpha: 0.1 },
      { color: "35 42% 46%", alpha: 0.08 },
    ],
  },
];

/** The one Kiza starts with. */
export const DEFAULT_THEME_ID = "nebula";
