import { GameInstanceStatus } from "../../lib/types";
import { CheckCircle2, AlertCircle, XCircle, ShieldAlert, HelpCircle } from "lucide-react";
import { cn } from "../../lib/utils";

interface StatusBadgeProps {
  status: GameInstanceStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    Valid: {
      icon: CheckCircle2,
      label: "Healthy",
      color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    },
    MissingPath: {
      icon: XCircle,
      label: "Missing Path",
      color: "text-red-500 bg-red-500/10 border-red-500/20",
    },
    InvalidSignature: {
      icon: ShieldAlert,
      label: "Invalid Signature",
      color: "text-orange-500 bg-orange-500/10 border-orange-500/20",
    },
    NoWriteAccess: {
      icon: AlertCircle,
      label: "Read Only",
      color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
    },
    Unverified: {
      icon: HelpCircle,
      label: "Unverified",
      color: "text-gray-500 bg-gray-500/10 border-gray-500/20",
    },
  };

  const { icon: Icon, label, color } = config[status] || config.Unverified;

  return (
    <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium", color, className)}>
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
}
