/**
 * NetworkCollector — captures HTTP request/response data via the CDP Network domain.
 *
 * Enables the Network domain and listens for:
 *   - Network.requestWillBeSent  (request metadata + redirect tracking)
 *   - Network.responseReceived   (response metadata + timing)
 *   - Network.loadingFailed      (failure information)
 *   - Network.requestServedFromCache
 *
 * Correlates requests and responses by CDP requestId.
 */

import { type CDPSession } from 'playwright';
import type { Collector, CollectorResult } from './types.js';
import type { NetworkRawData, NetworkRequestEntry, NetworkTiming } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';

// ---------------------------------------------------------------------------
// Inline CDP event payload shapes
// The CDP `requestWillBeSent` payload nests url/method/headers under `request`
// ---------------------------------------------------------------------------

interface CdpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  initialPriority?: string;
  referrerPolicy?: string;
}

interface CdpResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType: string;
  timing?: NetworkTiming;
  fromDiskCache?: boolean;
  fromServiceWorker?: boolean;
  encodedDataLength: number;
  responseTime?: number;
  protocol?: string;
  remoteIPAddress?: string;
  remotePort?: number;
}

interface CdpRequestWillBeSent {
  requestId: string;
  request: CdpRequest;
  type?: string;
  timestamp: number;
  wallTime?: number;
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
  redirectResponse?: CdpResponse;
}

interface CdpResponseReceived {
  requestId: string;
  type: string;
  response: CdpResponse;
}

interface CdpLoadingFailed {
  requestId: string;
  type: string;
  errorText: string;
  canceled?: boolean;
  blockedReason?: string;
  timestamp: number;
}

interface CdpServedFromCache {
  requestId: string;
}

// ---------------------------------------------------------------------------

/**
 * Validate that collected network data contains at least some expected entries.
 *
 * @param entries - Array of collected network request entries
 * @returns Array of warning strings
 */
function validateNetworkData(entries: NetworkRequestEntry[]): string[] {
  const warnings: string[] = [];

  if (entries.length === 0) {
    warnings.push('No network requests were captured — page may not have loaded.');
  }

  const documentRequests = entries.filter((e) => e.type === 'Document');
  if (documentRequests.length === 0) {
    warnings.push('No document (main-frame) request found in network data.');
  }

  const failedEntries = entries.filter((e) => e.failed);
  if (failedEntries.length > 0) {
    const failedUrls = failedEntries.map((e) => e.url).slice(0, 5);
    warnings.push(
      `${failedEntries.length} network request(s) failed. First failures: ${failedUrls.join(', ')}`,
    );
  }

  return warnings;
}

export class NetworkCollector implements Collector {
  readonly name = 'network';

  private session: CDPSession | null = null;
  /** Map of requestId -> entry (covers redirect chains) */
  private requestMap = new Map<string, NetworkRequestEntry>();
  /** Maintain insertion order for chronological output */
  private requestOrder: string[] = [];
  private requestCount = 0;
  private failedCount = 0;
  private startTime = 0;
  private endTime = 0;
  private collected = false;

  async start(session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    this.session = session;
    this.requestMap.clear();
    this.requestOrder = [];
    this.requestCount = 0;
    this.failedCount = 0;
    this.startTime = 0;
    this.endTime = 0;
    this.collected = false;

    // Register CDP event listeners (cast to unknown to bypass strict typed overloads)
    session.on(
      'Network.requestWillBeSent',
      this.#onRequestWillBeSent.bind(this) as (payload: unknown) => void,
    );
    session.on(
      'Network.responseReceived',
      this.#onResponseReceived.bind(this) as (payload: unknown) => void,
    );
    session.on(
      'Network.loadingFailed',
      this.#onLoadingFailed.bind(this) as (payload: unknown) => void,
    );
    session.on(
      'Network.requestServedFromCache',
      this.#onRequestServedFromCache.bind(this) as (payload: unknown) => void,
    );

    // Enable the Network domain
    await session.send('Network.enable', {
      maxTotalBufferSize: 10_000_000,
      maxResourceBufferSize: 5_000_000,
    });
  }

