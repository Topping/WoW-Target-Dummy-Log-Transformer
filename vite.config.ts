import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative assets work at the repository-scoped GitHub Pages URL and locally.
  base: "./",
  plugins: [react()],
  build: {
    // This single-entry static app has no preload graph. Omitting Vite's
    // fetch-based modulepreload polyfill keeps the production runtime free of
    // a network-capable code path that combat-file handling could reach.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
