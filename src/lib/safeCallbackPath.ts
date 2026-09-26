/** Only app-relative paths can be used after authentication. */
export function safeCallbackPath(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/';
	return value;
}
