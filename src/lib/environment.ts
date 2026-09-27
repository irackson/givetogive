export type ApplicationEnvironment = 'development' | 'staging' | 'production' | 'test';

export function applicationEnvironment(source: Record<string, string | undefined> = process.env): ApplicationEnvironment {
	const configured = source['APP_ENV'];
	if (configured === 'staging' || configured === 'production' || configured === 'development' || configured === 'test') return configured;
	return source['NODE_ENV'] === 'test' ? 'test' : source['NODE_ENV'] === 'production' ? 'production' : 'development';
}

export function simulationTarget(source: Record<string, string | undefined> = process.env) {
	if (applicationEnvironment(source) !== 'staging' || source['SIMULATION_ENABLED'] !== 'true') throw new Error('Simulation is disabled outside explicitly enabled staging.');
	const origin = new URL(source['APP_URL'] ?? '').origin;
	if (!origin.startsWith('https://') || origin === 'https://givetogive.vercel.app') throw new Error('A distinct HTTPS staging origin is required.');
	const databaseIdentity = source['DATABASE_IDENTITY'];
	if (!databaseIdentity || databaseIdentity.length < 8) throw new Error('Staging database identity is missing.');
	const stripeKey = source['STRIPE_SECRET_KEY'];
	if (stripeKey && !/^[rs]k_test_/.test(stripeKey)) throw new Error('Simulation rejects non-test Stripe credentials.');
	return { origin, databaseIdentity, stripeMode: stripeKey ? 'test' as const : 'unconfigured' as const };
}
