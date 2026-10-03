import type { EventEmitter } from 'node:events';

export const communityShutdownMessage = { protocolVersion: 1, type: 'community_shutdown' } as const;

/** Parent IPC requests a drain; Windows child.kill signals can force termination. */
export function registerCommunityShutdown(stop: () => void, runtime: Pick<EventEmitter, 'on' | 'off'> = process) {
	const signal = () => stop();
	const message = (value: unknown) => {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const record = value as Record<string, unknown>;
			if (Object.keys(record).length === 2 && record.protocolVersion === 1 && record.type === 'community_shutdown') stop();
		}
	};
	runtime.on('SIGINT', signal);
	runtime.on('SIGTERM', signal);
	runtime.on('message', message);
	return () => {
		runtime.off('SIGINT', signal);
		runtime.off('SIGTERM', signal);
		runtime.off('message', message);
	};
}
