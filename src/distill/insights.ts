/**
 * Agent-optimized summary layer that fuses Lighthouse insights,
 * extracted features, and evidence data into a compact Insights structure.
 *
 * The result can be serialized to `insights.toon` (~5-15 KB for a typical SPA).
 *
 * @packageDocumentation
 */

import type { FeatureSet } from '../extract/types.js';
import { assessDataQuality } from '../shared/data-quality.js';
import type { RunContext } from '../normalize/types.js';
import { buildLighthouseInsights } from '../normalize/lighthouse-insights.js';
import type {
  LighthouseInsights,
  NetworkChainNode,
} from '../normalize/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CriticalPathNode {
  url: string;
  durationMs?: number;
  children?: CriticalPathNode[];
}

/**
 * A recommendation as it appears in the authoritative report.
 *
 * The insights artifact reuses the report's recommendations instead of
 * building its own list, so an agent reading both artifacts gets the same
 * answer.
 */
export interface ReportRecommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  action: string;
  evidence?: string[];
  applicability?: 'applicable' | 'not-applicable' | 'insufficient-evidence';
  verification?: string;
}

export interface Insights {
  url: string;
  analyzedAt: string;
  runContext?: RunContext;
  /**
   * Core Web Vitals measured by PerfGraph in the traced browser run.
   *
   * These come from the run described by `runContext` — an unthrottled
   * desktop navigation unless the run says otherwise.
   */
  metrics: {
    lcpMs?: number;
    /** Which run the LCP value came from */
    lcpSource?: 'performance-api' | 'trace' | 'lighthouse';
    fcpMs?: number;
    cls?: number;
    tbtMs?: number;
    tbtStatus?: 'measured' | 'unavailable';
  };
  /**
   * Metrics reported by Lighthouse from its own navigation.
   *
   * Lighthouse applies its own throttling, so these values describe a
   * different run than `metrics` and must not be merged with it.
   */
  lighthouse: {
    performance?: number;
    accessibility?: number;
    bestPractices?: number;
    seo?: number;
    /** When Lighthouse ran — its own navigation, not the PerfGraph one */
    fetchedAt?: string;
    lcpMs?: number;
    fcpMs?: number;
    cls?: number;
    tbtMs?: number;
    tbtStatus?: 'measured' | 'unavailable';
    /**
     * The Lighthouse audits that did not pass.
     *
     * They carry findings the causal rules do not know about — forced
     * reflows, main-thread work, redirects — and they are the only place
     * where those appear without opening the raw Lighthouse result.
     */
    failedAudits?: Array<{
      id: string;
      title: string;
      score?: number;
      numericValue?: number;
      displayValue?: string;
    }>;
  };
  /**
   * The response of the document the visitor received.
   *
   * The headers answer what the timings cannot: whether the HTML is cached
   * at the edge, how it is encoded, whether the connection can be upgraded.
   */
  documentResponse?: {
    url?: string;
    status?: number;
    headers: Record<string, string>;
  };
  lcpElement?: {
    selector?: string;
    snippet?: string;
    nodeLabel?: string;
    source?: 'trace' | 'performance-api' | 'lighthouse';
    type?: 'text' | 'image' | 'unknown';
    /** Resource URL of an image LCP; absent for a text LCP */
    lcpElementUrl?: string;
    lcpResourceType?: string;
    renderDelayMs?: number;
    resourceLoadDelayMs?: number;
    resourceLoadTimeMs?: number;
    ttfbMs?: number;
  };
  renderBlocking: Array<{
    url: string;
    bytes?: number;
    wastedMs?: number;
    resourceType?: string;
  }>;
  thirdParty?: {
    ratio: number;
    byOwnership: Record<string, { requests: number; bytes: number; duration: number }>;
  };
  renderBlockingSources?: {
    networkCount: number;
    lighthouseCount: number;
    networkOnlyCount: number;
    lighthouseOnlyCount: number;
  };
  criticalPath?: {
    depth: number;
    longestChainMs?: number;
    elapsedCriticalPathMs?: number;
    aggregateRequestDurationMs?: number;
    pageLifecycleMs?: number;
    tree?: CriticalPathNode;
    /** Document responses the browser loaded — more than one means a redirect */
    documentChain?: {
      count: number;
      urls: string[];
      wastedServerMs: number;
      contentAtMs: number;
    };
  };
  warnings: string[];
  dataQuality?: {
    status: 'complete' | 'partial';
    warnings: string[];
  };
  topRecommendations: Array<{
    priority: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    action: string;
    evidence?: string[];
    applicability?: 'applicable' | 'not-applicable' | 'insufficient-evidence';
    verification?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Navigate to the LHR root — handles { lhr: {...} } wrapper used by LighthouseRawData. */
function getLHRRoot(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.lhr)) return raw.lhr;
  return raw;
}

