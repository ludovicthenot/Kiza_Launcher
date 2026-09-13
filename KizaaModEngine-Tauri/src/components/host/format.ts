import type { ServerState } from "../../lib/hostQueries";

/** Source string for a state; translated where shown. */
export function stateLabel(state: ServerState): string {
  switch (state) {
    case "online":
      return "Online";
    case "offline":
      return "Offline";
    case "starting":
      return "Starting";
    case "stopping":
      return "Stopping";
    case "crashed":
      return "Crashed";
    case "installing":
      return "Installing";
    case "detached":
      return "Running outside Kiza";
  }
}

/** Dot and text colours for a state. */
export function stateTone(state: ServerState): { dot: string; text: string; ring: string } {
  switch (state) {
    case "online":
      return { dot: "bg-emerald-400", text: "text-emerald-300", ring: "border-emerald-400/40 bg-emerald-400/10" };
    case "starting":
    case "stopping":
    case "installing":
      return { dot: "bg-amber-400 animate-pulse", text: "text-amber-300", ring: "border-amber-400/40 bg-amber-400/10" };
    case "crashed":
      return { dot: "bg-red-400", text: "text-red-300", ring: "border-red-400/40 bg-red-400/10" };
    case "detached":
      return { dot: "bg-sky-400", text: "text-sky-300", ring: "border-sky-400/40 bg-sky-400/10" };
    case "offline":
      return { dot: "bg-muted-foreground/60", text: "text-muted-foreground", ring: "border-border/70" };
  }
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

export function formatConsoleTime(ms: number): string {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
