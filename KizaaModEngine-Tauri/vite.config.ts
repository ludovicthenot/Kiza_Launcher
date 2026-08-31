import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Which Kiza this bundle is, decided here and nowhere else.
 *
 * Replaced into the bundle as a string literal, so `EDITION === "maker"` folds
 * to `false` in a Stable build and every Maker tool behind it is dropped by the
 * bundler rather than shipped and hidden. That is the difference between three
 * products from one codebase and one product with a switch in it.
 */
// @ts-expect-error process is a nodejs global
const edition = process.env.KIZA_EDITION ?? "stable";
if (!["stable", "maker", "experimental"].includes(edition)) {
  throw new Error(`Unknown KIZA_EDITION "${edition}". Use stable, maker or experimental.`);
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  define: {
    "import.meta.env.VITE_KIZA_EDITION": JSON.stringify(edition),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
