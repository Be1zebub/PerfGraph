/**
 * Data quality assessment, shared by the report and the insights.
 *
 * Both artifacts describe the same run, so they have to describe its quality
 * the same way. When they did not, one said `complete` while the other said
 * `partial` for the very same collection.
 */

import type { FeatureSet } from '../extract/types.js';

/** A run that recorded a warning did not produce complete data. */
export interface DataQuality {
  status: 'complete' | 'partial';
  warnings: string[];
}

/**
 * Assess the quality of a run.
 *
 * @param features - The extracted features
 * @param options - The measured values and the warnings of the run
 * @returns The data quality of the run
 */
export function assessDataQuality(
  features: FeatureSet,
  options: {
    /** Measured total blocking time of the lab run */
    tbtMs?: number;
    /** Total blocking time Lighthouse reported for its own run */
    lighthouseTbtMs?: number;
    /** Warnings recorded during the collection */
    runWarnings?: string[];
  } = {},
): DataQuality {
  const warnings: string[] = [];

  if (features.lcpBreakdown == null) warnings.push('LCP breakdown is unavailable.');
  if (features.layoutShifts == null) warnings.push('Layout-shift data is unavailable.');
  if (features.mainThreadBlocking == null) {
    warnings.push('Main-thread data is unavailable.');
  } else if (options.tbtMs == null) {
    warnings.push(
      'Measured TBT is unavailable; busyMs is not used as a TBT substitute.',
    );
  }
  if (features.renderBlocking?.sourceConflict) {
    warnings.push(
      'Network and Lighthouse render-blocking counts differ; verify both source lists before attributing LCP impact.',
    );
  }

  const criticalPath = features.criticalPath;
  if (
    criticalPath?.pageLifecycleMs != null &&
    criticalPath.aggregateRequestDurationMs > criticalPath.pageLifecycleMs * 2
  ) {
    warnings.push(
      'Aggregate request duration exceeds page lifecycle; interpret it as parallel work rather than user wait time.',
    );
  }

  for (const warning of options.runWarnings ?? []) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  // The two runs measure the same page under different conditions. A large
  // gap between their blocking times is worth naming, otherwise the two
  // numbers look like a contradiction instead of two measurements.
  const labTbt = features.mainThreadBlocking?.tbtMs;
  const lighthouseTbt = options.lighthouseTbtMs;
  if (
    labTbt != null &&
    lighthouseTbt != null &&
    labTbt > 0 &&
    lighthouseTbt > 0
  ) {
    const ratio = Math.max(labTbt, lighthouseTbt) / Math.min(labTbt, lighthouseTbt);
    if (ratio >= 2) {
      warnings.push(
        `Total blocking time differs by ${ratio.toFixed(1)}x between the lab run (${Math.round(labTbt)}ms) and the Lighthouse run (${Math.round(lighthouseTbt)}ms); they are different navigations under different conditions.`,
      );
    }
  }

  return {
    status: warnings.length > 0 ? 'partial' : 'complete',
    warnings,
  };
}
