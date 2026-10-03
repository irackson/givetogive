import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, join } from 'node:path';

// Workflow's withWorkflow build hook generates this deployment-excluded tree.
// Bind generated output separately without confusing it with authored sources.
const generatedWorkflow = 'src/app/.well-known/workflow';
/** @param {string} snapshot @param {string[]} names @param {boolean} omitGenerated */
function digest(snapshot, names, omitGenerated) {
	const hash = createHash('sha256');
	/** @param {string} path */
	function visit(path) {
		const name = relative(snapshot, path).replaceAll('\\', '/');
		if (omitGenerated && (name === generatedWorkflow || name.startsWith(`${generatedWorkflow}/`))) return;
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error('Source snapshots cannot use linked source files.');
		if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child));
		else if (stat.isFile()) hash.update(name).update('\0').update(readFileSync(path)).update('\0');
	}
	for (const name of names) if (existsSync(join(snapshot, name))) visit(join(snapshot, name));
	return hash.digest('hex');
}
/** @param {string} snapshot */
export function releaseSourceDigest(snapshot) {
	return digest(snapshot, ['src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.js', 'postcss.config.cjs', 'tailwind.config.ts'], true);
}
/** @param {string} snapshot */
export function releaseGeneratedWorkflowDigest(snapshot) {
	return existsSync(join(snapshot, generatedWorkflow)) ? digest(snapshot, [generatedWorkflow], false) : null;
}
