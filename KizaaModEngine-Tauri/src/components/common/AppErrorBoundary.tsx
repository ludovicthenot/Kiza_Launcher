import React from "react";

/**
 * Last line of defence for the whole window.
 *
 * Without a boundary, any exception thrown while rendering makes React unmount
 * the entire tree — the user gets a blank white window with no way to tell what
 * happened. This shows the error instead, so a startup failure is reportable
 * rather than mysterious.
 */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surfaced in the WebView console and captured by the launcher log.
    console.error("[Kiza] Interface crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const details = [error.message, error.stack].filter(Boolean).join("\n\n");

    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#0b0a12",
          color: "#f4f2fa",
          fontFamily: "Segoe UI, system-ui, sans-serif",
          padding: "2rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          Kiza Launcher could not start
        </h1>
        <p style={{ margin: 0, color: "#aaa5ba", fontSize: "0.9rem" }}>
          The interface hit an unexpected error. Restarting usually fixes it. If it keeps
          happening, send the details below.
        </p>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#8b5cf6",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Restart the interface
          </button>
          <button
            onClick={() => void navigator.clipboard?.writeText(details)}
            style={{
              background: "transparent",
              color: "#f4f2fa",
              border: "1px solid #352c4a",
              borderRadius: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Copy details
          </button>
        </div>

        <pre
          style={{
            margin: 0,
            padding: "1rem",
            background: "#141021",
            border: "1px solid #352c4a",
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
            lineHeight: 1.5,
            overflow: "auto",
            maxHeight: "50vh",
            whiteSpace: "pre-wrap",
          }}
        >
          {details}
        </pre>
      </div>
    );
  }
}
