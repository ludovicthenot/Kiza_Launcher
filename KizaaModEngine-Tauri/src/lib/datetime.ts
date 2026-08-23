/**
 * How Kiza writes dates and clocks.
 *
 * There is one reason this exists rather than a scattering of
 * `toLocaleDateString()` calls: a setting that claims to change the date format
 * has to actually reach every date on screen. A preference nothing reads is
 * worse than no preference at all.
 *
 * "system" defers to the machine, which is the right default — someone who set
 * their Windows region already answered this question once.
 */

export interface RegionFormats {
  /** "system", "24h" or "12h". */
  timeFormat: string;
  /** "system", "dmy", "mdy" or "ymd". */
  dateFormat: string;
}

export const SYSTEM_FORMATS: RegionFormats = {
  timeFormat: "system",
  dateFormat: "system",
};

/** Accepts what the launcher passes around: an ISO string, millis, or a Date. */
export type DateLike = string | number | Date;

function toDate(value: DateLike): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The date alone.
 *
 * The explicit orders are assembled by hand rather than borrowed from another
 * locale. Asking `Intl` for "en-GB" to get day-before-month would also drag in
 * English month names the moment the format grows beyond numbers.
 */
export function formatDate(value: DateLike, formats: RegionFormats = SYSTEM_FORMATS): string {
  const date = toDate(value);
  if (!date) return "—";

  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();

  switch (formats.dateFormat) {
    case "dmy":
      return `${day}/${month}/${year}`;
    case "mdy":
      return `${month}/${day}/${year}`;
    case "ymd":
      return `${year}-${month}-${day}`;
    default:
      return date.toLocaleDateString();
  }
}

/** The clock alone. */
export function formatTime(value: DateLike, formats: RegionFormats = SYSTEM_FORMATS): string {
  const date = toDate(value);
  if (!date) return "—";

  const minutes = pad(date.getMinutes());

  if (formats.timeFormat === "24h") {
    return `${pad(date.getHours())}:${minutes}`;
  }
  if (formats.timeFormat === "12h") {
    const hours = date.getHours();
    // Midnight and noon are 12, not 0 — the mistake that makes a launcher
    // report a world last played at "0:15 AM".
    const twelve = hours % 12 === 0 ? 12 : hours % 12;
    return `${twelve}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
  }
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Both, the way a "last played" line wants them. */
export function formatDateTime(value: DateLike, formats: RegionFormats = SYSTEM_FORMATS): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${formatDate(date, formats)} ${formatTime(date, formats)}`;
}

/** Reads the two fields out of the saved configuration. */
export function formatsFromConfig(
  config: { time_format?: string; date_format?: string } | undefined | null,
): RegionFormats {
  return {
    timeFormat: config?.time_format ?? "system",
    dateFormat: config?.date_format ?? "system",
  };
}

/** A live example for the settings page, so the choice is visible before it is made. */
export function sample(formats: RegionFormats): string {
  // A date whose day and month cannot be confused for one another: 25 is not a
  // month, so the reader can tell dmy from mdy at a glance.
  return formatDateTime(new Date(2026, 11, 25, 14, 5), formats);
}
