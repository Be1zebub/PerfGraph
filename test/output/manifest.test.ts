import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest } from '../../src/output/manifest.js';

describe('writeManifest', () => {
	it('lists existing agent artifacts in recommended read order', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'perfgraph-manifest-'));
		try {
			await writeFile(join(dir, 'report.toon'), 'report', 'utf8');
			await writeFile(join(dir, 'insights.toon'), 'insights', 'utf8');
			await writeFile(join(dir, 'trace.json'), '{}', 'utf8');

			const manifestPath = await writeManifest(dir);
			const manifest = await readFile(manifestPath, 'utf8');

			expect(manifest).toContain('insights.toon');
			expect(manifest).toContain('report.toon');
			expect(manifest).toContain('trace.json');
			expect(manifest.indexOf('insights.toon')).toBeLessThan(manifest.indexOf('report.toon'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
