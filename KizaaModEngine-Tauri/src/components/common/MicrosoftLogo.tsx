import { cn } from "../../lib/utils";
import mark from "../../assets/microsoft-mark.png";

/**
 * Microsoft's four squares, where an account or a sign-in is Microsoft's:
 * next to "Sign in with Microsoft", on a Microsoft account's label. The
 * white behind the squares is gone, so they sit on any background.
 */
export function MicrosoftMark({ className }: { className?: string }) {
  return <img src={mark} alt="" aria-hidden draggable={false} className={cn("h-4 w-4 shrink-0", className)} />;
}

