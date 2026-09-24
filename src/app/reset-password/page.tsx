import { ResetPasswordForm } from '@/app/reset-password/ResetPasswordForm';

export default async function ResetPasswordPage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string }>;
}) {
	const { token } = await searchParams;
	return <ResetPasswordForm token={token ?? ''} />;
}
