import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { releaseSourceDigest, releaseGeneratedWorkflowDigest } from '../../scripts/release-rehearsal-fingerprint.mjs';

test('Workflow generation is separately bound and never changes the authored-source fingerprint', () => {
	const fixture = mkdtempSync(join(tmpdir(), 'givetogive-rehearsal-'));
	try {
		mkdirSync(join(fixture, 'src/app'), { recursive: true });
		writeFileSync(join(fixture, 'src/app/page.tsx'), 'authored-page');
		const original = releaseSourceDigest(fixture);
		assert.equal(releaseGeneratedWorkflowDigest(fixture), null);
		const generated = join(fixture, 'src/app/.well-known/workflow/v1');
		mkdirSync(generated, { recursive: true }); writeFileSync(join(generated, 'manifest.json'), 'first-generated-build');
		const first = releaseGeneratedWorkflowDigest(fixture);
		assert.equal(releaseSourceDigest(fixture), original); assert.notEqual(first, null);
		writeFileSync(join(generated, 'manifest.json'), 'changed-generated-build');
		assert.equal(releaseSourceDigest(fixture), original); assert.notEqual(releaseGeneratedWorkflowDigest(fixture), first);
		writeFileSync(join(fixture, 'src/app/page.tsx'), 'changed-authored-page');
		assert.notEqual(releaseSourceDigest(fixture), original);
	} finally {
		assert.ok(resolve(fixture).startsWith(resolve(tmpdir(), 'givetogive-rehearsal-')));
		rmSync(fixture, { recursive: true });
	}
});
