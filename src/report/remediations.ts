/**
 * Remediation texts — lookup table of human-readable recommendations
 * keyed by node ID or node type / rule ID patterns.
 *
 * Each entry is a plain-English suggestion for fixing the issue.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Remediation context — optional evidence payload passed to getRemediation
// ---------------------------------------------------------------------------

export interface RemediationContext {
  /** Evidence payload (URLs, selector, lighthouse audit, metric) */
  evidence?: {
    urls?: string[];
    selector?: string;
    lighthouseAuditId?: string;
    metric?: { name: string; value: number; unit: string };
  };
  /** The issue's value/metric for context (e.g. TTFB=1200) */
  value?: number;
  /** Unit label for the value */
  unit?: string;
  /** Node type for fallback lookup (metric, bottleneck, impact) */
  nodeType?: string;
  /** Rule ID for fallback lookup by prefix */
  ruleId?: string;
}

// ---------------------------------------------------------------------------
// Remediation lookup
// ---------------------------------------------------------------------------

type RemediationKey = string; // node ID or "type:ruleId" pattern

const REMEDIATIONS: Record<RemediationKey, string> = {
  // ---- LCP rules ----
  'high-ttfb':
    'Optimise TTFB: use a CDN, enable server-side caching, ' +
    'move static assets to the edge, optimise server logic (fastify/compression). ' +
    'Target: TTFB < 800ms.',
  'delayed-html-parse':
    'Ensure HTML is streamed without delay — enable chunked transfer encoding, ' +
    'remove blocking middleware on the server.',
  'delayed-css-discovery':
    'Inline critical CSS in <head>, load non-critical CSS asynchronously ' +
    'via <link rel="preload" as="style" ...> + onload=this.rel="stylesheet".',
  'blocked-render':
    'Eliminate render-blocking resources: inline critical CSS, async/defer for JS, ' +
    'preconnect to third-party origins.',
  'increased-lcp':
    'Optimise LCP: ensure the LCP element loads early, use modern image formats ' +
    '(WebP/AVIF) with correct dimensions, ' +
    'add fetchpriority="high" on the LCP image.',
  'rb-resources':
    'Reduce the number of render-blocking resources: inline critical CSS, ' +
    'defer non-critical CSS via media="print" onload, use async/defer for scripts.',
  'blocked-render-rb':
    'Analyse the render-blocking resource chain in DevTools (Performance → View: KPI Warning). ' +
    'Move non-critical CSS/JS off the critical path.',
  'increased-lcp-rb':
    'Use Lighthouse "Eliminate render-blocking resources" for precise recommendations. ' +
    'Consider code splitting and lazy loading for non-critical scripts.',
  'lcp-resource-delay':
    'Optimise LCP resource loading: use preload <link rel="preload"> for the LCP image, ' +
    'set fetchpriority="high", optimise the resource itself (compression, modern formats).',
  'increased-lcp-resource':
    'Check that the LCP resource is not blocked by other loads. ' +
    'Use HTTP/2 Server Push (with caution) or early preload.',

  // ---- Network rules ----
  'deep-critical-chain':
    'Reduce critical chain depth: bundle scripts, use code splitting, ' +
    'lazy-load non-critical resources. A Webpack/Rollup bundle analyser helps find optimisations.',
  'waterfall-delay':
    'Analyse the load waterfall in DevTools (Network → Waterfall). ' +
    'Eliminate sequential loads, use preload/preconnect ' +
    'for critical resources.',
  'slow-page-load':
    'General slow page load: use Lighthouse to prioritise improvements. ' +
    'Focus on TTFB, render-blocking resources, image optimisation, and JS bundle size.',
  'excessive-requests':
    'Reduce the number of requests on the critical path: bundle files, use ' +
    'sprites/SVG, HTTP/2 multiplexing, tree shaking, code splitting.',
  'bandwidth-contention':
    'Reduce bandwidth contention: prioritise critical resources (preload), ' +
    'defer non-critical ones (lazy load, async/defer), use HTTP/2.',

  // ---- JS rules ----
  'high-main-thread-blocking':
    'Reduce main thread blocking: break up long tasks (<50ms), use ' +
    'Web Workers for background computation, remove heavy polyfills.',
  'high-tbt':
    'Use Lighthouse "Reduce JavaScript execution time" for precise recommendations. ' +
    'Optimise heavy scripts, remove dead code (tree shaking).',
  'delayed-inp-tbt':
    'INP may be high due to long tasks: break tasks into 50ms chunks with ' +
    'setTimeout(yield) or scheduler.postTask(). Use Browser Timeline to find culprits.',
  'js-hotspots':
    'Profile JS hotspots in DevTools (Performance → Main thread). ' +
    'Optimise hot functions, use debounce/throttle for frequent handlers.',
  'long-tasks-js':
    'Long tasks block the main thread and delay interaction: ' +
    'break into micro-tasks, use Web Workers, optimise rendering.',
  'delayed-inp-hotspots':
    'Improve INP: use passive event listeners, eliminate scroll jank, ' +
    'optimise animations via requestAnimationFrame.',
  'many-scripts':
    'Reduce the number of scripts: bundle modules, use code splitting, ' +
    'tree shaking, remove unused dependencies.',
  'long-parse-time':
    'Long JS parse/compile time: use code splitting, lazy loading, ' +
    'remove unused code. Modern bundlers (esbuild/swc) reduce compilation time.',

  // ---- Layout rules ----
  'layout-shifts':
    'Fix layout shifts: set explicit dimensions (width/height) on images and iframes, ' +
    'use aspect-ratio CSS, reserve space for dynamic content.',
  'high-cls':
    'Use Lighthouse "Avoid large layout shifts" for precise recommendations. ' +
    'Inline critical CSS, avoid inserting content above existing content (insertBefore).',
  'layout-shift-clusters':
    'Shift clusters indicate dynamic content insertion problems: ' +
    'use CSS contain, reserve space, avoid DOM mutations above visible content.',
  'complex-dom-tree':
    'DOM tree is too complex: reduce nesting, use simpler semantic ' +
    'markup, virtualise large lists (Virtual Scroller).',
  'layout-instability':
    'Use CSS contain: layout to isolate each component. ' +
    'This limits layout recalculation scope on changes.',
};

