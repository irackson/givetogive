// Central sanitizer: inputs and provider payloads are not safe telemetry.
const privateKey = /password|secret|token|authorization|cookie|session|card|pan$|cvc|cvv|bank|routing|account_number|client_secret|email|address|reasoning|thought|prompt|url|uri/i;
export function redactText(value: string) {
	return value
		.replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+/g, '[REDACTED]')
		.replace(/whsec_[A-Za-z0-9]+/g, '[REDACTED]')
		.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
		.replace(/https?:\/\/[^\s]+/g, '[LINK REDACTED]')
		.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[EMAIL REDACTED]')
		.replace(/\b(?:\d[ -]?){13,19}\b/g, '[NUMBER REDACTED]');
}
export function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
	function visit(value: unknown, depth: number): unknown {
		if (depth > 5) return '[TRUNCATED]';
		if (typeof value === 'string') return redactText(value).slice(0, 1000);
		if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
		if (Array.isArray(value)) return value.slice(0, 50).map((item) => visit(item, depth + 1));
		if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50)
			.map(([key, item]) => [key, privateKey.test(key) ? '[REDACTED]' : visit(item, depth + 1)]));
		return null;
	}
	return visit(details, 0) as Record<string, unknown>;
}
