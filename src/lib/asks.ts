export const ASK_TYPES = ['time', 'task', 'item', 'money', 'resource'] as const;

export type AskType = (typeof ASK_TYPES)[number];

export const ASK_TYPE_LABELS: Record<AskType, string> = {
	time: 'Time',
	task: 'Task',
	item: 'Item',
	money: 'Money',
	resource: 'Resource',
};

export function getAskUnitLabel(
	type: AskType,
	currency = 'USD',
	amount?: number,
) {
	const singular = Math.abs(amount ?? 0) === 1;
	switch (type) {
		case 'time':
			return singular ? 'minute' : 'minutes';
		case 'task':
			return singular ? 'task' : 'tasks';
		case 'item':
			return singular ? 'item' : 'items';
		case 'money':
			return currency.toUpperCase();
		case 'resource':
			return singular ? 'unit' : 'units';
	}
}

export function toStoredAmount(type: AskType, amount: number) {
	return type === 'money' ? Math.round(amount * 100) : Math.round(amount);
}

export function fromStoredAmount(type: AskType, amount: number) {
	return type === 'money' ? amount / 100 : amount;
}

export function formatAskAmount(
	type: AskType,
	amount: number,
	currency = 'USD',
) {
	if (type === 'money') {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency,
		}).format(fromStoredAmount(type, amount));
	}

	return `${amount.toLocaleString()} ${getAskUnitLabel(type, currency, amount)}`;
}
