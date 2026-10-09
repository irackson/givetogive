// Read-only provenance for ONE failed-before-dispatch native attempt. This is
// not financial replay authority. Native provider/SQL absence checks remain required.
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
const priorHead = '1b8871493ab2f05004bcdeaa03af644ecbf869d0';
const fail = () => {
	throw Error('Pre-dispatch recovery refused; original evidence retained.');
};
/** @param {unknown} value */
function guard(value) {
	if (!value) fail();
}
const originalSchema = z.object({
	names: z.array(z.string()),
	dispatchNames: z.array(z.string()),
	operator: z.object({
		headSha: z.literal(priorHead),
		operationId: z.string(),
		maximumMemberSignIns: z.literal(1),
		maximumPreparations: z.literal(1),
		maximumSubmissions: z.literal(1),
		noHistoryReset: z.literal(true),
		retryAllowed: z.literal(false),
		paymentAccepted: z.literal(false),
	}),
	dispatch: z.object({
		headSha: z.literal(priorHead),
		operationId: z.string(),
		maximumDispatches: z.literal(1),
		maximumDraftCreates: z.literal(1),
		maximumAssociationWrites: z.literal(1),
		retryAllowed: z.literal(false),
		paymentAccepted: z.literal(false),
	}),
	signIn: z.object({
		actorId: z.string(),
		maximumPosts: z.literal(1),
		retryAllowed: z.literal(false),
	}),
	prerequisites: z.object({
		readOnly: z.literal(true),
		originalBudgetVerified: z.literal(true),
		candidateUnused: z.literal(true),
		candidatePrepared: z.literal(false),
		checkoutCreated: z.literal(false),
		submitAttempted: z.literal(false),
		paymentAccepted: z.literal(false),
		appSubscriptions: z.literal(0),
		paidCoverage: z.literal(0),
		ledgerEntries: z.literal(0),
		priorExpiredProviderSessions: z.literal(2),
	}),
	release: z.object({
		headSha: z.literal(priorHead),
		deploymentId: z.literal('dpl_BjjNh1yYuzNyXHLPhdja6k2xwS7X'),
		deployedAppSha: z.literal('c8044c1b9dae433b2d598f39f84e6897dd87c546'),
		ready: z.literal(true),
		protected: z.literal(true),
		runtimeGatesVerified: z.literal(true),
		financialAdmission: z.literal(false),
		paymentAccepted: z.literal(false),
	}),
});
/** @param {unknown} input @param {string} operationId @param {string} memberId */
export function validatePredispatchRecovery(input, operationId, memberId) {
	const raw = originalSchema.parse(input);
	guard(
		raw?.names?.sort().join(',') ===
			[
				'current-dispatch-' + operationId,
				'member-sign-in.intent.json',
				'operator-lease.json',
				'prerequisites.original.json',
				'release.original.json',
			]
				.sort()
				.join(','),
	);
	guard(raw.dispatchNames?.join(',') === 'dispatch-lease.json');
	const o = raw.operator,
		d = raw.dispatch,
		p = raw.prerequisites,
		r = raw.release,
		m = raw.signIn;
	guard(
		o?.headSha === priorHead &&
			o.operationId === operationId &&
			o.maximumMemberSignIns === 1 &&
			o.maximumPreparations === 1 &&
			o.maximumSubmissions === 1 &&
			o.noHistoryReset &&
			o.retryAllowed === false &&
			o.paymentAccepted === false,
	);
	guard(
		d?.headSha === priorHead &&
			d.operationId === operationId &&
			d.maximumDispatches === 1 &&
			d.maximumDraftCreates === 1 &&
			d.maximumAssociationWrites === 1 &&
			d.retryAllowed === false &&
			d.paymentAccepted === false,
	);
	guard(
		m?.maximumPosts === 1 &&
			m.actorId === memberId &&
			m.retryAllowed === false,
	);
	guard(
		p?.readOnly &&
			p.originalBudgetVerified &&
			p.candidateUnused &&
			p.candidatePrepared === false &&
			p.checkoutCreated === false &&
			p.submitAttempted === false &&
			p.paymentAccepted === false &&
			p.appSubscriptions === 0 &&
			p.paidCoverage === 0 &&
			p.ledgerEntries === 0 &&
			p.priorExpiredProviderSessions === 2,
	);
	guard(
		r?.headSha === priorHead &&
			r.deploymentId === 'dpl_BjjNh1yYuzNyXHLPhdja6k2xwS7X' &&
			r.deployedAppSha === 'c8044c1b9dae433b2d598f39f84e6897dd87c546' &&
			r.ready &&
			r.protected &&
			r.runtimeGatesVerified &&
			r.financialAdmission === false &&
			r.paymentAccepted === false,
	);
	return Object.freeze({
		priorHead,
		operationId,
		memberId,
		originalsPreserved: true,
		priorPreparationAbsent: true,
		priorDispatchIntentAbsent: true,
		priorSubmissionAbsent: true,
		financialRetry: false,
		providerAndOriginalBudgetRecheckRequired: true,
	});
}
/** @param {string} root @param {string} operationId @param {string} memberId */
export function readPredispatchRecovery(root, operationId, memberId) {
	const directory = resolve(root),
		dispatch = join(directory, 'current-dispatch-' + operationId);
	for (const path of [directory, dispatch])
		guard(
			lstatSync(path).isDirectory() &&
				!lstatSync(path).isSymbolicLink() &&
				realpathSync(path) === path,
		);
	const names = readdirSync(directory),
		dispatchNames = readdirSync(dispatch),
		hash = createHash('sha256');
	/** @param {string} path */
	const read = (path) => {
		guard(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
		const bytes = readFileSync(path);
		guard(bytes.length < 65536);
		hash.update(path).update('\0').update(bytes).update('\0');
		return JSON.parse(bytes.toString());
	};
	const proof = validatePredispatchRecovery(
		{
			names,
			dispatchNames,
			operator: read(join(directory, 'operator-lease.json')),
			dispatch: read(join(dispatch, 'dispatch-lease.json')),
			prerequisites: read(join(directory, 'prerequisites.original.json')),
			release: read(join(directory, 'release.original.json')),
			signIn: read(join(directory, 'member-sign-in.intent.json')),
		},
		operationId,
		memberId,
	);
	return Object.freeze({
		...proof,
		originalReceiptDigest: hash.digest('hex'),
	});
}
