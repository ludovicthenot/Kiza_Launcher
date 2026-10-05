/**
 * `@tauri-apps/api/core`, as Kiza Maker sees it.
 *
 * In the Maker edition the bundler points every import of
 * `@tauri-apps/api/core` here (`vite.config.ts`), the launcher's own code and
 * the Tauri plugins' alike. Everything is the real module except `invoke`,
 * which sends the theme commands, the window, dialogues and events to the
 * real runtime and answers the rest from the demonstration library
 * (`demo.ts`).
 *
 * Done at build time because it cannot be done at run time: Tauri's
 * `__TAURI_INTERNALS__.invoke` is read-only in a real window, so wrapping it
 * there — which worked in a browser preview with a mocked runtime — stopped
 * the Maker from starting at all.
 */

// The real module, by its file rather than by its name: the name is what the
// bundler sends here.
import * as real from "../../../node_modules/@tauri-apps/api/core.js";
import { answers, demo } from "./demo";

export * from "../../../node_modules/@tauri-apps/api/core.js";

export async function invoke<T>(
  command: string,
  args?: real.InvokeArgs,
  options?: real.InvokeOptions,
): Promise<T> {
  if (!answers(command)) return real.invoke<T>(command, args, options);
  return (await demo(command, args as Record<string, unknown> | undefined)) as T;
}
