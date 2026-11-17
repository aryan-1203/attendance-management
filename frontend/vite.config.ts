/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "favicon-32.png", "favicon-48.png", "logo.svg", "apple-touch-icon.png"],
      manifest: {
        name: "ProsParity",
        short_name: "ProsParity",
        description: "Attendance, leave & pay-days management",
        theme_color: "#0B1020",
        background_color: "#0B1020",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/docs/],
        runtimeCaching: [
          { urlPattern: /\/api\/(settings\/public|meta)/, handler: "StaleWhileRevalidate" },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          data: ["@tanstack/react-query", "@tanstack/react-table", "@tanstack/react-virtual", "openapi-fetch"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-popover", "@radix-ui/react-select",
            "@radix-ui/react-dropdown-menu", "@radix-ui/react-tooltip", "@radix-ui/react-tabs", "cmdk", "sonner"],
          motion: ["framer-motion"],
          charts: ["recharts"],
          forms: ["react-hook-form", "zod", "@hookform/resolvers"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.API_PROXY ?? "http://localhost:8000", changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
