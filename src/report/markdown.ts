/**
 * Markdown report generator — produces a human-readable performance report
 * from a PerfGraph {@link Report} and optional {@link Insights}.
 *
 * The output is designed for direct consumption by developers and includes
 * score summary, all issues with severities, causal chains, recommendations,
 * and Lighthouse insights when available.
 *
 * @packageDocumentation
 */

import type { Report } from './types.js';
import type { Insights } from '../distill/insights.js';

// ---------------------------------------------------------------------------
// Severity → emoji helpers
// ---------------------------------------------------------------------------

function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'warning':
      return '🟡';
    case 'high':
      return '🟡';
    case 'info':
      return '🔵';
    default:
      return '⚪';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable markdown report from a PerfGraph Report + Insights.
 *
 * @param report - The structured report from `buildReport()`
 * @param insights - Optional Lighthouse-derived insights from `buildInsights()`
 * @returns A formatted Markdown string
 */
export function buildReportMarkdown(
  report: Report,
  insights?: Insights,
): string {
  const lines: string[] = [];

  // -----------------------------------------------------------------------
  // Header
  // -----------------------------------------------------------------------
  lines.push('# PerfGraph Performance Report');
  lines.push('');
  lines.push(`**URL:** ${report.meta.url}`);
  lines.push(`**Analyzed at:** ${report.meta.analyzedAt}`);
  lines.push(`**Score:** ${report.summary.score.toUpperCase()}`);
  if (report.summary.lighthousePerformance != null) {
    lines.push(
      `**Lighthouse Performance:** ${(report.summary.lighthousePerformance * 100).toFixed(0)}/100`,
    );
  }
  if (report.summary.scoreExplanation) {
    lines.push(`**Note:** ${report.summary.scoreExplanation}`);
  }
  lines.push('');

  // -----------------------------------------------------------------------
  // Data quality
  // -----------------------------------------------------------------------
  // A warning here can invalidate the numbers above, so it comes before them.
  const quality = report.summary.dataQuality;
  if (quality && quality.warnings.length > 0) {
    lines.push('## Data quality');
    lines.push('');
    lines.push(`Status: ${quality.status}`);
    lines.push('');
    for (const warning of quality.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  // -----------------------------------------------------------------------
  // Summary stats
  // -----------------------------------------------------------------------
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Critical issues | ${report.summary.criticalIssues} |`);
  lines.push(`| Warnings | ${report.summary.warnings} |`);
  lines.push(`| Info | ${report.summary.infos} |`);
  lines.push('');
  // The data-quality section is printed at the top of the report, where a
  // warning can invalidate the numbers that follow.

  // -----------------------------------------------------------------------
  // Top Issues
  // -----------------------------------------------------------------------
  if (report.summary.topIssues.length > 0) {
    lines.push('## Top Issues');
    lines.push('');
    for (const issue of report.summary.topIssues) {
      lines.push(`### ${severityBadge(issue.severity)} ${issue.label}`);
      lines.push('');
      lines.push(`- **Confidence:** ${issue.confidence}`);
      lines.push('');
    }
  }

  // -----------------------------------------------------------------------
  // All Issues
  // -----------------------------------------------------------------------
  if (report.issues.length > 0) {
    lines.push('## All Issues');
    lines.push('');
    for (const issue of report.issues) {
      lines.push(
        `### ${severityBadge(issue.severity)} ${issue.label}`,
      );
      lines.push('');
      lines.push(`**ID:** \`${issue.id}\``);
      lines.push(`**Severity:** ${issue.severity}`);
      lines.push(`**Finding status:** ${issue.findingStatus}`);
      lines.push(`**Basis:** ${issue.basis}`);
      lines.push(`**Impact surface:** ${issue.impactSurface}`);
      if (issue.value != null) {
        lines.push(
          `**Value:** ${issue.value}${issue.unit ? ` ${issue.unit}` : ''}`,
        );
      }
      if (issue.evidence?.urls && issue.evidence.urls.length > 0) {
        lines.push('**URLs:**');
        for (const url of issue.evidence.urls) {
          lines.push(`- \`${url}\``);
        }
      }
      if (issue.evidence?.selector) {
        lines.push(`**Selector:** \`${issue.evidence.selector}\``);
      }
      lines.push('');
      lines.push(issue.remediation);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // -----------------------------------------------------------------------
  // Causal Chains
  // -----------------------------------------------------------------------
  if (report.chains.length > 0) {
    lines.push('## Causal Chains');
    lines.push('');
    for (const chain of report.chains) {
      lines.push(
        `### ${severityBadge(chain.severity)} ${chain.rootCause}`,
      );
      lines.push('');
      lines.push(`**Impact:** ${chain.impact}`);
      lines.push(`**Confidence:** ${chain.confidence}`);
      lines.push(`**Finding statuses:** ${chain.path.map((n) => n.findingStatus).join(', ')}`);
      lines.push(
        `**Path:** \`${chain.path.map((n) => n.label).join(' → ')}\``,
      );
      if (chain.relations?.some((relation) => relation.findingStatus === 'suspected')) {
        lines.push('**Causal qualification:** This chain contains inferred relationships; treat them as hypotheses to verify.');
      }
      lines.push('');
    }
  }

  // -----------------------------------------------------------------------
  // Recommendations
  // -----------------------------------------------------------------------
  if (report.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      const badge = severityBadge(rec.priority);
      lines.push(`### ${badge} [${rec.category}] ${rec.title}`);
      lines.push('');
      lines.push(rec.action);
      if (rec.expectedImpact) {
        lines.push('');
        lines.push(`**Expected impact:** ${rec.expectedImpact}`);
        lines.push(`**Expected impact status:** ${rec.expectedImpactStatus}`);
      }
      if (rec.verification) lines.push(`**Verification:** ${rec.verification}`);
      lines.push('');
    }
  }

  // -----------------------------------------------------------------------
  // Lighthouse Insights
  // -----------------------------------------------------------------------
  if (insights?.lighthouse) {
    lines.push('## Metrics');
    lines.push('');
    lines.push('Lab values come from the PerfGraph run; Lighthouse values come from its own throttled run.');
    lines.push('');
    lines.push('| Metric | Lab | Lighthouse |');
    lines.push('|--------|-----|------------|');
    if (insights.lighthouse.performance != null) {
      lines.push(
        `| Performance | — | ${(insights.lighthouse.performance * 100).toFixed(0)} |`,
      );
    }
    const labLcp = insights.metrics?.lcpMs;
    if (labLcp != null || insights.lighthouse.lcpMs != null) {
      lines.push(
        `| LCP | ${labLcp != null ? `${labLcp} ms` : '—'} | ${insights.lighthouse.lcpMs != null ? `${insights.lighthouse.lcpMs} ms` : '—'} |`,
      );
    }
    const labFcp = insights.metrics?.fcpMs;
    if (labFcp != null || insights.lighthouse.fcpMs != null) {
      lines.push(
        `| FCP | ${labFcp != null ? `${labFcp} ms` : '—'} | ${insights.lighthouse.fcpMs != null ? `${insights.lighthouse.fcpMs} ms` : '—'} |`,
      );
    }
    const labCls = insights.metrics?.cls;
    if (labCls != null || insights.lighthouse.cls != null) {
      lines.push(
        `| CLS | ${labCls != null ? labCls.toFixed(3) : '—'} | ${insights.lighthouse.cls != null ? insights.lighthouse.cls.toFixed(3) : '—'} |`,
      );
    }
    const labTbt = insights.metrics?.tbtMs;
    if (labTbt != null || insights.lighthouse.tbtMs != null) {
      lines.push(
        `| TBT | ${labTbt != null ? `${labTbt} ms` : '—'} | ${insights.lighthouse.tbtMs != null ? `${insights.lighthouse.tbtMs} ms` : '—'} |`,
      );
    }
    lines.push('');

    if (insights.lcpElement) {
      const label = insights.lcpElement.selector || insights.lcpElement.nodeLabel;
      if (label) {
        const kind = insights.lcpElement.type ? ` (${insights.lcpElement.type})` : '';
        lines.push(`**LCP Element:** \`${label}\`${kind}`);
        lines.push('');
      }
    }

    if (insights.renderBlocking && insights.renderBlocking.length > 0) {
      lines.push(
        `**Render-blocking resources:** ${insights.renderBlocking.length} total`,
      );
      lines.push('');
    }
  }

  // -----------------------------------------------------------------------
  // Footer
  // -----------------------------------------------------------------------
  lines.push('---');
  lines.push(`*Generated by PerfGraph at ${report.meta.analyzedAt}*`);

  return lines.join('\n');
}
