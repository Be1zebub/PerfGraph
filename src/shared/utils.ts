/**
 * Shared utility functions used across the webtrace codebase.
 */

/** Severity ordering helper: critical > warning > info */
export function severityOrder(severity: string): number {
  const order: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  return order[severity] ?? 0;
}
