import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConsoleRoot } from "./ConsoleRoot";
import "./App.css"; // Import styles

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
    {consoleMatch ? <ConsoleRoot instanceId={decodeURIComponent(consoleMatch[1])} /> : <App />}
  </React.StrictMode>,
);
