import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "../../lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/primitives";
import { Checkbox } from "../ui/checkbox";

const EULA_URL = "https://aka.ms/MinecraftEULA";

/**
 * Minecraft's EULA, asked once per server before the first start.
 *
 * Kiza writes `eula=true` only after the box is ticked and the button
 * pressed; a server whose file says otherwise refuses to start, and so does
 * Kiza on its behalf.
 */
export function EulaDialog({
  open,
  serverName,
  busy,
  onOpenChange,
  onAccept,
}: {
  open: boolean;
  serverName: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
}) {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setAgreed(false); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Minecraft EULA")}</DialogTitle>
          <DialogDescription>
            {t("To run {name}, Mojang asks that you agree to the Minecraft End User License Agreement. Kiza will write eula=true into the server folder only once you agree here.").replace("{name}", serverName)}
          </DialogDescription>
        </DialogHeader>
        <button
          type="button"
          onClick={() => void openUrl(EULA_URL)}
          className="inline-flex items-center gap-2 self-start text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          {t("Read the EULA")}
        </button>
        <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5 text-sm">
          <Checkbox checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          {t("I have read and agree to the Minecraft EULA.")}
        </label>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!agreed || busy} onClick={onAccept}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Agree and start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
