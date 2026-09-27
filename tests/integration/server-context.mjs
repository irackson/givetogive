// Node integration tests execute real server code outside the Next bundler.
// Only its server-only import marker is replaced; application guards stay active.
import { registerHooks } from 'node:module';
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'server-only')
			return { url: 'data:text/javascript,export{}', shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
