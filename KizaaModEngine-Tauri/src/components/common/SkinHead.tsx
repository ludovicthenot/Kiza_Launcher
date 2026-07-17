import { useState } from "react";
import { User } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Minecraft skin head avatar with a graceful fallback: shows a user icon
 * when no URL is available or the avatar service is unreachable.
 */
export function SkinHead({ url, className }: { url: string | null | undefined; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <span className={cn("flex items-center justify-center bg-secondary/40 text-muted-foreground", className)}>
        <User className="h-3/5 w-3/5" />
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className={cn("object-cover", className)}
      style={{ imageRendering: "pixelated" }}
      onError={() => setFailed(true)}
    />
  );
}
