/**
 * Tests for MCP progress notification helper.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi } from 'vitest';
import { createProgressReporter } from '../../src/mcp/progress.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';

describe('createProgressReporter', () => {
  it('returns null when progressToken is undefined', () => {
    const sendNotification = vi.fn();
    const reporter = createProgressReporter(sendNotification, undefined);
    expect(reporter).toBeNull();
  });

  it('returns null when progressToken is null', () => {
    const sendNotification = vi.fn();
    const reporter = createProgressReporter(sendNotification, undefined);
    expect(reporter).toBeNull();
  });

  it('returns a ProgressReporter when progressToken is a string', () => {
    const sendNotification = vi.fn();
    const reporter = createProgressReporter(sendNotification, 'tok_123');
    expect(reporter).not.toBeNull();
    expect(typeof reporter!.report).toBe('function');
  });

  it('returns a ProgressReporter when progressToken is a number', () => {
    const sendNotification = vi.fn();
    const reporter = createProgressReporter(sendNotification, 42);
    expect(reporter).not.toBeNull();
  });

  it('sends correct progress notification structure', async () => {
    const sendNotification = vi.fn();
    const reporter = createProgressReporter(sendNotification, 'tok_456')!;

    await reporter.report(3, 10, 'Processing...');

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const sent = sendNotification.mock.calls[0]![0] as ServerNotification;
    expect(sent.method).toBe('notifications/progress');
    if (sent.method === 'notifications/progress') {
      expect(sent.params.progressToken).toBe('tok_456');
      expect(sent.params.progress).toBe(3);
      expect(sent.params.total).toBe(10);
      expect(sent.params.message).toBe('Processing...');
    }
  });

  it('works without optional message', async () => {
    const sendNotification = vi.fn();
    const reporter = createProgressReporter(sendNotification, 'tok_789')!;

    await reporter.report(5, 5);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const sent = sendNotification.mock.calls[0]![0] as ServerNotification;
    if (sent.method === 'notifications/progress') {
      expect(sent.params.message).toBeUndefined();
    }
  });

  it('does NOT crash when sendNotification throws', async () => {
    const sendNotification = vi.fn().mockRejectedValue(new Error('network error'));
    const reporter = createProgressReporter(sendNotification, 'tok_throw')!;

    await expect(reporter.report(1, 5, 'Boom')).resolves.toBeUndefined();
  });

  it('handles zero progress values', async () => {
    const sendNotification = vi.fn();
    const reporter = createProgressReporter(sendNotification, 'tok_zero')!;

    await reporter.report(0, 1, 'Starting...');

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const sent = sendNotification.mock.calls[0]![0] as ServerNotification;
    if (sent.method === 'notifications/progress') {
      expect(sent.params.progress).toBe(0);
      expect(sent.params.total).toBe(1);
    }
  });
});
