import * as React from "react";

export type Theme = "light" | "dark" | "system";
const Ctx = React.createContext<{ theme: Theme; resolved: "light" | "dark"; setTheme: (t: Theme) => void } | null>(null);

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    try { return (localStorage.getItem("ae-theme") as Theme) || "system"; } catch { return "system"; }
  });
  const [sys, setSys] = React.useState(systemDark);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => setSys(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  const resolved = theme === "system" ? (sys ? "dark" : "light") : theme;
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);
  const setTheme = (t: Theme) => {
    try { localStorage.setItem("ae-theme", t); } catch { /* private mode */ }
    setThemeState(t);
  };
  return <Ctx.Provider value={{ theme, resolved, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}
