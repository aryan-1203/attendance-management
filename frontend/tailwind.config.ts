import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const v = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;
const statuses = ["p", "a", "hd", "l", "wo", "h", "co", "wfh", "od", "lop", "nj", "ex"];

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        border: v("border"),
        input: v("input"),
        ring: v("ring"),
        background: v("background"),
        foreground: v("foreground"),
        surface: { DEFAULT: v("surface"), raised: v("surface-raised"), sunken: v("surface-sunken") },
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground"), soft: v("primary-soft") },
        secondary: { DEFAULT: v("secondary"), foreground: v("secondary-foreground") },
        accent: { DEFAULT: v("accent"), foreground: v("accent-foreground") },
        destructive: { DEFAULT: v("destructive"), foreground: v("destructive-foreground") },
        success: { DEFAULT: v("success"), foreground: v("success-foreground") },
        warning: { DEFAULT: v("warning"), foreground: v("warning-foreground") },
        muted: { DEFAULT: v("muted"), foreground: v("muted-foreground") },
        popover: { DEFAULT: v("popover"), foreground: v("popover-foreground") },
        card: { DEFAULT: v("card"), foreground: v("card-foreground") },
        status: Object.fromEntries(statuses.map((s) => [s, { DEFAULT: v(`st-${s}`), fg: v(`st-${s}-fg`) }])),
      },
      fontFamily: {
        sans: ["'Geist Variable'", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["'Geist Mono Variable'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.6rem", letterSpacing: "-0.01em" }],
        xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.02em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.025em" }],
        "4xl": ["2.375rem", { lineHeight: "2.6rem", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        xs: "calc(var(--radius) - 8px)",
        sm: "calc(var(--radius) - 6px)",
        md: "calc(var(--radius) - 4px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 10px)",
      },
      boxShadow: {
        e1: "var(--elev-1)",
        e2: "var(--elev-2)",
        e3: "var(--elev-3)",
        glow: "0 0 0 1px hsl(var(--primary) / .25), 0 8px 28px -8px hsl(var(--primary) / .45)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        emphasized: "cubic-bezier(0.2, 0, 0, 1)",
      },
      transitionDuration: { fast: "120ms", base: "200ms", slow: "320ms" },
      // finer steps used by soft status tints (Tailwind 3 only generates modifiers on the scale)
      opacity: { 8: "0.08", 12: "0.12" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pop-in": { "0%": { transform: "scale(.85)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
      },
      animation: { shimmer: "shimmer 1.6s infinite", "pop-in": "pop-in 220ms cubic-bezier(0.16,1,0.3,1)" },
    },
  },
  plugins: [animate],
} satisfies Config;
