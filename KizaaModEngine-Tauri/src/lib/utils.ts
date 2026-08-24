import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Re-exported so the many callers that already import it from here keep
 * working, and so there is only one implementation to be wrong.
 *
 * This one does not read the user's units preference — a plain function
 * cannot. Anything inside a component should use `useStorageUnits` instead.
 */
export { formatBytes } from "./units"

