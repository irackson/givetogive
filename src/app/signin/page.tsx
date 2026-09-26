import { SigninForm } from '@/app/signin/SigninForm';
import { safeCallbackPath } from '@/lib/safeCallbackPath';

export default async function SigninPage({
	searchParams,
}: {
	searchParams: Promise<{ callbackUrl?: string }>;
}) {
	const { callbackUrl } = await searchParams;
	return (
		<SigninForm
			callbackUrl={safeCallbackPath(callbackUrl)}
		/>
	);
}
