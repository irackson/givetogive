import {
	EmptyState,
	EnvironmentNote,
	Money,
	PaymentPage,
	StatusPill,
} from '@/app/_components/payments/PaymentPrimitives';
import { api } from '@/trpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
	title: 'Community funds | GiveToGive',
	description:
		'Give together, help where it is needed, and see how community funds are allocated.',
};

export default async function FundsPage() {
	const [funds, availability] = await Promise.all([
		api.billing.funds(),
		api.billing.availability(),
	]);
	return (
		<PaymentPage
			eyebrow='A little from many'
			title='Together goes further.'
			description='Give once or give monthly. Community funds turn many small contributions into support for eligible neighbors—with a visible record of every allocation.'
			tone='coral'>
			<EnvironmentNote
				environment={availability.environment}
				livemode={availability.livemode}
			/>
			{!availability.funds && (
				<p className='payment-note payment-note--warning'>
					Community-fund payments are not enabled in this environment.
					You can explore published fund records, but no new money can
					be collected.
				</p>
			)}
			{funds.length === 0 ?
				<EmptyState
					title='A shared fund is taking shape.'
					href='/asks'
					action='Help a neighbor directly'>
					No community funds have been published yet. This space will
					show their purpose, available balance, and allocation
					history.
				</EmptyState>
			:	<div className='payment-grid payment-grid--two'>
					{funds.map((fund) => (
						<article
							className='fund-card'
							key={fund.id}>
							<div className='payment-row'>
								<p className='eyebrow'>Community fund</p>
								<StatusPill
									status={fund.active ? 'open' : 'closed'}
								/>
							</div>
							<h2>{fund.name}</h2>
							<p>{fund.description}</p>
							<div className='fund-card__amount'>
								<strong>
									<Money
										amount={fund.availableAmount}
										currency={fund.currency}
									/>
								</strong>
								<small>Available for allocation</small>
							</div>
							<div className='payment-row'>
								<small>
									<Money
										amount={fund.totalAllocated}
										currency={fund.currency}
									/>{' '}
									allocated
								</small>
								<Link
									href={`/funds/${fund.slug}`}
									className='text-link'>
									See the fund ↗
								</Link>
							</div>
						</article>
					))}
				</div>
			}
			<div className='payment-grid'>
				<section className='payment-panel'>
					<p className='eyebrow'>01 / A shared intention</p>
					<h2 className='section-title'>Give a little.</h2>
					<p className='payment-muted'>
						Choose a fund and a one-time or monthly amount. Checkout
						explains the platform fee, processing deduction, and net
						amount going to that fund.
					</p>
				</section>
				<section className='payment-panel'>
					<p className='eyebrow'>02 / Careful allocation</p>
					<h2 className='section-title'>Help with purpose.</h2>
					<p className='payment-muted'>
						Administrators allocate available funds to eligible
						money Asks, with an amount and a recorded reason. This
						is not a wallet or an escrow service.
					</p>
				</section>
				<section className='payment-panel'>
					<p className='eyebrow'>03 / An open record</p>
					<h2 className='section-title'>See where it goes.</h2>
					<p className='payment-muted'>
						Every published allocation links to the Ask it supports.
						Private payment details and bank information stay
						private.
					</p>
				</section>
			</div>
		</PaymentPage>
	);
}
