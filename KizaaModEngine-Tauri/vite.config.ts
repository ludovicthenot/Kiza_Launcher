import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

/**
 * Which Kiza this bundle is, decided here and nowhere else.
 *
 * Replaced into the bundle as a string literal, so `EDITION === "maker"` folds
 * to `false` in a Stable build and every Maker tool behind it is dropped by the
 * bundler rather than shipped and hidden. That is the difference between three
 * products from one codebase and one product with a switch in it.
 */
const edition = process.env.KIZA_EDITION ?? "stable";
if (!["stable", "maker", "experimental"].includes(edition)) {
  throw new Error(`Unknown KIZA_EDITION "${edition}". Use stable, maker or experimental.`);
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  // `KIZA_BUNDLE_REPORT=1 npx vite build` writes what is in the bundle to
  // bundle-report.html, for looking at when it grows.
  plugins: [
    react(),
    ...(process.env.KIZA_BUNDLE_REPORT
      ? [(await import("rollup-plugin-visualizer")).visualizer({ filename: "bundle-report.html", gzipSize: true })]
      : []),
  ],

  define: {
    "import.meta.env.VITE_KIZA_EDITION": JSON.stringify(edition),
  },

  // Kiza Maker is a theme editor over demonstration data: every import of
  // Tauri's `invoke` goes through `src/lib/maker/core.ts`, which answers the
  // launcher's questions itself. Only in that edition, so no other bundle
  // carries the demonstration at all.
  resolve: {
    alias:
      edition === "maker"
        ? [
            {
              find: /^@tauri-apps\/api\/core$/,
              replacement: fileURLToPath(new URL("./src/lib/maker/core.ts", import.meta.url)),
            },
          ]
        : [],
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
