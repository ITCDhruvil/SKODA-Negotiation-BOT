import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { EmbedBridge } from "@/components/shell/EmbedBridge";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Negotiation Desk",
  description: "Buyer workspace for BUY and SELL negotiation events (POC)",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Sets the saved theme before first paint so the page does not flash the wrong colours.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

// Inside the AIS prototype the page is shown in a frame with ?embed=1. That flag is kept for the whole visit, and the
// navigation and top bar are hidden because the host page already has its own.
const EMBED_SCRIPT = `try{var m=location.search.match(/theme=(light|dark)/);if(location.search.indexOf("embed=1")>-1)sessionStorage.setItem("embed","1");if(m)sessionStorage.setItem("embedTheme",m[1]);if(sessionStorage.getItem("embed")==="1"){document.documentElement.dataset.embed="1";var t=sessionStorage.getItem("embedTheme");if(t)document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + EMBED_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
          <EmbedBridge />
        </Providers>
      </body>
    </html>
  );
}
