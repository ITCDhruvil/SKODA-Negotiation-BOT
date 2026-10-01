import type { Mode } from "@/lib/api";
import { MODE_HINT, MODE_LABEL } from "@/lib/labels";
import { inputClass } from "@/components/ui/basics";

const MODES: Mode[] = ["auto", "approve", "manual"];

export function ModeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: Mode;
  onChange: (m: Mode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <select
        id={id}
        aria-label="Permission level"
        aria-describedby={`${id}-hint`}
        className={`${inputClass} min-h-[44px]`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Mode)}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>
      <span id={`${id}-hint`} className="text-xs text-muted">
        {MODE_HINT[value]}
      </span>
    </div>
  );
}
