/**
 * MCP progress notification helper.
 *
 * Provides a typed wrapper around `extra.sendNotification` for sending
 * `notifications/progress` updates during long-running tool operations
 * (collect, run-full-pipeline).
 *
 * Usage:
 * ```ts
 * const prog = createProgressReporter(extra.sendNotification, extra._meta?.progressToken);
 * await prog?.report(1, 5, 'Collecting data…');
 * await prog?.report(2, 5, 'Normalizing…');
 * // ...
 * ```
 *
 * Returns `null` when the client did not request progress, so callers
 * can always `await prog?.report(...)` unconditionally.
 *
 * @packageDocumentation
 */

import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';

/**
 * Progress reporter — a lightweight function that sends one progress update.
 * Returns `void`; errors are silently caught to avoid crashing the handler.
 */
export interface ProgressReporter {
  report(progress: number, total: number, message?: string): Promise<void>;
}

/**
 * Create a ProgressReporter when the client supplied a progressToken.
 *
 * @param sendNotification  - The `extra.sendNotification` function from the MCP tool callback.
 * @param progressToken     - The `progressToken` from `extra._meta?.progressToken`.
 * @returns A ProgressReporter, or `null` if the client did not request progress.
 */
export function createProgressReporter(
  sendNotification: (notification: ServerNotification) => Promise<void>,
  progressToken: string | number | undefined,
): ProgressReporter | null {
  if (progressToken === undefined) return null;

  return {
    report: async (progress: number, total: number, message?: string): Promise<void> => {
      try {
        await sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            total,
            ...(message !== undefined ? { message } : {}),
          },
        });
      } catch {
        // Swallow — progress is advisory; a failing notification must not
        // break the tool response.
      }
    },
  };
}
