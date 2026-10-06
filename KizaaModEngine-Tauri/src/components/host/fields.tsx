import { cn } from "../../lib/utils";
import { Input, Select } from "../ui/primitives";

/** A labelled control, in the two-column settings grids of the Host page. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[0.8125rem] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  unit,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  unit?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        <Input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className={cn("tabular-nums", unit && "pr-12")}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </Field>
  );
}

export function ChoiceField({
  label,
  value,
  onChange,
  options,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A switch drawn as a row, so a column of them reads as a list of settings. */
export function ToggleField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 rounded-xl bg-secondary/45 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/60"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
          checked ? "border-primary/60 bg-primary" : "border-border bg-secondary/60",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
