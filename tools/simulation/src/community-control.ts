import { validateManifest } from './config.ts';
import type { CommunityCredentials } from './community-config.ts';
import { HostedTransport } from './transport.ts';

/** Control-plane evidence never becomes a member session or action credential. */
export class TerminalCommunityRun extends Error {}
const terminalStatuses = ['stopped', 'completed', 'cancelled'];
export function inspectCommunityManifest(
	raw: unknown,
	credentials: CommunityCredentials,
	browserUsers = 3,
) {
	const manifest = validateManifest(raw, credentials);
	if (
		manifest.runId !== credentials.runId ||
		manifest.mode !== 'scripted' ||
		manifest.agentCount !== credentials.agents.length
	)
		throw new Error(
			'Server run configuration differs from the community credentials.',
		);
	if (manifest.browserUsers !== browserUsers)
		throw new Error(
			'Server browser population differs from the assigned local controllers.',
		);
	if (!['created', 'running', 'paused', ...terminalStatuses].includes(manifest.runStatus ?? ''))
		throw new Error(
			'A finished or unknown community run cannot admit activity.',
		);
	if (
		!manifest.members ||
		manifest.members.length !== credentials.agents.length
	)
		throw new Error(
			'Server has not attested the complete independent account cohort.',
		);
	const members = new Map(
		manifest.members.map((member) => [member.id, member.userId]),
	);
	if (
		members.size !== credentials.agents.length ||
		credentials.agents.some(
			(member) => members.get(member.id) !== member.userId,
		)
	)
		throw new Error(
			'Server cohort identity differs from the local account cohort.',
		);
	return manifest;
}

export function validateCommunityManifest(
	raw: unknown,
	credentials: CommunityCredentials,
	browserUsers = 3,
) {
	const manifest = inspectCommunityManifest(raw, credentials, browserUsers);
	if (terminalStatuses.includes(manifest.runStatus ?? ''))
		throw new TerminalCommunityRun('Finished community runs cannot restart.');
	return manifest;
}

/** Cleanup is not a restart, outcome resolution or a completion claim. */
export function assertTerminalCommunityCleanup(
	raw: unknown,
	credentials: CommunityCredentials,
	browserUsers: number,
	pendingMutations: number,
	pendingTelemetry: number,
) {
	const manifest = inspectCommunityManifest(raw, credentials, browserUsers);
	if (!terminalStatuses.includes(manifest.runStatus ?? ''))
		throw new Error('Stop the hosted run through reviewed admin recovery before local cleanup.');
	if (pendingMutations || pendingTelemetry)
		throw new Error('Review unresolved mutations and sync retained telemetry before local cleanup.');
	return manifest;
}

export class CommunityControl {
	readonly transport: HostedTransport;
	readonly credentials: CommunityCredentials;
	readonly browserUsers: number;
	constructor(
		credentials: CommunityCredentials,
		bypass?: string,
		browserUsers = 3,
	) {
		this.credentials = credentials;
		this.browserUsers = browserUsers;
		this.transport = new HostedTransport(credentials, bypass);
	}
	async preflight() {
		return validateCommunityManifest(
			await this.transport.manifest(),
			this.credentials,
			this.browserUsers,
		);
	}
}
