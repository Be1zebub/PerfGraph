/**
 * Agent-optimized summary layer that fuses Lighthouse insights,
 * extracted features, and evidence data into a compact Insights structure.
 *
 * The result can be serialized to `insights.toon` (~5-15 KB for a typical SPA).
 *
 * @packageDocumentation
 */

import type { FeatureSet } from '../extract/types.js';
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
    lcpSource?: 'trace' | 'lighthouse';
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
    lcpMs?: number;
    fcpMs?: number;
    cls?: number;
    tbtMs?: number;
    tbtStatus?: 'measured' | 'unavailable';
  };
  lcpElement?: {
    selector: string;
    snippet?: string;
    nodeLabel?: string;
    source?: 'trace' | 'performance-api' | 'lighthouse';
    type?: 'text' | 'image' | 'unknown';
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
  };
  warnings: string[];
  dataQuality?: {
    status: 'complete' | 'partial';
    warnings: string[];
  };
  topRecommendations: Array<{
    priority: 'critical' | 'high' | 'medium';
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

function buildDataQuality(features: FeatureSet, tbtMs?: number): Insights['dataQuality'] {
  const warnings: string[] = [];
  if (features.lcpBreakdown == null) warnings.push('LCP breakdown is unavailable.');
  if (features.layoutShifts == null) warnings.push('Layout-shift data is unavailable.');
  if (features.mainThreadBlocking == null) {
    warnings.push('Main-thread data is unavailable.');
  } else if (tbtMs == null) {
    warnings.push('Measured TBT is unavailable; busyMs is not used as a TBT substitute.');
  }
  if (features.renderBlocking?.sourceConflict) {
    warnings.push('Network and Lighthouse render-blocking counts differ; verify both source lists before attributing LCP impact.');
  }
  const criticalPath = features.criticalPath;
  if (criticalPath?.pageLifecycleMs != null && criticalPath.aggregateRequestDurationMs > criticalPath.pageLifecycleMs * 2) {
    warnings.push('Aggregate request duration exceeds page lifecycle; interpret it as parallel work rather than user wait time.');
  }
  return {
    status: warnings.length > 0 ? 'partial' : 'complete',
    warnings,
  };
}

/** Navigate to the LHR root — handles { lhr: {...} } wrapper used by LighthouseRawData. */
function getLHRRoot(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.lhr)) return raw.lhr;
  return raw;
}

/** Extract numericValue from a Lighthouse audit by ID. */
function getAuditNumericValue(
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
function extractScores(raw: unknown): {
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

  const selector = lb?.lcpElementSelector ?? featureElement?.selector ?? '';
  const nodeLabel = lb?.lcpElementNodeLabel ?? featureElement?.nodeLabel;

  if (!selector && !nodeLabel) return undefined;

  return {
    selector,
    snippet: lb?.lcpElementSnippet ?? featureElement?.snippet,
    nodeLabel,
    source: lb?.lcpElementSelector ? 'lighthouse' : featureElement?.source,
    type: featureElement?.type,
    renderDelayMs: lb?.elementRenderDelay,
    resourceLoadDelayMs: features.lcpBreakdown?.resourceLoadDelay,
    resourceLoadTimeMs: features.lcpBreakdown?.resourceLoadTime,
    ttfbMs: lb?.timeToFirstByte,
  };
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

  return {
    depth: cp?.deepestChainDepth ?? 0,
    longestChainMs: cp?.elapsedCriticalPathMs ?? ndt?.longestChainDuration ?? cp?.longestSingleRequest,
    elapsedCriticalPathMs: cp?.elapsedCriticalPathMs,
    aggregateRequestDurationMs: cp?.aggregateRequestDurationMs,
    pageLifecycleMs: cp?.pageLifecycleMs,
    tree,
  };
}

/** Collect warnings from multiple sources. */
function buildWarnings(lighthouseJson: unknown): string[] {
  const warnings: string[] = [];

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

  // Critical: LCP > 4000ms
  if (input.lcpMs !== undefined && input.lcpMs > 4000) {
    recs.push({
      priority: 'critical',
      title: 'Optimize Largest Contentful Paint',
      action: lcpIsImage
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
    if (totalWasted > 0) {
      evidence.push(`Potential savings: ${totalWasted}ms`);
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
): Insights {
  // 1. Parse Lighthouse insight audits
  const lighthouseInsights = buildLighthouseInsights(lighthouseJson);

  // 2. Lighthouse scores block
  const scores = extractScores(lighthouseJson);

  // 3. Navigate to LHR audit container
  const lhr = getLHRRoot(lighthouseJson);

  // 4. Metrics from Lighthouse audits
  const lcpAuditMs = getAuditNumericValue(lhr, 'largest-contentful-paint');
  const fcpAuditMs = getAuditNumericValue(lhr, 'first-contentful-paint');
  const clsAudit = getAuditNumericValue(lhr, 'cumulative-layout-shift');
  const tbtAudit = getAuditNumericValue(lhr, 'total-blocking-time');

  // Lab metrics: measured in the traced run described by runContext.
  const lcpMs = features.lcpBreakdown?.totalLCP;
  const lcpSource = lcpMs !== undefined
    ? 'trace'
    : lighthouseInsights.lcpBreakdown
      ? 'lighthouse'
      : undefined;
  const fcpMs = features.coreWebVitals?.fcp ?? fcpAuditMs;
  const cls = features.layoutShifts?.cls ?? clsAudit;

  // TBT: use only a measured Lighthouse/IR TBT value. Main-thread busy time is
  // a different signal and must not be presented as TBT when the real metric is
  // unavailable. In headless/automated environments Lighthouse TBT can be
  // wildly inflated (e.g. 151s) due to CDP overhead or browser throttling;
  // treat values above the cap as unavailable instead of substituting busyMs.
  const TBT_SANE_MAX = 60_000; // 60 seconds — anything above is an artifact
  const tbtMs =
    tbtAudit !== undefined && tbtAudit >= 0 && tbtAudit <= TBT_SANE_MAX
      ? tbtAudit
      : features.mainThreadBlocking?.tbtMs !== undefined &&
          features.mainThreadBlocking.tbtMs >= 0 &&
          features.mainThreadBlocking.tbtMs <= TBT_SANE_MAX
        ? features.mainThreadBlocking.tbtMs
        : undefined;

  // 5. LCP element
  const lcpElement = buildLcpElement(lighthouseInsights, features);

  // 6. Render-blocking resources
  const renderBlocking = buildRenderBlocking(lighthouseInsights, features);

  // 7. Critical path
  const criticalPath = buildCriticalPath(features, lighthouseInsights);

  // 8. Warnings
  const warnings = buildWarnings(lighthouseJson);

  // 9. Data-driven recommendations
  const topRecommendations = buildRecommendations({
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
      lcpMs: lcpAuditMs,
      fcpMs: fcpAuditMs,
      cls: clsAudit,
      tbtMs: tbtAudit,
      tbtStatus: tbtAudit != null ? 'measured' : 'unavailable',
    },
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
    dataQuality: buildDataQuality(features, tbtMs),
    topRecommendations,
  };
}
