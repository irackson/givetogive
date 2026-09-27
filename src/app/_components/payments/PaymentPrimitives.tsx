import Link from 'next/link';
import type { ReactNode } from 'react';
import './payments.css';

export function Money({
	amount,
	currency = 'USD',
}: {
	amount: number;
	currency?: string;
}) {
	return (
		<>
			{new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency,
			}).format(amount / 100)}
		</>
	);
}

export function DateLabel({
	value,
}: {
	value: Date | string | null | undefined;
}) {
	if (!value) return <>Not recorded</>;
	const date = new Date(value);
	return (
		<time dateTime={date.toISOString()}>
			{new Intl.DateTimeFormat('en-US', {
				dateStyle: 'medium',
				timeZone: 'UTC',
			}).format(date)}
		</time>
	);
}

export function StatusPill({ status }: { status: string }) {
	return (
		<span
			className={`payment-status payment-status--${status.replace(/[^a-z_]/g, '')}`}>
			{status.replaceAll('_', ' ')}
		</span>
	);
}

export function EnvironmentNote({
	environment,
	livemode,
}: {
	environment: string;
	livemode?: boolean;
}) {
	if (environment === 'production' && livemode) return null;
	return (
		<div
			className='payment-environment'
			role='note'>
			<span aria-hidden='true'>◇</span>
			<strong>
				{environment === 'production' ?
					'Payments preview'
				:	`${environment} · synthetic environment`}
			</strong>
			<span>
				{livemode ?
					'Live payment mode'
				:	'Test payments only. No real money moves.'}
			</span>
		</div>
	);
}

export function PaymentPage({
	eyebrow,
	title,
	description,
	children,
	aside,
	tone = 'leaf',
}: {
	eyebrow: string;
	title: string;
	description: string;
	children: ReactNode;
	aside?: ReactNode;
	tone?: 'leaf' | 'cobalt' | 'coral' | 'saffron';
}) {
	return (
		<div className={`payment-page payment-page--${tone}`}>
			<header className='payment-hero'>
				<div className='page-wrap payment-hero__inner'>
					<div>
						<p className='eyebrow'>{eyebrow}</p>
						<h1 className='display-title'>{title}</h1>
						<p className='body-large'>{description}</p>
					</div>
					{aside && (
						<div className='payment-hero__aside'>{aside}</div>
					)}
				</div>
			</header>
			<div className='page-wrap payment-content'>{children}</div>
		</div>
	);
}

export function AccountNavigation({
	current,
}: {
	current: 'giving' | 'billing' | 'receiving' | 'security';
}) {
	return (
		<nav
			className='payment-tabs'
			aria-label='Your account'>
			{(
				[
					{ key: 'giving', href: '/giving', label: 'Your giving' },
					{
						key: 'billing',
						href: '/account/billing',
						label: 'Membership & billing',
					},
					{
						key: 'receiving',
						href: '/account/receiving',
						label: 'Receiving help',
					},
					{
						key: 'security',
						href: '/account/security',
						label: 'Security',
					},
				] as const
			).map((item) => (
				<Link
					key={item.key}
					href={item.href}
					aria-current={current === item.key ? 'page' : undefined}>
					{item.label}
				</Link>
			))}
		</nav>
	);
}

export function EmptyState({
	title,
	children,
	href,
	action,
}: {
	title: string;
	children: ReactNode;
	href?: string;
	action?: string;
}) {
	return (
		<div className='payment-empty'>
			<span
				className='payment-empty__mark'
				aria-hidden='true'>
				↗
			</span>
			<h2>{title}</h2>
			<div>{children}</div>
			{href && action && (
				<Link
					className='text-link'
					href={href}>
					{action} <span aria-hidden='true'>↗</span>
				</Link>
			)}
		</div>
	);
}

export function MetricCard({
	label,
	value,
	explanation,
	tone = 'paper',
}: {
	label: string;
	value: ReactNode;
	explanation: string;
	tone?: 'paper' | 'leaf' | 'cobalt' | 'saffron';
}) {
	return (
		<article className={`payment-metric payment-metric--${tone}`}>
			<h2>{label}</h2>
			<strong>{value}</strong>
			<p>{explanation}</p>
		</article>
	);
}

export function Panel({
	title,
	eyebrow,
	children,
	action,
}: {
	title: string;
	eyebrow?: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<section className='payment-panel'>
			<div className='payment-panel__heading'>
				<div>
					{eyebrow && <p className='eyebrow'>{eyebrow}</p>}
					<h2 className='section-title'>{title}</h2>
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

export function PaymentLoading({
	label = 'Loading your information',
}: {
	label?: string;
}) {
	return (
		<div
			className='payment-loading'
			role='status'>
			<span
				className='payment-loading__dot'
				aria-hidden='true'
			/>
			{label}…
		</div>
	);
}
