export function hasDatabaseErrorCode(error: unknown, code: string) {
	let currentError = error;

	for (let depth = 0; depth < 5; depth += 1) {
		if (typeof currentError !== 'object' || currentError === null) {
			return false;
		}

		if (
			'code' in currentError &&
			typeof currentError.code === 'string' &&
			currentError.code === code
		) {
			return true;
		}

		currentError = 'cause' in currentError ? currentError.cause : undefined;
	}

	return false;
}
