import { SupportCheckoutButton } from '@/app/_components/payments/PaymentActions';
import {
	EnvironmentNote,
	Panel,
	PaymentPage,
} from '@/app/_components/payments/PaymentPrimitives';
import { auth } from '@/server/auth';
import { api } from '@/trpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
	title: 'Support the neighborhood | GiveToGive',
	description:
		'Keep mutual aid open to everyone with an optional GiveToGive supporter membership.',
};

export default async function SupportPage() {
	const [session, availability] = await Promise.all([
		auth(),
		api.billing.availability(),
	]);
	const overview = session?.user.id ? await api.billing.myOverview() : null;
	const hasMembership =
		overview?.subscriptions.some(
			(subscription) =>
				subscription.kind === 'supporter' &&
				!['canceled', 'incomplete_expired'].includes(
					subscription.status,
				),
		) ?? false;
	return (
		<PaymentPage
			eyebrow='A little, together'
			title='Keep a good thing going.'
			description='Help keep this neighborhood open, thoughtful, and useful. Membership supports GiveToGive itself—not an individual Ask or community fund.'
			tone='saffron'
			aside={
				<div
					className='support-art'
					aria-hidden='true'>
					<span>
						↗<small>GOOD THINGS ADD UP</small>
					</span>
				</div>
			}>
			<EnvironmentNote
				environment={availability.environment}
				livemode={availability.livemode}
			/>
			{overview && (
				<p
					className='payment-note'
					role='status'>
					{overview.recognitionStatus === 'pending' ?
						'Your paid recognition is being reconciled. This does not mean your membership has been downgraded.'
					:	`Your current recognition: ${overview.tier === 'neighbor' ? 'Neighbor' : overview.tier}.`
					}
					{hasMembership && (
						<>
							{' '}
							Change your existing membership in{' '}
							<Link
								className='text-link'
								href='/account/billing'>
								Membership & billing
							</Link>
							; you do not need a second subscription.
						</>
					)}
				</p>
			)}
			<div className='payment-grid'>
				<article className='support-card'>
					<span
						className='support-card__symbol'
						aria-hidden='true'>
						☀
					</span>
					<h2>Neighbor</h2>
					<p className='support-card__price'>
						$0 <small>always welcome</small>
					</p>
					<p>
						Being part of the neighborhood is enough. No membership
						needed to give or receive help.
					</p>
					<ul>
						<li>Create every kind of Ask</li>
						<li>Offer help, save Asks, meet neighbors</li>
						<li>Give toward Asks and community funds</li>
						<li>The same chance to be seen and supported</li>
					</ul>
					<div>
						<Link
							className='button-link button-link--paper'
							href='/asks'>
							Explore the community
						</Link>
					</div>
				</article>
				<article className='support-card support-card--supporter'>
					<span
						className='support-card__symbol'
						aria-hidden='true'>
						✳
					</span>
					<h2>Supporter</h2>
					<p className='support-card__price'>
						$5 <small>/ month</small>
					</p>
					<p>
						A small, steady contribution to the place that brings
						neighbors together.
					</p>
					<ul>
						<li>Everything available to a Neighbor</li>
						<li>An optional Supporter badge</li>
						<li>Your personal impact summary</li>
						<li>Manage or cancel anytime</li>
					</ul>
					<div>
						<SupportCheckoutButton
							tier='supporter'
							current={hasMembership}
							enabled={availability.subscriptions}
							signedIn={!!session?.user.id}
						/>
					</div>
				</article>
				<article className='support-card support-card--sustainer'>
					<span
						className='support-card__symbol'
						aria-hidden='true'>
						✷
					</span>
					<h2>Sustainer</h2>
					<p className='support-card__price'>
						$15 <small>/ month</small>
					</p>
					<p>
						The same welcome, with a little more support for the
						work behind the scenes.
					</p>
					<ul>
						<li>Everything available to a Supporter</li>
						<li>An optional Sustainer badge</li>
						<li>A larger contribution to operations</li>
						<li>No special priority for receiving help</li>
					</ul>
					<div>
						<SupportCheckoutButton
							tier='sustainer'
							current={hasMembership}
							enabled={availability.subscriptions}
							signedIn={!!session?.user.id}
						/>
					</div>
				</article>
			</div>
			<p className='payment-note'>
				Help is never a paid privilege. Supporter badges recognize
				optional financial support; they are not identity verification,
				a safety rating, or a guarantee. Prices are in USD, plus any
				applicable tax shown at Checkout.
			</p>
			<Panel
				title='The useful little details.'
				eyebrow='Membership, plainly explained'>
				<div className='payment-faq'>
					<details>
						<summary>Where does my membership go?</summary>
						<p>
							Your subscription supports the operation of
							GiveToGive. Contributions to a neighbor’s Ask or a
							community fund are separate choices, shown
							separately in your giving history.
						</p>
					</details>
					<details>
						<summary>Can I change my mind?</summary>
						<p>
							Yes. Manage your subscription and payment method in
							your billing account. Cancellations and downgrades
							take effect at the end of the current paid period.
							Review a server-confirmed quote before an upgrade.
							Recognition changes after its prorated payment
							succeeds and Stripe applies the change. Scheduled
							changes and pending payments remain visible in your
							billing account.
						</p>
					</details>
					<details>
						<summary>
							Does paying get my Ask more attention?
						</summary>
						<p>
							No. Paid membership does not change search
							placement, who can ask for help, or who gets
							priority for receiving assistance.
						</p>
					</details>
					<details>
						<summary>Is this a tax-deductible donation?</summary>
						<p>
							GiveToGive does not represent membership payments or
							gifts as tax-deductible charitable donations. Keep
							your receipts and seek your own tax advice where
							needed.
						</p>
					</details>
				</div>
			</Panel>
			<div className='payment-row'>
				<Link
					className='text-link'
					href='/funds'>
					Want to support a shared community fund instead? ↗
				</Link>
				<Link
					className='text-link'
					href='/account/billing'>
					Already a supporter? Manage billing ↗
				</Link>
			</div>
		</PaymentPage>
	);
}
