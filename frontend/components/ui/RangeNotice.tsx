"use client";

import { dateShort } from "@/lib/format";
import { useRange } from "@/lib/providers";

/** Reminds the reader that the date range from the top bar is narrowing this page. */
export function RangeNotice() {
  const { range, setRange } = useRange();
  if (!range.from && !range.to) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-m bg-info-soft px-4 py-2 text-xs text-info">
      <span>
        Filtered to {range.from ? dateShort(range.from) : "…"} – {range.to ? dateShort(range.to) : "…"}
      </span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={() => setRange({ from: "", to: "" })}
        className="font-semibold underline hover:no-underline"
      >
        Clear
      </button>
    </div>
  );
}
