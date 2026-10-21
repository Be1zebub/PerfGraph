/**
 * JavaScript / Main Thread causal rules.
 *
 * Chains covered:
 *   1. Long main thread blocking → high TBT → delayed INP
 *   2. Excessive JS → long parse time → main thread contention
 *   3. JS execution hotspots → long tasks → blocking
 *
 * @packageDocumentation
 */

import type { FeatureSet } from '../../extract/types.js';
import type { Confidence, CausalNode, CausalEdge, Evidence } from '../types.js';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const TBT_WARN = 200; // ms
const TBT_CRIT = 600; // ms
const LONG_TASK_WARN = 5;
const LONG_TASK_CRIT = 15;
const BOOTUP_WARN = 2_000; // ms total JS bootup time
const BOOTUP_CRIT = 5_000;
const EVALUATED_SCRIPTS_WARN = 50;
const EVALUATED_SCRIPTS_CRIT = 150;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceFromDelta(
  value: number,
  warn: number,
  crit: number,
): Confidence {
  if (value >= crit) return 'strong';
  if (value >= warn) return 'medium';
  return 'weak';
}

// ---------------------------------------------------------------------------
// Rule 1: Main thread blocking → TBT → INP
// ---------------------------------------------------------------------------

export const tbtInpChain = {
  id: 'js-tbt-inp-chain',
  label: 'Main thread blocking → high TBT → delayed INP',

  applies(features: FeatureSet): boolean {
    const mt = features.mainThreadBlocking;
    if (mt == null) return false;
    // A measured TBT above the threshold is enough on its own. Requiring the
    // busy ratio as well meant a page with 1.8 s of blocking never produced
    // this chain, and its strongest signal was missing from the report.
    if (mt.tbtMs != null && mt.tbtMs > TBT_WARN) return true;
    return mt.blockingScore > 0.3;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const mt = features.mainThreadBlocking!;
    const busyMs = mt.busyMs;
    const tbtMs = mt.tbtMs;
    const conf = confidenceFromDelta(busyMs, 300, 1000);

    const mtbEvidence: Evidence = {
      metric: {
        name: 'Main thread busy time',
        value: busyMs,
        unit: 'ms',
        source: 'trace',
        method: 'Trace main-thread activity total',
      },
    };

    const nodes: CausalNode[] = [
      {
        id: 'high-main-thread-blocking',
        label: `Main thread blocked (${Math.round(busyMs)}ms)`,
        type: 'metric',
        severity: busyMs >= 1000 ? 'critical' : busyMs >= 300 ? 'warning' : 'info',
        value: busyMs,
        unit: 'ms',
        threshold: 300,
        evidence: mtbEvidence,
      },
    ];

    const edges: CausalEdge[] = [];

    if (tbtMs != null) {
      nodes.push({
        id: 'high-tbt',
        label: 'High Total Blocking Time',
        type: 'bottleneck',
        severity: tbtMs >= TBT_CRIT ? 'critical' : 'warning',
        value: tbtMs,
        unit: 'ms',
        threshold: TBT_WARN,
        evidence: {
          metric: { name: 'Total Blocking Time', value: tbtMs, unit: 'ms' },
        },
      });
      nodes.push({
        id: 'delayed-inp-tbt',
        label: 'Possible INP delay (blocking time)',
        type: 'impact',
        severity: 'warning',
      });
      edges.push(
        {
          source: 'high-main-thread-blocking',
          target: 'high-tbt',
          confidence: confidenceFromDelta(tbtMs, TBT_WARN, TBT_CRIT),
          label: 'Measured main-thread activity is consistent with TBT',
          ruleId: 'js-tbt-inp-chain',
        },
        {
          source: 'high-tbt',
          target: 'delayed-inp-tbt',
          confidence: 'medium',
          label: 'High TBT may delay input processing',
          ruleId: 'js-tbt-inp-chain',
        },
      );
    } else {
      nodes.push({
        id: 'main-thread-contention',
        label: 'Main-thread contention signal (TBT unavailable)',
        type: 'bottleneck',
        severity: busyMs >= 1000 ? 'critical' : 'warning',
        value: busyMs,
        unit: 'ms',
        threshold: 300,
      });
      edges.push({
        source: 'high-main-thread-blocking',
        target: 'main-thread-contention',
        confidence: conf,
        label: 'Busy main-thread time indicates contention',
        ruleId: 'js-tbt-inp-chain',
      });
    }

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Rule 2: JS execution hotspots → long tasks
// ---------------------------------------------------------------------------

export const jsHotspotsChain = {
  id: 'js-hotspots-long-tasks-chain',
  label: 'JS execution hotspots → long tasks',

  applies(features: FeatureSet): boolean {
    const js = features.jsHotspots;
    return js != null && js.longTaskCount >= LONG_TASK_WARN;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const js = features.jsHotspots!;
    const conf = confidenceFromDelta(js.longTaskCount, LONG_TASK_WARN, LONG_TASK_CRIT);

    const hotspotsEvidence: Evidence = {
      metric: { name: 'Long tasks', value: js.longTaskCount, unit: 'count' },
    };

    const nodes: CausalNode[] = [
      {
        id: 'js-hotspots',
        label: `${js.longTaskCount} long JS tasks`,
        type: 'metric',
        severity: js.longTaskCount >= LONG_TASK_CRIT ? 'critical' : 'warning',
        value: js.longTaskCount,
        threshold: LONG_TASK_WARN,
        evidence: hotspotsEvidence,
      },
      {
        id: 'long-tasks-js',
        label: 'Long tasks on main thread',
        type: 'bottleneck',
        severity: 'warning',
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'js-hotspots',
        target: 'long-tasks-js',
        confidence: conf,
        label: 'JS hotspots create long tasks (>50ms)',
        ruleId: 'js-hotspots-long-tasks-chain',
      },
    ];

    // If there's a max blocking duration, add an edge to delayed-inp
    if (js.maxBlockingDuration > 50) {
      nodes.push({
        id: 'delayed-inp-hotspots',
        label: 'Possible INP delay (long tasks)',
        type: 'impact',
        severity: 'warning',
      });
      edges.push({
        source: 'long-tasks-js',
        target: 'delayed-inp-hotspots',
        confidence: 'medium',
        label: 'Long tasks delay user input processing',
        ruleId: 'js-hotspots-long-tasks-chain',
      });
    }

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Rule 3: Excessive scripts → parse time
// ---------------------------------------------------------------------------

export const excessiveScriptsChain = {
  id: 'js-excessive-scripts-chain',
  label: 'Many scripts → long parse time → main thread contention',

  applies(features: FeatureSet): boolean {
    const js = features.jsHotspots;
    return js != null && (js.scriptCount ?? 0) >= EVALUATED_SCRIPTS_WARN;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const js = features.jsHotspots!;
    const scriptCount = js.scriptCount ?? 0;
    const compileTimeMs = js.compileTimeMs ?? 0;
    const conf = confidenceFromDelta(scriptCount, EVALUATED_SCRIPTS_WARN, EVALUATED_SCRIPTS_CRIT);
    const isHeavy = compileTimeMs >= BOOTUP_CRIT;

    const nodes: CausalNode[] = [
      {
        id: 'many-scripts',
        label: `${scriptCount} scripts`,
        type: 'metric',
        severity: isHeavy ? 'critical' : 'warning',
        value: scriptCount,
        threshold: EVALUATED_SCRIPTS_WARN,
        impactSurface: 'total-page',
      },
      {
        id: 'long-parse-time',
        label: `Long parse/compile time (${Math.round(compileTimeMs)}ms)`,
        type: 'bottleneck',
        severity: 'warning',
        value: compileTimeMs,
        unit: 'ms',
        threshold: BOOTUP_WARN,
        impactSurface: 'total-page',
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'many-scripts',
        target: 'long-parse-time',
        confidence: conf,
        label: 'Large number of scripts increases total parse and compile time',
        ruleId: 'js-excessive-scripts-chain',
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Aggregated
// ---------------------------------------------------------------------------

export const jsRules = [
  tbtInpChain,
  jsHotspotsChain,
  excessiveScriptsChain,
];
