import { expect, test } from "@playwright/test";

async function mockTauri(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const apiConnections = [
      { id: "modrinth", label: "Modrinth", kind: "public_api", configured: true, status: "available", detail: "API publique joignable.", action_hint: null },
      { id: "microsoft", label: "Microsoft / Minecraft", kind: "browser_oauth", configured: true, status: "configured", detail: "Client ID configure.", action_hint: null },
      { id: "curseforge", label: "CurseForge", kind: "api_key", configured: false, status: "missing", detail: "Cle API absente.", action_hint: null },
    ];

    const performanceProfiles = [
      { id: "low_end", label: "Low End", description: "Stable for small configs.", min_memory_mb: 512, max_memory_mb: 2048 },
      { id: "balanced", label: "Balanced", description: "Default smooth profile.", min_memory_mb: 1024, max_memory_mb: 4096 },
      { id: "quality", label: "Quality", description: "Higher visual settings.", min_memory_mb: 2048, max_memory_mb: 6144 },
    ];

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      invoke: async (cmd: string) => {
        if (cmd === "get_first_run_setup") {
          return {
            setup_completed: false,
            setup_version: 1,
            completed_at: null,
            selected_performance_profile: null,
            skipped_steps: [],
          };
        }
        if (cmd === "minecraft_auth_get_account") return null;
        if (cmd === "minecraft_auth_list_accounts") return [];
        if (cmd === "get_api_connections") return apiConnections;
        if (cmd === "detect_minecraft_runtime") {
          return {
            valid: false,
            required_major: 21,
            java_path: null,
            version: null,
            message: "Java 21 runtime missing.",
          };
        }
        if (cmd === "get_performance_profiles") return performanceProfiles;
        if (cmd === "plugin:app|version") return "0.0.209";
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
    };
  });
}

for (const viewport of [
  { width: 360, height: 720 },
  { width: 768, height: 720 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`setup layout has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockTauri(page);
    await page.goto("/");

    // Both ways out of the first screen, at every width. Naming them rather
    // than a paragraph is deliberate: this screen is the one thing a new user
    // cannot get past if it renders wrong, and one of these buttons was once
    // drawn, measured, clickable and fully transparent.
    await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue without an account" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
}
