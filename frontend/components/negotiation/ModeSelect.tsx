import type { Mode } from "@/lib/api";
import { MODE_HINT, MODE_LABEL } from "@/lib/labels";
import { Select } from "@/components/ui/Select";

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
      <Select<Mode>
        id={id}
        ariaLabel="Permission level"
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m], hint: MODE_HINT[m] }))}
      />
      <span id={`${id}-hint`} className="text-xs text-muted">
        {MODE_HINT[value]}
      </span>
    </div>
  );
}
