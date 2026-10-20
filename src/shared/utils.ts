/**
 * Shared utility functions used across the perfgraph codebase.
 */

/** Severity ordering helper: critical > warning > info */
export function severityOrder(severity: string): number {
  const order: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  return order[severity] ?? 0;
}

/**
 * Normalize a user-supplied URL.
 *
 * People write `example.com` and `perfgraph google.com`; requiring the
 * protocol up front only produces an "Invalid URL" error where a run was
 * meant. A missing scheme becomes `https://`, and an explicit one is kept.
 *
 * @param input - The URL as the user typed it
 * @returns The URL with a scheme, trimmed
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  // A leading `//` is protocol relative and needs one too.
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `https://${trimmed}`;
}
