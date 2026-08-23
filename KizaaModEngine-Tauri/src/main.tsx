import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConsoleRoot } from "./ConsoleRoot";
import { I18nProvider } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import { initAppearance } from "./lib/appearance";
import { AppErrorBoundary } from "./components/common/AppErrorBoundary";
// Sonner ships its stylesheet separately; without it toasts render unstyled
// (full width, wrong corner) because their position comes from CSS.
import "sonner/dist/styles.css";
import "./App.css"; // Import styles

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <I18nProvider>
        {consoleMatch ? <ConsoleRoot instanceId={decodeURIComponent(consoleMatch[1])} /> : <App />}
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
