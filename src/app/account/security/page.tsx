import {
	AccountNavigation,
	PaymentPage,
} from '@/app/_components/payments/PaymentPrimitives';
import { SecuritySettings } from '@/app/_components/payments/SecuritySettings';
import { auth } from '@/server/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Account security | GiveToGive' };
export default async function SecurityPage() {
	const session = await auth();
	if (!session?.user.id) redirect('/signin?callbackUrl=/account/security');
	return (
		<PaymentPage
			eyebrow='Your account'
			title='Keep your corner safe.'
			description='Protect your account and keep sensitive actions under your control.'
			tone='cobalt'>
			<AccountNavigation current='security' />
			<SecuritySettings />
		</PaymentPage>
	);
}
