import { DiscoverTab } from "../instance/discover/DiscoverTab";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { useI18n } from "../../lib/i18n";

/**
 * Every modpack on Modrinth and CurseForge, from "New instance": the same
 * catalogue, filters and sorting as the instance's Discover page, for no
 * instance yet -- installing a pack makes the instance, and the launcher
 * opens on it.
 */
export function ModpackCatalogueDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[860px] w-[min(1180px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-background p-0 [&>button:last-child]:z-20 [&>button:last-child]:rounded-full [&>button:last-child]:bg-secondary/70 [&>button:last-child]:p-1.5 [&>button:last-child]:opacity-100 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.09),0_30px_80px_hsl(242_30%_2%/0.7)]">
        {/* Said to screen readers; the catalogue's own heading says it to the eye. */}
        <DialogTitle className="sr-only">{t("Find a modpack")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Every modpack on Modrinth and CurseForge, made into an instance in one click.")}
        </DialogDescription>
        {open && <DiscoverTab instance={null} category="modpack" onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
