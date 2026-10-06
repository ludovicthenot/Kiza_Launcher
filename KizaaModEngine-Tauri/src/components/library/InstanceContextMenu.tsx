import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The menu a right click on an instance opens.
 *
 * Shaped like a desktop context menu: a small frosted panel at the pointer,
 * groups divided by hairlines, the destructive action last and in red. It
 * stays inside the window, closes on a click elsewhere, Escape, a scroll or
 * the window losing focus, and the arrow keys move through it.
 */
export function InstanceContextMenu({
  x,
  y,
  title,
  groups,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  groups: MenuItem[][];
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y, origin: "top left" });

  // Kept inside the window: flipped left or up when it would overflow.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    const flipX = x + width + margin > window.innerWidth;
    const flipY = y + height + margin > window.innerHeight;
    setPlace({
      left: Math.max(margin, flipX ? x - width : x),
      top: Math.max(margin, flipY ? y - height : y),
      origin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}`,
    });
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onPointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return (
    <div
      ref={panel}
      role="menu"
      aria-label={title}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: place.left, top: place.top, transformOrigin: place.origin }}
      className="fixed z-[150] w-60 select-none rounded-xl bg-popover/90 p-1.5 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.09),0_18px_44px_hsl(242_30%_2%/0.6)] backdrop-blur-2xl backdrop-saturate-150 animate-in fade-in-0 zoom-in-95 duration-100 motion-reduce:animate-none"
    >
      <div className="truncate px-2.5 pb-1.5 pt-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
        {title}
      </div>
      {groups.map((group, index) => (
        <div key={index} className={cn(index > 0 && "mt-1 border-t border-border/40 pt-1")}>
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] outline-none transition-colors duration-75 disabled:opacity-40",
                item.destructive
                  ? "text-red-300 hover:bg-red-500/80 hover:text-white focus-visible:bg-red-500/80 focus-visible:text-white"
                  : "text-foreground/90 hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-80" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
