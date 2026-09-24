import { SigninForm } from '@/app/signin/SigninForm';

export default async function SigninPage({
	searchParams,
}: {
	searchParams: Promise<{ callbackUrl?: string }>;
}) {
	const { callbackUrl } = await searchParams;
	return (
		<SigninForm
			callbackUrl={callbackUrl?.startsWith('/') ? callbackUrl : '/'}
		/>
	);
}
