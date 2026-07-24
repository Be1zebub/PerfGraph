/**
 * Test bootstrap and fixture loader for WebTrace ingestion tests.
 *
 * Provides a shared loader function that resolves fixture paths relative
 * to the test directory, so each test file can load its fixtures without
 * repeating __dirname / path resolution boilerplate.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load a JSON fixture by path segments relative to the test directory.
 *
 * @example
 *   const data = loadFixture('fixtures', 'runtime', 'minimal-valid.json');
 *   const data = loadFixture('fixtures', 'coverage', 'minimal-valid.json');
 */
export function loadFixture(...paths: string[]): unknown {
  const fullPath = resolve(__dirname, ...paths);
  const raw = readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw);
}
