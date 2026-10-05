import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Each window loads only its own page: the Manager and the tray menu are
// separate windows and never share a session with the launcher's.
const ConsoleRoot = React.lazy(() => import("./ConsoleRoot").then((m) => ({ default: m.ConsoleRoot })));
const TrayRoot = React.lazy(() => import("./TrayRoot").then((m) => ({ default: m.TrayRoot })));
import { I18nProvider } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import { initAppearance } from "./lib/appearance";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
// Sonner ships its stylesheet separately; without it toasts render unstyled
// (full width, wrong corner) because their position comes from CSS.
import "sonner/dist/styles.css";
import "./App.css"; // Import styles
import { TooltipLayer } from "./components/common/TooltipLayer";
import { IS_MAKER } from "./lib/edition";
import { installDemo } from "./lib/maker/demo";

// Kiza Maker draws the launcher's pages over demonstration data: the theme
// commands reach the real backend, everything else is answered in the page
// and nothing can launch. Folded away in every other edition.
if (IS_MAKER) installDemo();

// Theming must never be able to stop the app from booting.
try {
  initTheme();
  initAppearance();
} catch (error) {
  console.error("[Kiza] Theme init failed:", error);
}

// Disable the WebView default context menu (Back/Reload/Print...) so the app
// feels native. Keep it inside editable fields for copy/paste, and keep it in
// dev builds for inspect/debug.
if (!import.meta.env.DEV) {
  window.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("input, textarea, [contenteditable='true']")) {
      event.preventDefault();
    }
  });
}

// Route the separate log window (#/console/<instanceId>) to ConsoleRoot; the
// main window renders the launcher App.
const consoleMatch = window.location.hash.match(/^#\/console\/(.+)$/);
// The tray menu (#/tray) is a frameless transparent window: the page must
// paint nothing of its own behind the menu, or the corners are squares.
const trayRoute = window.location.hash === "#/tray";
if (trayRoute) {
  for (const element of [document.documentElement, document.body, document.getElementById("root")]) {
    if (element) element.style.background = "transparent";
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <I18nProvider>
        <React.Suspense fallback={null}>
          {!trayRoute && <TooltipLayer />}
          {trayRoute ? (
            <TrayRoot />
          ) : consoleMatch ? (
            <ConsoleRoot instanceId={decodeURIComponent(consoleMatch[1])} />
          ) : (
            <App />
          )}
        </React.Suspense>
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);

// From here the boot watchdog in index.html stands down: an error it catches
// later is shown as a notification rather than replacing the window.
requestAnimationFrame(() => {
  (window as unknown as { __kizaBooted?: boolean }).__kizaBooted = true;
});
