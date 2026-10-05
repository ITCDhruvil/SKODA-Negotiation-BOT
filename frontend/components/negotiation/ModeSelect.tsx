import type { Mode } from "@/lib/api";
import { MODE_HINT, MODE_LABEL } from "@/lib/labels";
import { Select } from "@/components/ui/Select";

const MODES: Mode[] = ["auto", "approve", "manual"];

export function ModeSelect({
  id,
  value,
  onChange,
  disabled,
  allowAuto = true,
}: {
  id: string;
  value: Mode;
  onChange: (m: Mode) => void;
  disabled?: boolean;
  /** Full auto is only for small deals; above that a person stays in the loop. */
  allowAuto?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Select<Mode>
        id={id}
        ariaLabel="Permission level"
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={MODES.filter((m) => allowAuto || m !== "auto").map((m) => ({ value: m, label: MODE_LABEL[m], hint: MODE_HINT[m] }))}
      />
      <span id={`${id}-hint`} className="text-xs text-muted">
        {MODE_HINT[value]}
        {!allowAuto && " Full auto is not available for a deal of this size."}
      </span>
    </div>
  );
}
