/**
 * Converting between the two ways Kiza talks about a colour.
 *
 * Hex is what a person types and what the preferences store. HSL is what the
 * stylesheet holds and what a picker has to move around in — dragging towards
 * "lighter" is a straight line in HSL and a diagonal through three channels in
 * RGB.
 *
 * Kept apart from `appearance.ts` so the round trip can be tested on its own,
 * which matters here: a conversion that loses a degree of hue each way turns
 * into a colour that drifts every time the picker is opened.
 */

export interface Hsl {
  /** 0–359. */
  h: number;
  /** 0–100. */
  s: number;
  /** 0–100. */
  l: number;
}

/** Accepts "#abc", "#aabbcc", or either without the hash. */
export function hexToHsl(hex: string): Hsl | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  let body = match[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((character) => character + character)
      .join("");
  }

  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    // A grey has no hue. Reporting one would make the picker's hue slider jump
    // somewhere arbitrary the moment someone chose white or black.
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h: h % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** The inverse. Values outside their ranges are clamped rather than refused. */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const lightness = Math.min(100, Math.max(0, l)) / 100;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;

  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** Whether a string is a colour this module can read. */
export function isHex(value: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** Normalises to the "#RRGGBB" form the preferences store. */
export function normaliseHex(value: string): string | null {
  const hsl = hexToHsl(value);
  if (!hsl) return null;

  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())!;
  let body = match[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((character) => character + character)
      .join("");
  }
  return `#${body.toUpperCase()}`;
}
