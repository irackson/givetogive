export const stringifyCircularJSON = <T>(value: T) => {
	const seen = new WeakSet();
	return JSON.stringify(
		value,
		function (__key, value: unknown) {
			if (typeof value === 'object' && value !== null) {
				if (seen.has(value)) {
					return '[Circular]';
				}
				seen.add(value);
			}
			return value;
		},
		2,
	);
};

export const irradiateCircularity = <T>(
	circularObj: T,
	withLog = true,
): T | undefined => {
	try {
		const myObjString = stringifyCircularJSON(circularObj);
		const myObj = JSON.parse(myObjString) as unknown;

		return myObj as T;
	} catch (e) {
		if (withLog) {
			console.error(
				`Failed to irradiateCircularity: ${
					e && typeof e === 'object' && 'message' in e ?
						String(e.message)
					:	'unknown reason'
				}. Returning undefined`,
			);
		}

		return undefined;
	}
};

export const objInObjOutOrJsonStringifiedToParsed = <const T>(value: T): T => {
	if (typeof value !== 'string') {
		return value;
	}

	try {
		return JSON.parse(value) as T;
	} catch (e) {
		console.error(
			`Failed to JSON.parse non-string value (${value}). Returning value as is. Error: ${
				e && typeof e === 'object' && 'message' in e ?
					String(e.message)
				:	'unknown reason'
			}`,
		);
		return value as T;
	}
};