/**
 * Collect the Lighthouse audits that did not pass.
 *
 * The insight audits carry findings the causal rules cannot derive: forced
 * reflows, main-thread work, redirects, console errors. They are listed with
 * their values so an agent sees them without opening the raw result.
 *
 * The Core Web Vitals audits are left out: their values are already in the
 * `lighthouse` block, and repeating them only dilutes the list.
 */
const LIGHTHOUSE_METRIC_AUDITS = new Set([
  'first-contentful-paint',
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'speed-index',
  'total-blocking-time',
  'interactive',
  'time-to-interactive',
  'max-potential-fid',
]);

function collectFailedAudits(
  lhr: Record<string, unknown>,
): NonNullable<Insights['lighthouse']['failedAudits']> | undefined {
  const audits = isRecord(lhr.audits) ? lhr.audits : {};
  const failed: NonNullable<Insights['lighthouse']['failedAudits']> = [];

  for (const [id, value] of Object.entries(audits)) {
    if (!isRecord(value)) continue;
    if (LIGHTHOUSE_METRIC_AUDITS.has(id)) continue;
    const score = typeof value.score === 'number' ? value.score : undefined;
    const displayMode = typeof value.scoreDisplayMode === 'string' ? value.scoreDisplayMode : undefined;
    // A score of null means the audit did not run; an errored audit has no
    // usable value either.
    if (score === undefined || score >= 1 || displayMode === 'error' || displayMode === 'notApplicable') {
      continue;
    }
    const audit: NonNullable<Insights['lighthouse']['failedAudits']>[number] = {
      id,
      title: typeof value.title === 'string' ? value.title : id,
      score,
    };
    if (typeof value.numericValue === 'number') audit.numericValue = value.numericValue;
    if (typeof value.displayValue === 'string') audit.displayValue = value.displayValue;
    failed.push(audit);
  }

  if (failed.length === 0) return undefined;
  // The audits that failed hardest come first.
  return failed.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
}

/** Extract numericValue from a Lighthouse audit by ID. */function getAuditNumericValue(
  lhr: Record<string, unknown>,
  auditId: string,
): number | undefined {
  const audits = isRecord(lhr.audits) ? lhr.audits : {};
  const audit = isRecord(audits[auditId])
    ? (audits[auditId] as Record<string, unknown>)
    : undefined;
  return safeNumber(audit?.numericValue);
}

