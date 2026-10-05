"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading, Notice } from "@/components/ui/State";
import { api, type HandoffCase } from "@/lib/api";

/**
 * Where the AIS prototype opens a negotiation. It tells AIS it is ready, AIS replies with the case (supplier offers and the
 * Buyer's targets), and the conversation with the chosen supplier opens.
 */
export default function HandoffPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    if (window.parent === window) {
      setStandalone(true);
      return;
    }
    let done = false;
    const onMessage = async (e: MessageEvent) => {
      const c = e.data?.negCase as HandoffCase | undefined;
      if (!c || done || e.source !== window.parent) return;
      done = true;
      try {
        const out = await api.handoff(c);
        router.replace(`/negotiate/${out.session_id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    window.addEventListener("message", onMessage);
    // The host may not be listening yet, so ask again until the case arrives.
    const ask = () => window.parent.postMessage({ negReady: true }, "*");
    ask();
    const timer = setInterval(() => !done && ask(), 800);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [router]);

  if (standalone) {
    return <Notice tone="info">This page opens a negotiation for a case in the AIS prototype. Open it from the case there.</Notice>;
  }
  if (error) return <Notice tone="red">Could not open the negotiation: {error}</Notice>;
  return <Loading label="Opening the negotiation for this case" />;
}
