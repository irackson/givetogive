import type { ReactNode } from 'react';

export function AuthFrame({
	eyebrow,
	title,
	description,
	children,
	variant = 'default',
}: {
	eyebrow: string;
	title: string;
	description?: string;
	children: ReactNode;
	variant?: string;
}) {
	return (
		<div className={`auth-page auth-page--${variant}`}>
			<div
				className='auth-page__poster'
				aria-hidden='true'>
				<span className='auth-poster__sun' />
				<span className='auth-poster__arch auth-poster__arch--one' />
				<span className='auth-poster__arch auth-poster__arch--two' />
				<p>
					small help
					<br />
					moves far
				</p>
			</div>
			<section className='auth-card'>
				<p className='eyebrow'>{eyebrow}</p>
				<h1>{title}</h1>
				{description && (
					<p className='auth-card__description'>{description}</p>
				)}
				{children}
			</section>
		</div>
	);
}