  async stop(): Promise<CollectorResult<NetworkRawData>> {
    this.collected = true;

    if (!this.session) {
      return { ok: false, error: 'NetworkCollector: session not initialized' };
    }

    const warnings: string[] = [];

    try {
      // Disable the Network domain to stop receiving events
      await this.session.send('Network.disable');
    } catch (error) {
      warnings.push(`NetworkCollector: error disabling Network domain — ${String(error)}`);
    }

    // Build ordered array of entries
    const requests: NetworkRequestEntry[] = [];
    for (const id of this.requestOrder) {
      const entry = this.requestMap.get(id);
      if (entry) {
        requests.push(entry);
      }
    }

    // Calculate metadata
    const totalRequests = requests.length;
    const totalFailed = requests.filter((r) => r.failed).length;

    // Collect total bytes from completed responses
    let totalBytes = 0;
    for (const r of requests) {
      if (r.response) {
        totalBytes += r.response.encodedDataLength;
      }
    }

    // Run completeness validation
    const validationWarnings = validateNetworkData(requests);
    warnings.push(...validationWarnings);

    return {
      ok: true,
      data: {
        requests,
        metadata: {
          totalRequests,
          totalFailed,
          totalBytes,
          startTime: this.startTime,
          endTime: this.endTime,
        },
        warnings,
      },
    };
  }

  /**
   * Handle Network.requestWillBeSent — captures request metadata.
   * The CDP payload nests url/method/headers inside `request`.
   * For redirects, updates the existing entry and stores redirect info.
   */
  #onRequestWillBeSent(raw: CdpRequestWillBeSent): void {
    const { requestId, request: req, type, timestamp, wallTime, initiator, redirectResponse } =
      raw;

    if (this.startTime === 0 || timestamp < this.startTime) {
      this.startTime = timestamp;
    }
    this.endTime = Math.max(this.endTime, timestamp);

    // Check if this is a new request or part of a redirect chain
    const existing = this.requestMap.get(requestId);

    if (existing) {
      // This is a redirect — save the redirect response and update entry
      if (redirectResponse) {
        existing.redirectChain = existing.redirectChain ?? [];
        existing.redirectChain.push({
          url: redirectResponse.url,
          status: redirectResponse.status,
          statusText: redirectResponse.statusText,
          headers: redirectResponse.headers,
          timing: redirectResponse.timing,
          encodedDataLength: redirectResponse.encodedDataLength,
        });
      }

      // Update the entry with final request data
      existing.url = req.url;
      existing.method = req.method;
      existing.type = type ?? existing.type;
      existing.timestamp = timestamp;
      existing.wallTime = wallTime ?? existing.wallTime;
      existing.request = {
        headers: req.headers,
        postData: req.postData,
        initialPriority: req.initialPriority,
        referrerPolicy: req.referrerPolicy,
      };
      if (initiator) {
        existing.initiator = initiator as NetworkRequestEntry['initiator'];
      }
    } else {
      // New request
      const entry: NetworkRequestEntry = {
        requestId,
        url: req.url,
        method: req.method,
        type,
        request: {
          headers: req.headers,
          postData: req.postData,
          initialPriority: req.initialPriority,
          referrerPolicy: req.referrerPolicy,
        },
        timestamp,
        wallTime,
        initiator: initiator as NetworkRequestEntry['initiator'] | undefined,
      };

      this.requestMap.set(requestId, entry);
      this.requestOrder.push(requestId);
      this.requestCount++;
    }
  }

  /**
   * Handle Network.responseReceived — captures response metadata.
   */
  #onResponseReceived(raw: CdpResponseReceived): void {
    const { requestId, type, response: res } = raw;
    const entry = this.requestMap.get(requestId);
    if (!entry) {
      return; // May happen if request started before Network.enable
    }

    // Update type from response (more reliable than requestWillBeSent's type)
    entry.type = type ?? entry.type;

    // Fill in response data
    entry.response = {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      mimeType: res.mimeType,
      timing: res.timing,
      fromDiskCache: res.fromDiskCache,
      fromServiceWorker: res.fromServiceWorker,
      encodedDataLength: res.encodedDataLength,
      responseTime: res.responseTime,
      protocol: res.protocol,
      remoteIPAddress: res.remoteIPAddress,
      remotePort: res.remotePort,
    };
  }

  /**
   * Handle Network.loadingFailed — captures failure information.
   */
  #onLoadingFailed(raw: CdpLoadingFailed): void {
    const { requestId, type, errorText, canceled, blockedReason, timestamp } = raw;
    const entry = this.requestMap.get(requestId);
    if (!entry) {
      return;
    }

    entry.failed = true;
    entry.errorText = errorText;
    entry.canceled = canceled;
    entry.blockedReason = blockedReason;
    entry.type = type ?? entry.type;
    this.failedCount++;

    this.endTime = Math.max(this.endTime, timestamp);
  }

  /**
   * Handle Network.requestServedFromCache — marks cache-served requests.
   */
  #onRequestServedFromCache(raw: CdpServedFromCache): void {
    const entry = this.requestMap.get(raw.requestId);
    if (!entry) {
      return;
    }

    entry.fromCache = true;
  }
}
