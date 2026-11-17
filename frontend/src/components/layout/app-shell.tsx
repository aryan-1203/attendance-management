import * as React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPaletteProvider } from "./command-palette";

export function AppShell() {
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem("ae-sidebar") === "1");
  const loc = useLocation();
  const reduce = useReducedMotion();
  const toggle = () => setCollapsed((c) => { localStorage.setItem("ae-sidebar", c ? "0" : "1"); return !c; });
  return (
    <CommandPaletteProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-5 sm:px-6 sm:py-7 safe-bottom">
            <LayoutGroup>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={loc.pathname} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
                <Outlet />
              </motion.div>
            </AnimatePresence>
            </LayoutGroup>
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  );
}
