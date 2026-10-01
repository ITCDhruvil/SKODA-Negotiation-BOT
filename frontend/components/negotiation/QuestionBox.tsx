"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/ui/basics";
import { api, type SessionView } from "@/lib/api";

const QUICK = [
  "What is your delivery time?",
  "What are the payment terms?",
  "Is there any warranty?",
  "How long is your rate valid?",
  "Can you confirm the quantity?",
  "Which incoterm is this price on?",
];

/** Ask the vendor something without making an offer; the answer comes from the quote on file. */
export function QuestionBox({ sessionId, onResult, onError }: { sessionId: string; onResult: (s: SessionView) => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      onResult(await api.askQuestion(sessionId, value.trim()));
      setText("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-l border border-line2 p-4">
      <h3 className="text-sm font-bold text-ink">Ask the vendor a question</h3>
      <div className="flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => ask(q)}
            className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-text hover:border-brand disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <textarea
          className={`${inputClass} min-w-0 flex-1`}
          rows={2}
          aria-label="Your question"
          placeholder="Or type your own question, for example about delivery, payment, warranty or packing"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}
