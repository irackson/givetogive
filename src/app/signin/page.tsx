import { SigninForm } from '@/app/signin/SigninForm';
import { safeCallbackPath } from '@/lib/safeCallbackPath';
import { getBillingAuthSession } from '@/server/auth';
import { redirect } from 'next/navigation';

export default async function SigninPage({
	searchParams,
}: {
	searchParams: Promise<{ callbackUrl?: string }>;
}) {
	const { callbackUrl } = await searchParams;
	const target = safeCallbackPath(callbackUrl);
	const session = await getBillingAuthSession();
	if (session?.user?.id) {
		if (session.access === 'billing_only') redirect('/account/billing');
		const pathname = new URL(target, 'http://localhost').pathname;
		redirect(
			(
				/^\/(?:signin|signout|auth-error|api\/auth)(?:\/|$)/.test(
					pathname,
				)
			) ?
				'/asks'
			:	target,
		);
	}
	return <SigninForm callbackUrl={target} />;
}
