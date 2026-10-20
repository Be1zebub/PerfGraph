/**
 * Lighthouse insight audits — the findings a trace cannot produce.
 *
 * Lighthouse measures a set of costs that the PerfGraph pipeline does not
 * derive: forced reflows, images that could be smaller, bytes that could be
 * cached, duplicated or legacy JavaScript. Each of them carries a measured
 * value and the sources involved, which is exactly what a finding needs.
 */

import type { LighthouseFinding } from './types.js';

/** One row of an insight table */
interface InsightRow {
  [key: string]: unknown;
}

/** A table of an insight audit */
interface InsightTable {
  headings?: Array<{ key: string | null }>;
  items?: InsightRow[];
}

/** Runtime type guard: the value is a plain object */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Collect the tables of an insight audit.
 *
 * The audits come in two shapes: a table directly, and a list of tables.
 */
function collectTables(details: unknown): InsightTable[] {
  if (!isRecord(details)) return [];

  if (details.type === 'table') {
    return [details as unknown as InsightTable];
  }

  if (details.type === 'list' && Array.isArray(details.items)) {
    const tables: InsightTable[] = [];
    for (const item of details.items) {
      if (isRecord(item) && item.type === 'table') {
        tables.push(item as unknown as InsightTable);
      }
    }
    return tables;
  }

  return [];
}

/** The rows of every table of an insight audit. */
function collectRows(details: unknown): InsightRow[] {
  const rows: InsightRow[] = [];
  for (const table of collectTables(details)) {
    if (Array.isArray(table.items)) rows.push(...table.items);
  }
  return rows;
}

/** The total an insight audit reports for a byte-based cost. */
function wastedBytesOf(details: unknown): number | undefined {
  if (!isRecord(details)) return undefined;
  const debugData = details.debugData;
  if (!isRecord(debugData)) return undefined;
  const wasted = debugData.wastedBytes;
  return typeof wasted === 'number' && Number.isFinite(wasted) ? wasted : undefined;
}

/** A source location rendered as `url:line:column`. */
function formatSource(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const url = typeof value.url === 'string' ? value.url : undefined;
  if (!url) return undefined;
  const line = typeof value.line === 'number' ? value.line : undefined;
  const column = typeof value.column === 'number' ? value.column : undefined;
  if (line === undefined) return url;
  return column === undefined ? `${url}:${line}` : `${url}:${line}:${column}`;
}

/** The URLs of the rows of a table. */
function urlsOf(rows: InsightRow[], key = 'url'): string[] {
  const urls: string[] = [];
  for (const row of rows) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) urls.push(value);
  }
  return urls;
}

/**
 * Parse the insight audits into findings.
 *
 * @param audits - The audits of the Lighthouse result
 * @returns The findings, most expensive first
 */
export function parseInsightFindings(
  audits: Record<string, unknown>,
): LighthouseFinding[] {
  const findings: LighthouseFinding[] = [];

  const add = (
    id: string,
    title: string,
    value: number,
    unit: LighthouseFinding['unit'],
    warnAt: number,
    critAt: number,
    sources?: string[],
    auditScore?: number,
  ) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const finding: LighthouseFinding = {
      id,
      title,
      value,
      unit,
      warnAt,
      critAt,
    };
    if (sources?.length) finding.sources = sources.slice(0, 5);
    if (auditScore !== undefined) finding.auditScore = auditScore;
    findings.push(finding);
  };

  // Forced reflow: the script that forced a layout, and how long it took.
  const reflow = audits['forced-reflow-insight'];
  if (isRecord(reflow)) {
    const rows = collectRows(reflow.details);
    let total = 0;
    const sources: string[] = [];
    for (const row of rows) {
      const time = row.reflowTime;
      if (typeof time === 'number' && Number.isFinite(time)) total += time;
      const source = formatSource(row.source);
      if (source && !sources.includes(source)) sources.push(source);
    }
    add(
      'forced-reflow',
      'Forced reflow',
      total,
      'ms',
      50,
      200,
      sources,
      typeof reflow.score === 'number' ? reflow.score : undefined,
    );
  }

  // Bytes that could be saved.
  const byteAudits: Array<{
    id: string;
    audit: string;
    title: string;
    warnAt: number;
    critAt: number;
  }> = [
    {
      id: 'image-delivery',
      audit: 'image-delivery-insight',
      title: 'Images could be delivered smaller',
      warnAt: 50_000,
      critAt: 200_000,
    },
    {
      id: 'cache',
      audit: 'cache-insight',
      title: 'Static resources are not cached',
      warnAt: 20_000,
      critAt: 100_000,
    },
    {
      id: 'duplicated-javascript',
      audit: 'duplicated-javascript-insight',
      title: 'Duplicated JavaScript',
      warnAt: 20_000,
      critAt: 100_000,
    },
    {
      id: 'legacy-javascript',
      audit: 'legacy-javascript-insight',
      title: 'Legacy JavaScript',
      warnAt: 20_000,
      critAt: 100_000,
    },
  ];

  for (const { id, audit, title, warnAt, critAt } of byteAudits) {
    const value = audits[audit];
    if (!isRecord(value)) continue;
    const rows = collectRows(value.details);
    const bytes = wastedBytesOf(value.details);
    if (bytes !== undefined) {
      add(
        id,
        title,
        bytes,
        'bytes',
        warnAt,
        critAt,
        urlsOf(rows),
        typeof value.score === 'number' ? value.score : undefined,
      );
      continue;
    }

    // The audit did not report a total, so add up the rows.
    let total = 0;
    for (const row of rows) {
      const wasted = row.wastedBytes;
      if (typeof wasted === 'number' && Number.isFinite(wasted)) total += wasted;
    }
    add(
      id,
      title,
      total,
      'bytes',
      warnAt,
      critAt,
      urlsOf(rows),
      typeof value.score === 'number' ? value.score : undefined,
    );
  }

  // Fonts that block the text while they load.
  const fonts = audits['font-display-insight'];
  if (isRecord(fonts)) {
    const rows = collectRows(fonts.details);
    let total = 0;
    for (const row of rows) {
      const wasted = row.wastedMs;
      if (typeof wasted === 'number' && Number.isFinite(wasted)) total += wasted;
    }
    add(
      'font-display',
      'Fonts block the text while they load',
      total,
      'ms',
      50,
      200,
      urlsOf(rows),
      typeof fonts.score === 'number' ? fonts.score : undefined,
    );
  }

  // The elements that caused the layout shifts.
  const cls = audits['cls-culprits-insight'];
  if (isRecord(cls)) {
    const rows = collectRows(cls.details);
    let value = 0;
    const sources: string[] = [];
    for (const row of rows) {
      const score = row.score ?? row.cls;
      if (typeof score === 'number' && Number.isFinite(score)) value += score;
      const node = row.node;
      if (isRecord(node) && typeof node.selector === 'string') {
        sources.push(node.selector);
      }
    }
    add(
      'cls-culprits',
      'Elements that cause layout shifts',
      value,
      'score',
      0.1,
      0.25,
      sources,
      typeof cls.score === 'number' ? cls.score : undefined,
    );
  }

  return findings.sort((a, b) => b.value - a.value);
}
