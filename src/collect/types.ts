/**
 * Collector interfaces, result types, and raw data types.
 *
 * Each collector produces a CollectorResult that wraps its domain-specific
 * raw data. RawDataBundle aggregates all collectors' output for a single run.
 *
 * All type definitions live here to avoid circular module dependencies
 * between types.ts and the collector implementations.
 */

import type { CDPSession } from 'playwright';
import type { CollectorRunOptions } from '../shared/types.js';

// ---------------------------------------------------------------------------
// Collector Interface
// ---------------------------------------------------------------------------

/** Wrapped result from a collector's stop() method */
export type CollectorResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Every collector implements this interface */
export interface Collector {
  /** Human-readable collector name (e.g. "trace", "network") */
  readonly name: string;

  /**
   * Start collecting data.
   * Called after the CDP session is established but before navigation.
   */
  start(session: CDPSession, options?: CollectorRunOptions): Promise<void>;

  /**
   * Stop collecting data and return the collected payload.
   * Called after the page has finished loading.
   */
  stop(): Promise<CollectorResult<unknown>>;
}

// ---------------------------------------------------------------------------
// Raw Data Bundle
// ---------------------------------------------------------------------------

/**
 * Aggregated output from all collectors for a single run.
 * Each field is optional — a collector may fail without blocking others.
 */
