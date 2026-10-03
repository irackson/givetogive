import type { ControlCommand } from './protocol.ts';
import type { Store } from './store.ts';

/** Durable controls. Resume never clears an ambiguous mutation in ActivityStore. */
export class CommunityState {
	paused: boolean;
	stopping: boolean;
	rate: number;
	browserConcurrency: number;
	readonly pausedUsers: Set<string>;
	readonly store: Pick<Store, 'meta' | 'hasCommand' | 'acknowledgeCommand'>;
	readonly browserUsers: Set<string>;
	readonly users: Set<string>;
	constructor(
		store: CommunityState['store'],
		users: Set<string>,
		browserUsers: Set<string>,
		concurrency: number,
	) {
		this.store = store;
		this.users = users;
		this.browserUsers = browserUsers;
		this.paused = store.meta('paused') === 'true';
		this.stopping = store.meta('stopRequested') === 'true';
		this.rate = Number(store.meta('rate') ?? 1);
		this.browserConcurrency = Number(
			store.meta('browserConcurrency') ?? concurrency,
		);
		this.pausedUsers = new Set(
			JSON.parse(store.meta('pausedUsers') ?? '[]') as string[],
		);
	}
	apply(command: ControlCommand) {
		if (this.store.hasCommand(command.id)) return false;
		switch (command.type) {
			case 'pause':
				this.paused = true;
				break;
			case 'resume':
				this.paused = false;
				break;
			case 'stop':
				this.stopping = true;
				this.store.meta('stopRequested', 'true');
				break;
			case 'set_concurrency':
				if (
					!Number.isInteger(command.value) ||
					command.value! < 1 ||
					command.value! > Math.min(30, this.browserUsers.size)
				)
					throw new Error(
						'Browser concurrency exceeds the assigned independent accounts.',
					);
				this.browserConcurrency = command.value!;
				break;
			case 'set_rate':
				if (!command.value || command.value < 0.1 || command.value > 5)
					throw new Error('Activity rate must be 0.1–5.');
				this.rate = command.value;
				break;
			case 'pause_agent':
			case 'resume_agent':
				if (!command.agentId || !this.users.has(command.agentId))
					throw new Error('Unknown community account.');
				if (command.type === 'pause_agent')
					this.pausedUsers.add(command.agentId);
				else this.pausedUsers.delete(command.agentId);
		}
		this.store.meta('paused', String(this.paused));
		this.store.meta('rate', String(this.rate));
		this.store.meta('browserConcurrency', String(this.browserConcurrency));
		this.store.meta('pausedUsers', JSON.stringify([...this.pausedUsers]));
		this.store.acknowledgeCommand(command.id);
		return true;
	}
}
