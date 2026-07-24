/**
 * TOON format converter — encodes JSON-serializable data to TOON format
 * using @toon-format/toon for token-efficient LLM consumption.
 *
 * @packageDocumentation
 */

import { encode } from '@toon-format/toon';

/**
 * Encode any JSON-serializable value into TOON format string.
 *
 * TOON (Token-Oriented Object Notation) is a compact, human-readable,
 * schema-aware encoding of JSON designed to minimise token usage in
 * LLM prompts. It declares array lengths and field headers once, then
 * streams row values.
 *
 * @param data - Any JSON-serializable value (object, array, primitive)
 * @returns A TOON-formatted string
 */
export async function convertToon(data: unknown): Promise<string> {
  return encode(data);
}
