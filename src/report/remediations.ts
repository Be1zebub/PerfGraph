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
    ttfbParts?: { dns: number; connect: number; ssl: number; proxy: number; wait: number };
  };
  /** The issue's value/metric for context (e.g. TTFB=1200) */
  value?: number;
  /** Unit label for the value */
  unit?: string;
  /** Node type for fallback lookup (metric, bottleneck, impact) */
  nodeType?: string;
  /** Rule ID for fallback lookup by prefix */
  ruleId?: string;
  /** Resource kind of the LCP element, used to avoid image-only advice for text. */
  lcpResourceType?: string;
  /** URL of the LCP resource, used to detect inline resources with nothing to download. */
  lcpElementUrl?: string;
}

// ---------------------------------------------------------------------------
// Remediation lookup
// ---------------------------------------------------------------------------

/** LCP threshold in ms — above it the LCP is a finding */
const LCP_WARN_MS = 2_500;

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
  'lh-forced-reflow':
    'A forced reflow means the script reads a layout property after changing ' +
    'the DOM, so the browser has to lay out again. Batch the DOM changes and ' +
    'read the layout once at the end.',
  'lh-image-delivery':
    'The images are larger than they need to be. Serve modern formats, size ' +
    'them to the rendered dimensions, and keep them off the critical path.',
  'lh-cache':
    'The static resources are fetched again on every visit. Give them a ' +
    'long-lived Cache-Control, and let the CDN serve them.',
  'lh-duplicated-javascript':
    'The same JavaScript is delivered more than once. Bundle the modules ' +
    'that are loaded by several routes into one.',
  'lh-legacy-javascript':
    'The bundle still contains legacy JavaScript that has to be transpiled ' +
    'and polyfilled. Target modern browsers and drop the transforms.',
  'lh-font-display':
    'The fonts block the text while they load. Use font-display: swap or ' +
    'optional, and preload the font that is used above the fold.',
  'lh-cls-culprits':
    'Give the elements that move explicit dimensions, so their space is ' +
    'reserved before the content arrives.',
  'lh-impact-forced-reflow':
    'The forced reflow is avoidable work on the page.',
  'lh-impact-image-delivery':
    'The oversized images are avoidable work on the page.',
  'lh-impact-cache':
    'The uncached resources are avoidable work on the page.',
  'lh-impact-duplicated-javascript':
    'The duplicated JavaScript is avoidable work on the page.',
  'lh-impact-legacy-javascript':
    'The legacy JavaScript is avoidable work on the page.',
  'lh-impact-font-display':
    'The font loading is avoidable work on the page.',
  'lh-impact-cls-culprits':
    'The layout shifts are avoidable work on the page.',
  'bandwidth-contention':
    'Reduce bandwidth contention: prioritise critical resources (preload), ' +
    'defer non-critical ones (lazy load, async/defer), use HTTP/2.',
  'document-chain':
    'Serve the final URL directly. The browser loaded a document and then ' +
    'navigated away from it, so the visitor paid for a response they never saw.',
  'discarded-document':
    'Remove the redirect: answer the first request with the final page ' +
    '(or redirect in the server response instead of loading a document that ' +
    'is thrown away).',
  'delayed-by-document-chain':
    'The document chain delays the content: serve the final URL directly.',

  // ---- JS rules ----
  'high-main-thread-blocking':
    'Reduce main thread blocking: break up long tasks (<50ms), use ' +
    'Web Workers for background computation, remove heavy polyfills.',
  'high-tbt':
    'Use Lighthouse "Reduce JavaScript execution time" for precise recommendations. ' +
    'Optimise heavy scripts, remove dead code (tree shaking).',
  'main-thread-contention':
    'Main-thread busy time is not TBT. Capture a valid TBT or long-task metric, ' +
    'then profile and defer non-critical JavaScript before making a remediation claim.',
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
      const parts = context.evidence?.ttfbParts;
      if (parts) {
        const setup = parts.dns + parts.connect + parts.ssl + parts.proxy;
        // Most of a slow TTFB is connection setup, not server processing.
        // Blaming the backend in that case sends the user to the wrong place.
        if (setup > parts.wait) {
          const proxy = parts.proxy > 0 ? `, proxy ${Math.round(parts.proxy)}ms` : '';
          return `TTFB is ${Math.round(context.value)}ms, but only ${Math.round(parts.wait)}ms was server wait — ${Math.round(setup)}ms went into connection setup (DNS ${Math.round(parts.dns)}ms, TCP ${Math.round(parts.connect)}ms, TLS ${Math.round(parts.ssl)}ms${proxy}). Check the distance to the PoP, DNS resolution, the proxy and the TLS handshake before touching server code.`;
        }
        return `TTFB is ${Math.round(context.value)}ms, of which ${Math.round(parts.wait)}ms is server wait. Reduce server response time: cache the response, move the origin closer to visitors, and remove slow middleware.`;
      }
      return `Reduce TTFB (${Math.round(context.value)}ms): cache the response at the edge, keep connections warm, and remove slow middleware.`;
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
      // The node is only a finding when the LCP exceeds the threshold. Below
      // it, the chain is about the upstream delay, and saying "LCP is high"
      // would contradict the node it belongs to.
      if (context.value <= LCP_WARN_MS) {
        return `LCP is ${Math.round(context.value)}ms, within the ${LCP_WARN_MS}ms threshold. The finding of this chain is the upstream delay, not the LCP itself.`;
      }
      const url = context.lcpElementUrl ?? '';
      // An inline resource is already in the document: there is nothing to
      // download, preload or re-encode.
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return `LCP is high (${context.value}ms) and the LCP element is an inline resource, so there is nothing to download or re-encode. Reduce the render delay instead: main-thread work, blocking styles and scripts before the first paint.`;
      }
      if (context.lcpResourceType && !context.lcpResourceType.toLowerCase().includes('image')) {
        return `LCP is high (${context.value}ms) and the LCP element is not an image. Reduce render delay, main-thread work, and blocking styles/scripts instead of applying image optimization advice.`;
      }
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
