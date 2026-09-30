import type { ItemState } from "@/lib/api";
import { STEPS } from "@/lib/labels";

export function Stepper({ state }: { state: ItemState }) {
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.states.includes(state)),
  );
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < current || state === "closed";
        const active = i === current && state !== "closed";
        return (
          <li key={s.key} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                done ? "bg-ok text-white dark:text-[#07130f]" : active ? "bg-brand text-white dark:text-[#07130f]" : "bg-raise text-muted"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`text-sm ${active ? "font-bold text-ink" : done ? "font-medium text-text" : "text-muted"}`}>{s.label}</span>
            {(done || active) && <span className="sr-only">{done ? "(completed)" : "(current)"}</span>}
            {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-line sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}
