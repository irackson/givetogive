import { timingSafeEqual } from 'node:crypto';
import { start } from 'workflow/api';
import { paymentRecoveryWorkflow } from '@/workflows/payments';
import { paymentConfiguration } from '@/server/payments/config';

export const runtime = 'nodejs';
export async function GET(request: Request) {
	const secret = process.env['CRON_SECRET'];
	const expected = Buffer.from(`Bearer ${secret ?? ''}`);
	const provided = Buffer.from(request.headers.get('authorization') ?? '');
	if (
		!secret ||
		expected.length !== provided.length ||
		!timingSafeEqual(expected, provided)
	)
		return new Response(null, { status: 401 });
	if (!paymentConfiguration().configured)
		return Response.json({ skipped: true, reason: 'stripe_unconfigured' });
	const run = await start(paymentRecoveryWorkflow, []);
	return Response.json({ runId: run.runId });
}
