import { start } from 'workflow/api';
import { acceptStripeWebhook } from '@/server/payments/webhooks';
import { stripeWebhookWorkflow } from '@/workflows/payments';

export const runtime = 'nodejs';

/** Connected-account snapshot events have their own destination/signing secret. */
export async function POST(request: Request) {
	const signature = request.headers.get('stripe-signature');
	if (!signature)
		return Response.json({ error: 'Missing signature.' }, { status: 400 });
	if (Number(request.headers.get('content-length') ?? 0) > 1_000_000)
		return new Response(null, { status: 413 });
	const payload = await request.text();
	if (payload.length > 1_000_000) return new Response(null, { status: 413 });
	let id: string | null;
	try {
		id = await acceptStripeWebhook(payload, signature, false, true);
	} catch {
		return Response.json(
			{ error: 'Webhook could not be verified or persisted.' },
			{ status: 400 },
		);
	}
	if (id) {
		try {
			await start(stripeWebhookWorkflow, [id]);
		} catch {
			return Response.json(
				{ error: 'Processing unavailable; retry delivery.' },
				{ status: 503 },
			);
		}
	}
	return Response.json({ received: true });
}
