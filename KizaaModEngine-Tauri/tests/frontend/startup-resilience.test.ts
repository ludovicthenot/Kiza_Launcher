import { describe, expect, it, afterEach } from "vitest";

// Simulates the first launch after installation, when WebView2 is still
// provisioning its data folder and localStorage access throws.
const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

function breakLocalStorage() {
  const thrower = () => {
    throw new DOMException("Access is denied.", "SecurityError");
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      return { getItem: thrower, setItem: thrower, removeItem: thrower };
    },
  });
}

afterEach(() => {
  // Restore the real implementation so later suites are unaffected.
  if (originalDescriptor) {
    Object.defineProperty(window, "localStorage", originalDescriptor);
  }
});

describe("startup with unavailable storage", () => {
  it("still resolves a theme instead of throwing", async () => {
    breakLocalStorage();
    const { getStoredTheme, initTheme } = await import("../../src/lib/theme");

    expect(getStoredTheme()).toBe("nebula");
    expect(() => initTheme()).not.toThrow();
  });

  it("still resolves a language instead of throwing", async () => {
    breakLocalStorage();
    const { getStoredLanguage } = await import("../../src/lib/i18n");

    expect(getStoredLanguage()).toBe("en");
  });
});
