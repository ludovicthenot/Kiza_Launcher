import { expect, test } from "@playwright/test";

const appConfig = {
  enable_discord_rpc: true,
  discord_show_mc_version: true,
  discord_show_instance_name: true,
  close_to_tray_on_launch: false,
  open_log_window_on_launch: true,
  minecraft_java_path: null,
  minecraft_min_memory_mb: null,
  minecraft_max_memory_mb: null,
  minecraft_extra_args: null,
  minecraft_releases_only: true,
};

async function mockLauncher(page: import("@playwright/test").Page) {
  await page.addInitScript(({ config }) => {
    const versions = [
      { id: "26.2", type: "release", url: "https://example.test/26.2", time: "2026-03-01T00:00:00Z", releaseTime: "2026-03-01T00:00:00Z" },
      { id: "26.3-snapshot-1", type: "snapshot", url: "https://example.test/snapshot", time: "2026-04-01T00:00:00Z", releaseTime: "2026-04-01T00:00:00Z" },
      { id: "1.21.8", type: "release", url: "https://example.test/1.21.8", time: "2025-07-17T00:00:00Z", releaseTime: "2025-07-17T00:00:00Z" },
      { id: "1.20.1", type: "release", url: "https://example.test/1.20.1", time: "2023-06-12T00:00:00Z", releaseTime: "2023-06-12T00:00:00Z" },
      { id: "1.7.10", type: "release", url: "https://example.test/1.7.10", time: "2014-06-26T00:00:00Z", releaseTime: "2014-06-26T00:00:00Z" },
      { id: "1.6.4", type: "release", url: "https://example.test/1.6.4", time: "2013-09-19T00:00:00Z", releaseTime: "2013-09-19T00:00:00Z" },
    ];

    (window as unknown as { __SAVED_CONFIG__: unknown }).__SAVED_CONFIG__ = null;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      invoke: async (cmd: string, args?: { config?: unknown; loader?: string }) => {
        if (cmd === "get_first_run_setup") {
          return {
            setup_completed: true,
            setup_version: 1,
            completed_at: "2026-07-18T00:00:00Z",
            selected_performance_profile: "balanced",
            skipped_steps: [],
          };
        }
        if (cmd === "list_game_instances") return [];
        if (cmd === "get_minecraft_versions") return { versions };
        if (cmd === "get_minecraft_loader_versions") {
          return args?.loader === "forge"
            ? [{ version: "47.4.10", stable: true }]
            : [{ version: "0.16.10", stable: true }, { version: "0.16.9", stable: true }];
        }
        if (cmd === "get_app_config") return config;
        if (cmd === "save_app_config") {
          (window as unknown as { __SAVED_CONFIG__: unknown }).__SAVED_CONFIG__ = args?.config;
          return null;
        }
        if (cmd === "minecraft_auth_get_account") return null;
        if (cmd === "minecraft_auth_list_accounts") return [];
        if (cmd === "get_api_connections") return [];
        if (cmd === "detect_minecraft_runtime") {
          return { valid: true, required_major: 21, java_path: "java.exe", version: "21", message: "Ready" };
        }
        if (cmd === "get_performance_profiles") return [];
        if (cmd === "plugin:app|version") return "0.0.229";
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
    };
  }, { config: appConfig });
}

test("version picker matches Kiza styling and reaches Minecraft 1.7", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockLauncher(page);
  await page.goto("/");

  await expect(page.getByText("Kiza Launcher", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("v0.0.229 Alpha", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New instance" }).click();
  await page.getByRole("button", { name: "Choose a Java runtime" }).click();
  await page.getByRole("option", { name: /Java 8/ }).click();
  await page.getByRole("button", { name: "Choose a Minecraft version" }).click();
  await expect(page.getByRole("option", { name: /Minecraft 26\.2/ })).toHaveCount(0);
  await page.getByPlaceholder("Search 1.21.8, 1.12.2...").fill("1.7.10");

  await expect(page.getByRole("option", { name: /Minecraft 1\.7\.10/ })).toBeVisible();
  await expect(page.getByText("26.3-snapshot-1")).toHaveCount(0);
  await expect(page.getByText("Minecraft 1.7 and newer", { exact: true })).toBeVisible();
  const popoverStyles = await page.getByRole("listbox", { name: "Minecraft versions" }).evaluate((listbox) => {
    const content = listbox.parentElement;
    const wrapper = content?.parentElement;
    return {
      background: content ? getComputedStyle(content).backgroundColor : "missing",
      contentZIndex: content ? getComputedStyle(content).zIndex : "missing",
      wrapperZIndex: wrapper ? getComputedStyle(wrapper).zIndex : "missing",
    };
  });
  expect(popoverStyles.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number(popoverStyles.contentZIndex)).toBeGreaterThan(50);
  expect(Number(popoverStyles.wrapperZIndex)).toBeGreaterThan(50);
  await expect.poll(() => page.getByRole("listbox", { name: "Minecraft versions" }).evaluate((listbox) => getComputedStyle(listbox.parentElement!).opacity)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("version-picker.png") });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("creation menu loads compatible modloader versions", async ({ page }) => {
  await mockLauncher(page);
  await page.goto("/");

  await page.getByRole("button", { name: "New instance" }).click();
  await page.getByRole("button", { name: "Choose a Java runtime" }).click();
  await page.getByRole("option", { name: /Java 17/ }).click();
  await expect(page.getByRole("button", { name: "Choose a Minecraft version" })).toContainText("Minecraft 1.20.1");
  await page.getByRole("button", { name: "Fabric" }).click();
  await expect(page.getByRole("button", { name: "Choose a fabric version" })).toContainText("0.16.10");
  await page.getByRole("button", { name: "Choose a fabric version" }).click();
  await expect(page.getByRole("option", { name: /0\.16\.9/ })).toBeVisible();
});

test("Minecraft settings persist the release-only preference", async ({ page }) => {
  await mockLauncher(page);
  await page.goto("/");

  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: /Minecraft/ }).click();
  const releasesOnly = page.getByRole("checkbox", { name: /Release versions only/ });
  await expect(releasesOnly).toHaveAttribute("aria-checked", "true");
  await releasesOnly.click();
  await expect(releasesOnly).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Save Minecraft settings" }).click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __SAVED_CONFIG__: { minecraft_releases_only?: boolean } | null }).__SAVED_CONFIG__?.minecraft_releases_only)).toBe(false);
});
