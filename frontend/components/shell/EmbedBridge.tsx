"use client";

import { useEffect } from "react";

/** Inside the AIS prototype this tells the host page how tall the content is, so the frame can grow and the page scrolls once. */
export function EmbedBridge() {
  useEffect(() => {
    if (document.documentElement.dataset.embed !== "1" || window.parent === window) return;
    const el = document.querySelector<HTMLElement>(".app-grid");
    if (!el) return;
    let last = 0;
    const post = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h === last) return;
      last = h;
      window.parent.postMessage({ negHeight: h }, "*");
    };
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    // The host page tells us when its light or dark switch is used.
    const onMessage = (e: MessageEvent) => {
      const t = e.data?.negTheme;
      if (t !== "light" && t !== "dark") return;
      document.documentElement.dataset.theme = t;
      try {
        sessionStorage.setItem("embedTheme", t);
      } catch {
        /* storage may be blocked */
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      ro.disconnect();
      window.removeEventListener("message", onMessage);
    };
  }, []);
  return null;
}