/** Extract category scores from Lighthouse. */
export function extractLighthouseScores(raw: unknown): {
  performance?: number;
  accessibility?: number;
  bestPractices?: number;
  seo?: number;
} {
  const lhr = getLHRRoot(raw);
  const categories = isRecord(lhr.categories) ? lhr.categories : {};

  const getScore = (name: string): number | undefined => {
    const cat = categories[name];
    return isRecord(cat) ? safeNumber(cat.score) : undefined;
  };

  return {
    performance: getScore('performance'),
    accessibility: getScore('accessibility'),
    bestPractices: getScore('best-practices'),
    seo: getScore('seo'),
  };
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

/**
 * Build lcpElement from Lighthouse insights + features.
 *
 * Lighthouse does not always expose the LCP element — its breakdown audit
 * carries no details on every version. The trace candidate does, so it is
 * used as the fallback and reports where the element came from.
 */
function buildLcpElement(
  insights: LighthouseInsights,
  features: FeatureSet,
): Insights['lcpElement'] | undefined {
  const lb = insights.lcpBreakdown;
  const featureElement = features.lcpBreakdown?.lcpElement;

  if (!lb && !featureElement) return undefined;

  // The element and its timings must come from the same run. The lab run is
  // the one the causal chains describe, so it wins when it has an element.
  if (featureElement) {
    const element: NonNullable<Insights['lcpElement']> = {};
    const selector = featureElement.selector ?? '';
    const nodeLabel = featureElement.nodeLabel;
    if (selector) element.selector = selector;
    if (nodeLabel !== undefined) element.nodeLabel = nodeLabel;
    if (featureElement.snippet !== undefined) element.snippet = featureElement.snippet;
    if (featureElement.source !== undefined) element.source = featureElement.source;
    if (featureElement.type !== undefined) element.type = featureElement.type;
    if (features.lcpBreakdown?.ttfb !== undefined) element.ttfbMs = features.lcpBreakdown.ttfb;
    if (features.lcpBreakdown?.elementRenderDelay !== undefined) {
      element.renderDelayMs = features.lcpBreakdown.elementRenderDelay;
    }
    if (features.lcpBreakdown?.resourceLoadDelay !== undefined) {
      element.resourceLoadDelayMs = features.lcpBreakdown.resourceLoadDelay;
    }
    if (features.lcpBreakdown?.resourceLoadTime !== undefined) {
      element.resourceLoadTimeMs = features.lcpBreakdown.resourceLoadTime;
    }
    if (features.lcpBreakdown?.lcpElementUrl !== undefined) {
      element.lcpElementUrl = features.lcpBreakdown.lcpElementUrl;
    }
    if (features.lcpBreakdown?.lcpResourceType !== undefined) {
      element.lcpResourceType = features.lcpBreakdown.lcpResourceType;
    }
    return element;
  }

  const selector = lb?.lcpElementSelector ?? '';
  const nodeLabel = lb?.lcpElementNodeLabel;
  if (!selector && !nodeLabel) return undefined;

  const element: NonNullable<Insights['lcpElement']> = { selector };
  if (nodeLabel !== undefined) element.nodeLabel = nodeLabel;
  if (lb?.lcpElementSnippet !== undefined) element.snippet = lb.lcpElementSnippet;
  element.source = 'lighthouse';
  if (lb?.elementRenderDelay !== undefined) element.renderDelayMs = lb.elementRenderDelay;
  if (lb?.timeToFirstByte !== undefined) element.ttfbMs = lb.timeToFirstByte;

  return element;
}

/** Build renderBlocking array from Lighthouse insights. */
function buildRenderBlocking(
  insights: LighthouseInsights,
  features: FeatureSet,
): Insights['renderBlocking'] {
  const rb = insights.renderBlocking;
  if (rb?.resources && rb.resources.length > 0) {
    return rb.resources
      .filter((resource) => resource.resourceType !== 'Document')
      .map((r) => ({
        url: r.url,
        bytes: r.totalBytes,
        wastedMs: r.wastedMs,
        resourceType: r.resourceType,
      }));
  }

  return features.renderBlocking?.resources?.map((resource) => ({
    url: resource.url,
    bytes: resource.totalBytes,
    wastedMs: resource.wastedMs,
    resourceType: resource.resourceType,
  })) ?? [];
}

/** Convert a NetworkChainNode to a CriticalPathNode. */
function convertChainNode(node: NetworkChainNode): CriticalPathNode {
  const result: CriticalPathNode = {
    url: node.url,
    durationMs: node.navStartToEndTime,
  };

  if (node.children) {
    const children = Object.values(node.children).map(convertChainNode);
    if (children.length > 0) {
      result.children = children;
    }
  }

  return result;
}

/** Build criticalPath from features + Lighthouse insights. */
function buildCriticalPath(
  features: FeatureSet,
  insights: LighthouseInsights,
): Insights['criticalPath'] | undefined {
  const cp = features.criticalPath;
  const ndt = insights.networkDependencyTree;

  if (!cp && !ndt) return undefined;

  let tree: CriticalPathNode | undefined;

  if (ndt?.chains) {
    const entries = Object.values(ndt.chains);
    if (entries.length > 0) {
      tree = convertChainNode(entries[0]!);
    }
  }

  // The tree PerfGraph built from the request initiators is available even
  // when the Lighthouse trace engine failed to produce one.
  if (!tree && cp?.tree) {
    tree = convertFeatureTree(cp.tree);
  }

  return {
    depth: cp?.deepestChainDepth ?? 0,
    longestChainMs: cp?.elapsedCriticalPathMs ?? ndt?.longestChainDuration ?? cp?.longestSingleRequest,
    elapsedCriticalPathMs: cp?.elapsedCriticalPathMs,
    aggregateRequestDurationMs: cp?.aggregateRequestDurationMs,
    pageLifecycleMs: cp?.pageLifecycleMs,
    documentChain: cp?.documentChain,
    tree,
  };
}

/**
 * Build the response summary of the document the visitor received.
 *
 * The document is the one the page metrics are anchored to, so its headers
 * describe the response that mattered.
 */
function buildDocumentResponse(
  features: FeatureSet,
): Insights['documentResponse'] | undefined {
  const document = features.criticalPath?.documentResponse;
  if (!document) return undefined;

  return {
    url: document.url,
    status: document.status,
    headers: document.headers,
  };
}

/** Convert the feature dependency tree into the insights tree shape. */
function convertFeatureTree(node: {
  url: string;
  durationMs?: number;
  children?: Array<{
    url: string;
    durationMs?: number;
    children?: Array<{ url: string; durationMs?: number; children?: unknown[] }>;
  }>;
}): CriticalPathNode {
  const converted: CriticalPathNode = { url: node.url };
  if (node.durationMs !== undefined) converted.durationMs = node.durationMs;
  if (node.children?.length) {
    converted.children = node.children.map((child) =>
      convertFeatureTree(child as Parameters<typeof convertFeatureTree>[0]),
    );
  }
  return converted;
}

/** Above this a blocking time is an artifact of the run, not a measurement */
const LIGHTHOUSE_TBT_SANE_MAX = 60_000; // 60 seconds

/**
 * The total blocking time Lighthouse reported for its own run.
 *
 * A headless run can report an inflated value (151 seconds) because of the
 * tracing overhead, so a value above a sane bound counts as unavailable.
 */
export function extractLighthouseTbtMs(lighthouseJson: unknown): number | undefined {
  const lhr = getLHRRoot(lighthouseJson);
  const value = getAuditNumericValue(lhr, 'total-blocking-time');
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value >= 0 && value <= LIGHTHOUSE_TBT_SANE_MAX ? value : undefined;
}

/**
 * Collect the warnings of a run: the collector warnings and the Lighthouse
 * run warnings.
 *
 * Both describe the quality of the measurement, so they belong to the same
 * list and the same artifacts.
 */
export function collectRunWarnings(
  lighthouseJson: unknown,
  runWarnings?: string[],
): string[] {
  return buildWarnings(lighthouseJson, runWarnings);
}

/** Collect warnings from multiple sources. */
function buildWarnings(lighthouseJson: unknown, runWarnings?: string[]): string[] {
  const warnings: string[] = [];

  // From the collection run: incomplete traces, failed collectors, missing
  // data. These describe the quality of the run itself.
  for (const warning of runWarnings ?? []) {
    if (typeof warning === 'string' && !warnings.includes(warning)) {
      warnings.push(warning);
    }
  }

  // From LighthouseRawData.warnings (collection-level warnings)
  const raw = lighthouseJson as Record<string, unknown>;
  if (Array.isArray(raw.warnings)) {
    for (const w of raw.warnings) {
      if (typeof w === 'string') warnings.push(w);
    }
  }

  // From LHR runtime warnings
  const lhr = getLHRRoot(lighthouseJson);
  if (Array.isArray(lhr.warnings)) {
    for (const w of lhr.warnings) {
      if (typeof w === 'string') warnings.push(w);
    }
  }

  // Lighthouse 13 reports the run-level problems in `runWarnings`: a page
  // that did not finish loading, a redirect, a failed metric. They decide
  // whether the Lighthouse numbers can be trusted at all.
  if (Array.isArray(lhr.runWarnings)) {
    for (const w of lhr.runWarnings) {
      if (typeof w === 'string') warnings.push(w);
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

interface RecommendationInput {
  lcpMs?: number;
  fcpMs?: number;
  cls?: number;
  tbtMs?: number;
  renderBlocking: Insights['renderBlocking'];
  criticalPath?: Insights['criticalPath'];
  features: FeatureSet;
}

function buildRecommendations(
  input: RecommendationInput,
): Insights['topRecommendations'] {
  const recs: Insights['topRecommendations'] = [];

  const lcpIsImage = input.features.lcpBreakdown?.lcpResourceType?.toLowerCase().includes('image') ?? false;
  const lcpUrl = input.features.lcpBreakdown?.lcpElementUrl ?? '';
  // An inline resource is already in the document — there is nothing to
  // download, preload or re-encode, so image advice would be misleading.
  const lcpIsInline = lcpUrl.startsWith('data:') || lcpUrl.startsWith('blob:');

  // Critical: LCP > 4000ms
  if (input.lcpMs !== undefined && input.lcpMs > 4000) {
    recs.push({
      priority: 'critical',
      title: 'Optimize Largest Contentful Paint',
      action: lcpIsInline
        ? 'Reduce LCP by optimizing server response time, removing render-blocking work, and reducing the LCP element render delay. The LCP element is an inline resource, so there is nothing to download or re-encode.'
        : lcpIsImage
          ? 'Reduce LCP by optimizing server response time, removing render-blocking work, and prioritizing the LCP image.'
          : 'Reduce LCP by optimizing server response time, removing render-blocking work, and reducing the LCP element render delay.',
      evidence: [`LCP: ${input.lcpMs}ms`],
    });
  }

  // Critical: TBT > 600ms
  if (input.tbtMs !== undefined && input.tbtMs > 600) {
    recs.push({
      priority: 'critical',
      title: 'Reduce Total Blocking Time',
      action:
        'Break up long tasks, reduce JavaScript execution time, and consider code splitting.',
      evidence: [`TBT: ${input.tbtMs}ms`],
    });
  }

  // Critical: CLS > 0.25
  if (input.cls !== undefined && input.cls > 0.25) {
    recs.push({
      priority: 'critical',
      title: 'Reduce Cumulative Layout Shift',
      action:
        'Set explicit dimensions on images and embeds, avoid inserting content above existing content.',
      evidence: [`CLS: ${input.cls}`],
    });
  }

  // High: LCP > 2500ms (not already critical)
  if (
    input.lcpMs !== undefined &&
    input.lcpMs > 2500 &&
    input.lcpMs <= 4000
  ) {
    recs.push({
      priority: 'high',
      title: 'Improve LCP to meet 2.5s threshold',
      action:
        'Optimize server response time (TTFB), preload key resources, and optimize the LCP element.',
      evidence: [`LCP: ${input.lcpMs}ms`],
      applicability: 'applicable',
      verification: 'Repeat the same lab run and confirm LCP improves without a regression in CLS.',
    });
  }

  // High: render blocking resources exist
  if (input.renderBlocking.length > 0) {
    const totalWasted = input.renderBlocking.reduce(
      (s, r) => s + (r.wastedMs ?? 0),
      0,
    );
    const evidence: string[] = [
      `${input.renderBlocking.length} render-blocking resources`,
    ];
    // Two different Lighthouse numbers exist and they mean different things:
    // the sum of the per-resource wasted time and the modelled LCP savings.
    // Report them with their meaning instead of one bare number.
    if (totalWasted > 0) {
      evidence.push(`sum of per-resource wasted time: ${totalWasted}ms`);
    }
    const lcpSavings = input.features.renderBlocking?.lcpSavingsMs;
    if (lcpSavings !== undefined) {
      evidence.push(`Lighthouse modelled LCP savings: ${lcpSavings}ms`);
    }
    recs.push({
      priority: 'high',
      title: 'Reduce render-blocking resources',
      action:
        'Defer non-critical CSS and JavaScript, inline critical styles, and use preload for key resources.',
      evidence,
    });
  }

  // High: deep critical chain
  if (input.criticalPath && input.criticalPath.depth > 5) {
    recs.push({
      priority: 'high',
      title: 'Optimize critical request chain',
      action:
        'Reduce sequential network requests by inlining critical resources, using HTTP/2, and preloading key assets.',
      evidence: [`Critical chain depth: ${input.criticalPath.depth}`],
    });
  }

  // Medium: high FCP
  if (input.fcpMs !== undefined && input.fcpMs > 3000) {
    recs.push({
      priority: 'medium',
      title: 'Improve First Contentful Paint',
      action:
        'Reduce server response time and eliminate render-blocking resources above the fold.',
      evidence: [`FCP: ${input.fcpMs}ms`],
    });
  }

  // Medium: third-party overhead
  const tp = input.features.thirdPartyOverhead;
  if (tp && tp.thirdPartyRatio > 0.3) {
    recs.push({
      priority: 'medium',
      title: 'Reduce third-party code overhead',
      action:
        'Audit third-party scripts for necessity, defer non-critical ones, use async loading.',
      evidence: [
        `Third-party ratio: ${(tp.thirdPartyRatio * 100).toFixed(1)}%`,
      ],
    });
  }

  // Medium: many long tasks
  const js = input.features.jsHotspots;
  if (js && js.longTaskCount > 10) {
    recs.push({
      priority: 'medium',
      title: 'Reduce JavaScript long tasks',
      action:
        'Break up JavaScript execution into smaller chunks, use requestIdleCallback, consider web workers.',
      evidence: [`${js.longTaskCount} long tasks detected`],
    });
  }

  return recs.map((rec) => ({
    ...rec,
    applicability: rec.applicability ?? 'applicable',
    verification: rec.verification ?? 'Repeat the same lab run and compare the cited metric before and after the change.',
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a compact Insights structure from extracted features and raw
 * Lighthouse data.
 *
 * The result is designed to be serialized as `insights.toon` (~5-15 KB)
 * and consumed by AI agents for quick performance diagnosis.
 *
 * @param features - Extracted feature set from `extract()`
 * @param lighthouseJson - Raw Lighthouse JSON (LighthouseRawData or plain LHR)
 * @returns A compact Insights structure
 */
export function buildInsights(
  features: FeatureSet,
  lighthouseJson: unknown,
  runWarnings?: string[],
  reportRecommendations?: ReportRecommendation[],
): Insights {
  // 1. Parse Lighthouse insight audits
  const lighthouseInsights = buildLighthouseInsights(lighthouseJson);

  // 2. Lighthouse scores block
  const scores = extractLighthouseScores(lighthouseJson);

  // 3. Navigate to LHR audit container
  const lhr = getLHRRoot(lighthouseJson);
  const lighthouseFetchedAt =
    typeof lhr.fetchTime === 'string' ? lhr.fetchTime : undefined;

  // 4. Metrics from Lighthouse audits
  const lcpAuditMs = getAuditNumericValue(lhr, 'largest-contentful-paint');
  const fcpAuditMs = getAuditNumericValue(lhr, 'first-contentful-paint');
  const clsAudit = getAuditNumericValue(lhr, 'cumulative-layout-shift');
  const tbtAudit = getAuditNumericValue(lhr, 'total-blocking-time');

  // Lab metrics: measured in the traced run described by runContext.
  const lcpMs = features.lcpBreakdown?.totalLCP;
  const lcpSource = features.lcpBreakdown?.valueOrigin;
  const fcpMs = features.coreWebVitals?.fcp ?? fcpAuditMs;
  const cls = features.layoutShifts?.cls ?? clsAudit;

  // TBT: the lab value is the trace measurement, the Lighthouse value is
  // Lighthouse's own audit. They must not overwrite each other.
  //
  // Only a measured TBT is reported. Main-thread busy time is a different
  // signal and must not be presented as TBT when the real metric is
  // unavailable. In headless/automated environments Lighthouse TBT can be
  // wildly inflated (e.g. 151s) due to CDP overhead or browser throttling;
  // treat values above the cap as unavailable instead of substituting busyMs.
  const TBT_SANE_MAX = 60_000; // 60 seconds — anything above is an artifact
  const tbtAuditSane =
    tbtAudit !== undefined && tbtAudit >= 0 && tbtAudit <= TBT_SANE_MAX
      ? tbtAudit
      : undefined;
  const labTbt = features.mainThreadBlocking?.tbtMs;
  const tbtMs =
    labTbt !== undefined && labTbt >= 0 && labTbt <= TBT_SANE_MAX
      ? labTbt
      : undefined;

  // 5. LCP element
  const lcpElement = buildLcpElement(lighthouseInsights, features);

  // 6. Render-blocking resources
  const renderBlocking = buildRenderBlocking(lighthouseInsights, features);

  // 7. Critical path
  const criticalPath = buildCriticalPath(features, lighthouseInsights);

  // 8. Warnings
  const warnings = buildWarnings(lighthouseJson, runWarnings);

  // 9. Recommendations. The report is the authoritative source, so its
  // recommendations are reused when they are available. The metric-driven
  // list is the fallback for a standalone distillation.
  const topRecommendations =
    reportRecommendations && reportRecommendations.length > 0
      ? reportRecommendations
      : buildRecommendations({
          lcpMs,
          fcpMs,
          cls,
          tbtMs,
          renderBlocking,
          criticalPath,
          features,
        });

  return {
    url: features.url ?? '',
    analyzedAt: new Date().toISOString(),
    runContext: features.runContext,
    metrics: {
      lcpMs,
      lcpSource,
      fcpMs,
      cls,
      tbtMs,
      tbtStatus: tbtMs != null ? 'measured' : 'unavailable',
    },
    lighthouse: {
      performance: scores.performance,
      accessibility: scores.accessibility,
      bestPractices: scores.bestPractices,
      seo: scores.seo,
      fetchedAt: lighthouseFetchedAt,
      lcpMs: lcpAuditMs,
      fcpMs: fcpAuditMs,
      cls: clsAudit,
      tbtMs: tbtAuditSane,
      tbtStatus: tbtAuditSane != null ? 'measured' : 'unavailable',
      failedAudits: collectFailedAudits(lhr),
    },
    documentResponse: buildDocumentResponse(features),
    lcpElement,
    renderBlocking,
    criticalPath,
    thirdParty: features.thirdPartyOverhead
      ? { ratio: features.thirdPartyOverhead.thirdPartyRatio, byOwnership: features.thirdPartyOverhead.byOwnership }
      : undefined,
    renderBlockingSources: features.renderBlocking
      ? {
          networkCount: features.renderBlocking.networkResourceCount,
          lighthouseCount: features.renderBlocking.lighthouseResourceCount,
          networkOnlyCount: features.renderBlocking.networkOnlyCount,
          lighthouseOnlyCount: features.renderBlocking.lighthouseOnlyCount,
        }
      : undefined,
    warnings,
    dataQuality: assessDataQuality(features, {
      tbtMs,
      lighthouseTbtMs: tbtAuditSane,
      runWarnings,
    }),
    topRecommendations,
  };
}
