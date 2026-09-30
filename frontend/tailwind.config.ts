import type { Config } from "tailwindcss";

// Every colour is a CSS variable so light and dark themes switch without class changes.
const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), panel: v("panel"), raise: v("raise"), line: v("line"), line2: v("line2"),
        ink: v("ink"), text: v("text"), muted: v("muted"),
        brand: v("brand"), "brand-soft": v("brand-soft"),
        ok: v("ok"), "ok-soft": v("ok-soft"),
        amber: v("amber"), "amber-soft": v("amber-soft"),
        red: v("red"), "red-soft": v("red-soft"),
        info: v("info"), "info-soft": v("info-soft"),
        emerald: v("emerald"), emerald2: v("emerald2"),
        "side-t": v("side-t"), "side-m": v("side-m"),
        electric: v("electric"), "e-ink": v("e-ink"),
        focus: v("focus"),
      },
      borderRadius: { s: "6px", m: "10px", l: "16px" },
      fontFamily: {
        sans: ['"Hanken Grotesk"', "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(8,32,25,.06)", pop: "0 24px 60px -18px rgba(8,32,25,.35)" },
    },
  },
  plugins: [],
};

export default config;