// Fallback by node type
const TYPE_FALLBACKS: Record<string, string> = {
  metric:
    'Analyse this metric against your project baseline. ' +
    'Target compliance with Google Core Web Vitals.',
  bottleneck:
    'Eliminate this bottleneck: it may cascade into other metric regressions.',
  impact:
    'This metric indicates a negative impact on user experience. ' +
    'Fix the root causes listed in the dependency chain.',
};

// Fallback by rule ID prefix
const RULE_FALLBACKS: Record<string, string> = {
  lcp: 'Check Lighthouse recommendations for Largest Contentful Paint improvements (Performance → LCP).',
  net: 'Optimise network resource loading: reduce request count, ' +
    'use HTTP/2, preload critical resources.',
  js: 'Optimise JavaScript: reduce bundle size, use code splitting, ' +
    'remove dead code, break up long tasks.',
  layout: 'Stabilise the layout: set element dimensions, avoid unexpected ' +
    'content insertion, use CSS contain.',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get remediation text for an issue by its ID, with optional evidence context
 * to produce parameterized, specific guidance.
 *
 * When `context` provides evidence (URLs, metric values), the returned text
 * includes those details. Without context, falls back to static boilerplate
 * then to rule-prefix and node-type fallbacks.
 *
 * @param issueId - The issue / node ID to remediate
 * @param context - Optional evidence, values, and fallback hints
 */
export function getRemediation(
  issueId: string,
  context?: RemediationContext,
): string {
  // ---- Parameterized remediations (evidence-aware) ----
  if (context) {
    // Render-blocking resources with specific URLs
    if (issueId === 'rb-resources' && context.evidence?.urls && context.evidence.urls.length > 0) {
      const urls = context.evidence.urls.join(', ');
      return `Render-blocking resources: ${urls}. Consider inlining critical CSS, deferring non-critical stylesheets, and adding preload hints.`;
    }

    // TTFB with measured value
    if (issueId === 'high-ttfb' && context.value != null) {
      return `High TTFB (${context.value}ms). Optimize server response time: use CDN, enable caching, upgrade hosting, or move server closer to users.`;
    }

    // Deep critical chain with URLs
    if (issueId === 'deep-critical-chain' && context.evidence?.urls && context.evidence.urls.length > 0) {
      return `Deep critical chain (${context.value ?? '?'} levels): ${context.evidence.urls.join(' → ')}. Optimize dependency ordering and lazy-load non-critical resources.`;
    }

    // Layout shifts with CLS value
    if (issueId === 'layout-shifts' && context.value != null) {
      return `Layout shifts detected (CLS: ${context.value.toFixed(3)}). Ensure all elements have explicit dimensions, avoid inserting content above existing content.`;
    }

    // CLS with value
    if (issueId === 'high-cls' && context.value != null) {
      return `High CLS (${context.value.toFixed(3)}). Use Lighthouse "Avoid large layout shifts" for precise recommendations. Inline critical CSS, avoid inserting content above existing content (insertBefore).`;
    }

    // Main thread blocking with value
    if (issueId === 'high-main-thread-blocking' && context.value != null) {
      return `High main thread blocking (${context.value}ms). Break up long tasks, defer non-critical JavaScript, use web workers for heavy computation.`;
    }

    // Render-blocking chain with URLs
    if (issueId === 'rb-chain' && context.evidence?.urls && context.evidence.urls.length > 0) {
      const urls = context.evidence.urls.join(', ');
      return `Render-blocking chain: ${urls}. Analyse the waterfall in DevTools (Performance → View: KPI Warning). Move unused CSS/JS off the critical path.`;
    }

    // Render-blocking LCP with URLs
    if (issueId === 'render-blocking-lcp' && context.evidence?.urls && context.evidence.urls.length > 0) {
      const urls = context.evidence.urls.join(', ');
      return `Render-blocking resources delaying LCP: ${urls}. Use Lighthouse "Eliminate render-blocking resources" for precise recommendations. Consider code splitting and lazy loading for non-critical scripts.`;
    }

    // Increased LCP with value
    if (issueId === 'increased-lcp' && context.value != null) {
      return `LCP is high (${context.value}ms). Optimise the LCP element: ensure it loads early, use modern image formats (WebP/AVIF) with correct dimensions, add fetchpriority="high" on the LCP image.`;
    }

    // High TBT with value
    if (issueId === 'high-tbt' && context.value != null) {
      return `High Total Blocking Time (${context.value}ms). Use Lighthouse "Reduce JavaScript execution time" for precise recommendations. Optimise heavy scripts, remove dead code (tree shaking).`;
    }

    // Waterfall delay with URLs
    if (issueId === 'waterfall-delay' && context.evidence?.urls && context.evidence.urls.length > 0) {
      const urls = context.evidence.urls.join(', ');
      return `Sequential waterfall detected: ${urls}. Analyse the Network waterfall in DevTools, use preload/preconnect for critical resources.`;
    }
  }

  // ---- Static exact match ----
  if (REMEDIATIONS[issueId]) {
    return REMEDIATIONS[issueId]!;
  }

  // ---- Rule-based fallback ----
  const ruleId = context?.ruleId;
  if (ruleId) {
    for (const [prefix, text] of Object.entries(RULE_FALLBACKS)) {
      if (ruleId.startsWith(prefix)) {
        return text;
      }
    }
  }

  // ---- Type-based fallback ----
  const nodeType = context?.nodeType;
  if (nodeType && TYPE_FALLBACKS[nodeType]) {
    return TYPE_FALLBACKS[nodeType]!;
  }

  return 'Diagnose the issue with Chrome DevTools (Performance → Measure → Reload) ' +
    'and follow Lighthouse recommendations.';
}