export interface RawDataBundle {
  trace?: unknown;
  network?: unknown;
  performance?: unknown;
  runtime?: unknown;
  coverage?: CoverageRawData;
  consoleEntries?: unknown;
  dom?: unknown;
  lighthouse?: unknown;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Trace-specific types
// ---------------------------------------------------------------------------

/** A single trace event from the Tracing domain */
export interface TraceEvent {
  /** Event categories (comma-separated) */
  cat: string;
  /** Event name */
  name: string;
  /** Event phase (B/b=begin, E/e=end, I=instant, etc.) */
  ph: string;
  /** Timestamp in microseconds */
  ts: number;
  /** Process ID */
  pid: number;
  /** Thread ID */
  tid: number;
  /** Event arguments */
  args: Record<string, unknown>;
  /** Duration in microseconds (for complete events) */
  dur?: number;
  /** Thread duration */
  tdur?: number;
}

/** Structured output from TraceCollector */
export interface TraceRawData {
  /** All collected trace events in chronological order */
  events: TraceEvent[];
  /** Collection metadata */
  metadata: {
    /** Categories that were requested for tracing */
    categories: string[];
    /** Total number of events collected */
    totalEvents: number;
    /** Number of dataCollected callbacks received */
    dataCollectedCount: number;
  };
  /** Warnings generated during collection (buffer overflow, missing events, etc.) */
  warnings: string[];
}

/** Sample from Tracing.bufferUsage event */
export interface BufferUsageSample {
  /** Buffer usage value (0.0 – 1.0) */
  value: number;
  /** Wall-clock timestamp when the sample was taken */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Network-specific types
// ---------------------------------------------------------------------------

/** Resource timing breakdown from CDP (Network.Response.timing) */
export interface NetworkTiming {
  requestTime: number;
  proxyStart: number;
  proxyEnd: number;
  dnsStart: number;
  dnsEnd: number;
  connectStart: number;
  connectEnd: number;
  sslStart: number;
  sslEnd: number;
  workerStart: number;
  workerReady: number;
  workerFetchStart: number;
  workerRespondWithSettled: number;
  sendStart: number;
  sendEnd: number;
  pushStart: number;
  pushEnd: number;
  receiveHeadersEnd: number;
}

/** Describes a captured network request and its response */
export interface NetworkRequestEntry {
  /** Unique request identifier from CDP */
  requestId: string;
  /** Request URL (final URL after redirects) */
  url: string;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Resource type (Document, Script, Image, XHR, Fetch, etc.) */
  type?: string;
  /** Request metadata */
  request: {
    headers: Record<string, string>;
    postData?: string;
    initialPriority?: string;
    referrerPolicy?: string;
  };
  /** Response metadata (present if the request completed) */
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
    /** Resource timing breakdown */
    timing?: NetworkTiming;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    encodedDataLength: number;
    responseTime?: number;
    protocol?: string;
    remoteIPAddress?: string;
    remotePort?: number;
  };
  /** Whether the request failed */
  failed?: boolean;
  /** Error description (present when failed) */
  errorText?: string;
  /** Whether the request was canceled */
  canceled?: boolean;
  /** Reason the request was blocked */
  blockedReason?: string;
  /** Initiator information */
  initiator?: {
    type: string;
    url?: string;
    lineNumber?: number;
    stack?: {
      callFrames: Array<{
        functionName: string;
        scriptId: string;
        url: string;
        lineNumber: number;
        columnNumber: number;
      }>;
    };
  };
  /** CDP monotonic timestamp (seconds) */
  timestamp: number;
  /** UTC wall time (seconds since epoch) */
  wallTime?: number;
  /** Whether the request was served from cache */
  fromCache?: boolean;
  /** Redirect chain responses (if any redirects occurred) */
  redirectChain?: Array<{
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    timing?: NetworkTiming;
    encodedDataLength: number;
  }>;
}

/** Structured output from NetworkCollector */
export interface NetworkRawData {
  /** All captured network requests in chronological order */
  requests: NetworkRequestEntry[];
  /** Collection metadata */
  metadata: {
    totalRequests: number;
    totalFailed: number;
    totalBytes: number;
    startTime: number;
    endTime: number;
  };
  /** Warnings generated during collection */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Performance-specific types
// ---------------------------------------------------------------------------

/** A single performance metric entry */
export interface PerformanceMetric {
  name: string;
  value: number;
}

/** Structured output from PerformanceCollector */
export interface PerformanceRawData {
  /** Final snapshot metrics from Performance.getMetrics */
  metrics: PerformanceMetric[];
  /** Timestamp when the metrics snapshot was taken */
  timestamp: number;
  /** Warnings generated during collection */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Runtime-specific types
// ---------------------------------------------------------------------------

/** Information about a single JavaScript execution context */
export interface RuntimeExecutionContext {
  id: number;
  origin: string;
  name: string;
}

/** Runtime metrics evaluated in the page context */
export interface RuntimeStats {
  jsHeapSize: number;
  domNodeCount: number;
  documentUrl: string;
}

/** Structured output from RuntimeCollector */
export interface RuntimeRawData {
  contexts: RuntimeExecutionContext[];
  stats?: RuntimeStats;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Coverage-specific types
// ---------------------------------------------------------------------------

/** A single covered range within a script or stylesheet */
export interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

/** Coverage data for a single function within a script */
export interface ScriptFunctionCoverage {
  functionName: string;
  ranges: CoverageRange[];
  isBlockCoverage: boolean;
}

/** Coverage data for a single script */
export interface ScriptCoverage {
  scriptId: string;
  url: string;
  functions: ScriptFunctionCoverage[];
}

/** Coverage data for a single stylesheet */
export interface StyleCoverage {
  styleSheetId: string;
  url: string;
  ranges: CoverageRange[];
}

/** Structured output from CoverageCollector */
export interface CoverageRawData {
  js: ScriptCoverage[];
  css: StyleCoverage[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Console-specific types
// ---------------------------------------------------------------------------

/** Supported console message types */
export type ConsoleEntryType =
  | 'log'
  | 'warn'
  | 'error'
  | 'info'
  | 'debug'
  | 'assert'
  | 'dir'
  | 'dirxml'
  | 'table'
  | 'trace'
  | 'clear'
  | 'startGroup'
  | 'startGroupCollapsed'
  | 'endGroup'
  | 'count'
  | 'timeEnd'
  | 'profile'
  | 'profileEnd';

/** A single stack frame from the call site */
export interface ConsoleStackFrame {
  url: string;
  lineNumber: number;
  columnNumber: number;
  functionName?: string;
}

/** A single console API call entry */
export interface ConsoleEntry {
  timestamp: number;
  type: ConsoleEntryType;
  args: unknown[];
  stackTrace?: ConsoleStackFrame[];
}

/** Severity counts for all captured console entries */
export interface ConsoleCounts {
  log: number;
  warn: number;
  error: number;
  info: number;
  debug: number;
  other: number;
}

/** Structured output from ConsoleCollector */
export interface ConsoleRawData {
  entries: ConsoleEntry[];
  counts: ConsoleCounts;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// DOM-specific types
// ---------------------------------------------------------------------------

/** Aggregate DOM statistics */
export interface DomStats {
  totalNodes: number;
  elementCount: number;
  maxDepth: number;
  textContentLength: number;
}

/** Structured output from DOMCollector */
export interface DomRawData {
  stats: DomStats;
  elementDistribution: Record<string, number>;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Lighthouse-specific types
// ---------------------------------------------------------------------------

/** Lighthouse category identifiers we audit by default */
export type LighthouseCategory = 'performance' | 'accessibility' | 'best-practices' | 'seo';

/** Structured output from LighthouseCollector */
export interface LighthouseRawData {
  /** Full Lighthouse Result object (LHR) */
  lhr: Record<string, unknown>;
  categories: LighthouseCategory[];
  warnings: string[];
}

// (No remaining type stubs — all collector types are now defined above)
