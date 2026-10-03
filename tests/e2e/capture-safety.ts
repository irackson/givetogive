import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContextOptions } from '@playwright/test';

type CaptureSection = 'community-staging' | 'payments-staging' | 'production';
type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;
const stagingOrigin = 'https://givetogive-staging.vercel.app';
const productionOrigin = 'https://givetogive.vercel.app';
const rootName = /^walkthrough-[a-z0-9-]+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Source dialog inventory shared with the PDF coverage denominator. */
export const captureDialogIds = Object.freeze([
	'create-ask', 'offer-contribution', 'edit-ask', 'complete-contribution',
	'cancel-contribution', 'edit-profile', 'revoke-sessions', 'freeze-member',
	'review-case', 'ask-payment-pause', 'create-simulation', 'recover-controller',
	'stop-simulation', 'create-fund', 'allocate-fund', 'refund-payment',
	'enable-ask-payments', 'contribution-checkout', 'cancel-checkout',
	'cancel-fund-subscription', 'change-supporter-membership',
] as const);
export type CaptureDialogId = typeof captureDialogIds[number];

/** Explicit associations only: titles and disabled entry points are not evidence. */
export function validateCaptureDialogIds(value: unknown): CaptureDialogId[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length === 0 ||
		Array.from(value).some((id) => typeof id !== 'string' || !captureDialogIds.some((allowed) => allowed === id)) ||
		new Set(value).size !== value.length) {
		throw new Error('Capture dialog IDs must be a nonempty unique allowlisted array.');
	}
	return [...value] as CaptureDialogId[];
}

export function captureSimulationRunId(requestedId: string | undefined) {
	if (requestedId === undefined) return undefined;
	if (requestedId.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestedId)) {
		throw new Error('WALKTHROUGH_SIMULATION_RUN_ID must be an explicit UUID.');
	}
	return requestedId.toLowerCase();
}

/** A fresh section is atomically claimed; existing captures are never reused. */
export async function createCaptureDirectory(
	repoRoot: string,
	requestedRoot: string | undefined,
	section: CaptureSection,
) {
	if (!requestedRoot) throw new Error('WALKTHROUGH_CAPTURE_ROOT must name a fresh capture namespace.');
	if (!['community-staging', 'payments-staging', 'production'].includes(section)) {
		throw new Error('Unknown capture section.');
	}
	const repository = await realpath(repoRoot);
	const temporary = path.join(repository, 'tmp');
	const captureRoot = path.resolve(repository, requestedRoot);
	if (path.dirname(captureRoot) !== temporary || !rootName.test(path.basename(captureRoot))) {
		throw new Error('Capture root must be a UUID-suffixed walkthrough namespace directly beneath repository tmp.');
	}
	for (const directory of [temporary, captureRoot]) {
		try { await mkdir(directory); }
		catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
		}
		const metadata = await lstat(directory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) {
			throw new Error('Capture directories must not redirect outside the repository.');
		}
	}
	const directory = path.join(captureRoot, section);
	// Deliberately not recursive: EEXIST fails before fixtures or screenshots.
	await mkdir(directory);
	await mkdir(path.join(directory, 'images'));
	return directory;
}

/** Never inherit a staging bypass into production or loopback contexts. */
export async function captureStorageState(
	baseURL: string,
	repoRoot: string,
	environment: string | undefined,
): Promise<StorageState> {
	let origin: URL;
	try { origin = new URL(baseURL); }
	catch { throw new Error('Capture URL must be a valid allowlisted origin.'); }
	if (origin.username || origin.password) throw new Error('Capture URLs must not contain credentials.');
	if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Capture URL must contain only an origin.');
	if (origin.origin === productionOrigin ||
		(['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.protocol === 'http:')) {
		return { cookies: [], origins: [] };
	}
	if (origin.origin !== stagingOrigin || environment !== 'staging') {
		throw new Error('Capture context origin is not allowlisted.');
	}
	let state: unknown;
	try { state = JSON.parse(await readFile(path.join(repoRoot, 'tmp/e2e/staging-bypass.json'), 'utf8')); }
	catch { throw new Error('Capture staging bootstrap state is missing or malformed.'); }
	return validateStagingStorageState(state);
}

export function validateStagingStorageState(state: unknown): StorageState {
	const invalid = () => new Error('Capture requires an explicitly host-only staging bootstrap state.');
	if (!state || typeof state !== 'object' || !('cookies' in state) || !('origins' in state) ||
		!Array.isArray(state.cookies) || state.cookies.length !== 1 || !Array.isArray(state.origins) || state.origins.length) {
		throw invalid();
	}
	for (const cookie of state.cookies) {
		if (!cookie || typeof cookie !== 'object' || cookie.domain !== new URL(stagingOrigin).hostname ||
			cookie.secure !== true || cookie.path !== '/' || cookie.name !== '_vercel_jwt' ||
			typeof cookie.value !== 'string' || !cookie.value || typeof cookie.expires !== 'number' ||
			!Number.isFinite(cookie.expires) || (cookie.expires !== -1 && cookie.expires <= Date.now() / 1000) || cookie.httpOnly !== true ||
			!['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
			throw invalid();
		}
	}
	// Keep only Playwright's cookie fields; do not forward arbitrary metadata.
	return { cookies: state.cookies.map(({ name, value, domain, path: cookiePath, expires, httpOnly, secure, sameSite }) =>
		({ name, value, domain, path: cookiePath, expires, httpOnly, secure, sameSite })), origins: [] };
}
