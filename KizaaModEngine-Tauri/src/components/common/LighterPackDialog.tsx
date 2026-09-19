import { useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/primitives";
import { useDeleteInstance, useInstallCurseForgeContent, type OfficialPack } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { formatBytes } from "../../lib/utils";

/**
 * An imported pack that weighs a third of the official release.
 *
 * <p>The archive that went around for RLCraft was 12 MB against the 51 MB
 * release: manifest and configs, none of the `resources`, `scripts` or
 * `structures` the pack does not run right without. Nothing about it was
 * invalid, so the launcher imported it and the person found out from a
 * magenta main menu. This says so first, with the numbers, and offers the
 * real thing in one click -- the imported instance is replaced, not kept
 * beside it.
 */
export function LighterPackDialog({
  instanceId,
  official,
  onClose,
}: {
  instanceId: string;
  official: OfficialPack | null;
  onClose: (replacedWith: string | null) => void;
}) {
  const { t } = useI18n();
  const install = useInstallCurseForgeContent();
  const remove = useDeleteInstance();
  const [busy, setBusy] = useState(false);

  if (!official) return null;

  const installOfficial = async () => {
    setBusy(true);
    try {
      const result = await install.mutateAsync({
        instanceId,
        contentType: "modpack",
        modId: official.project_id,
        fileId: official.file_id,
      });
      // The light copy goes only once the real one is there.
      await remove.mutateAsync(instanceId);
      onClose(result.created_instance_id ?? result.instance_id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose(null))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            {t("This archive looks incomplete")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "The file you imported is {archive}; the official {name} release on CurseForge ({file}) is {official}. Files are probably missing: configs, scripts, resources. The pack may start with a broken menu or missing recipes.",
            )
              .replace("{archive}", formatBytes(official.archive_bytes))
              .replace("{name}", official.name)
              .replace("{file}", official.file_name)
              .replace("{official}", formatBytes(official.official_bytes))}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => onClose(null)}>
            {t("Keep this one")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void installOfficial()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("Install the official pack instead")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
