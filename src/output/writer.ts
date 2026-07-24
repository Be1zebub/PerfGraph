/**
 * Output writer — creates timestamped directories and writes JSON data.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Create a timestamped output directory under the given base path.
 *
 * Directory format: `webtrace_<hostname>_<YYYYMMDD_HHmmss>`
 *
 * @param basePath - Base directory for output
 * @param url - Source URL (used to extract hostname for directory naming)
 * @returns Absolute path to the created directory
 */
export async function createOutputDir(basePath: string, url: string): Promise<string> {
  const hostname = new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dirName = `webtrace_${hostname}_${timestamp}`;
  const dirPath = join(basePath, dirName);
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Write a JSON-serializable value to a file inside the given directory.
 *
 * @param dir - Target directory
 * @param filename - File name (e.g. "trace.json")
 * @param data - Data to serialize as JSON
 * @returns Full path to the written file
 */
export async function writeJsonFile(dir: string, filename: string, data: unknown): Promise<string> {
  const filePath = join(dir, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

/**
 * Write a warnings file to the given directory.
 *
 * @param dir - Target directory
 * @param warnings - Array of warning strings
 * @returns Full path to the written file
 */
export async function writeWarnings(dir: string, warnings: string[]): Promise<string> {
  return writeJsonFile(dir, 'warnings.json', {
    warnings,
    timestamp: new Date().toISOString(),
  });
}
