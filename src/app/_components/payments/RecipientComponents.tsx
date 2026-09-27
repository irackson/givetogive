'use client';

import { api } from '@/trpc/react';
import { Alert, Button, Tab, Tabs } from '@mui/material';
import {
	loadConnectAndInitialize,
	type StripeConnectInstance,
} from '@stripe/connect-js/pure';
import {
	ConnectAccountManagement,
	ConnectAccountOnboarding,
	ConnectComponentsProvider,
	ConnectNotificationBanner,
	ConnectPayouts,
} from '@stripe/react-connect-js';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RecipientDashboardButton } from './PaymentActions';

export function RecipientComponents({
	enabled,
	initiallyReady,
}: {
	enabled: boolean;
	initiallyReady: boolean;
}) {
	const utils = api.useUtils();
	const router = useRouter();
	const loadError = () =>
		setError(
			'Stripe could not load this view. Try the Express dashboard below, or refresh the page.',
		);
	const session = api.billing.createRecipientSession.useMutation();
	const [instance, setInstance] = useState<StripeConnectInstance | null>(
		null,
	);
	const [tab, setTab] = useState(initiallyReady ? 'payouts' : 'onboarding');
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const instanceRef = useRef<StripeConnectInstance | null>(null);
	useEffect(
		() => () => {
			void instanceRef.current?.logout();
		},
		[],
	);
	async function open() {
		setStarting(true);
		setError(null);
		try {
			const initial = await session.mutateAsync();
			if (!initial.publishableKey)
				throw new Error(
					'Stripe receiving is not configured in this environment yet.',
				);
			let firstSecret: string | null = initial.clientSecret;
			const connect = loadConnectAndInitialize({
				publishableKey: initial.publishableKey,
				fetchClientSecret: async () => {
					if (firstSecret) {
						const value = firstSecret;
						firstSecret = null;
						return value;
					}
					return (await session.mutateAsync()).clientSecret;
				},
				appearance: {
					overlays: 'dialog',
					variables: {
						colorPrimary: '#1839ad',
						colorBackground: '#fffdf8',
						colorText: '#202642',
						borderRadius: '14px',
						fontFamily: 'Arial, sans-serif',
					},
				},
			});
			instanceRef.current = connect;
			setInstance(connect);
		} catch (reason) {
			setError(
				reason instanceof Error ?
					reason.message
				:	'Stripe could not be opened. Please try again.',
			);
		} finally {
			setStarting(false);
		}
	}
	return (
		<div className='payment-stack'>
			{!enabled && (
				<Alert severity='info'>
					Recipient onboarding is not enabled in this environment yet.
				</Alert>
			)}
			{error && <Alert severity='error'>{error}</Alert>}
			{!instance ?
				<>
					<p className='payment-muted'>
						Stripe securely collects the details needed to receive
						money. GiveToGive does not store bank account numbers or
						identity documents. Availability depends on Stripe
						verification.
					</p>
					<div>
						<Button
							variant='contained'
							disabled={!enabled || starting}
							onClick={() => void open()}>
							{starting ?
								'Connecting securely…'
							: initiallyReady ?
								'Open your receiving account'
							:	'Set up receiving with Stripe'}
						</Button>
					</div>
				</>
			:	<ConnectComponentsProvider connectInstance={instance}>
					<ConnectNotificationBanner onLoadError={loadError} />
					<Tabs
						value={tab}
						onChange={(__, value: string) => setTab(value)}
						variant='scrollable'
						scrollButtons='auto'
						aria-label='Stripe receiving account'>
						<Tab
							label='Setup & verification'
							value='onboarding'
							id='receiving-tab-onboarding'
							aria-controls='receiving-panel-onboarding'
						/>
						<Tab
							label='Payouts'
							value='payouts'
							id='receiving-tab-payouts'
							aria-controls='receiving-panel-payouts'
						/>
						<Tab
							label='Account details'
							value='details'
							id='receiving-tab-details'
							aria-controls='receiving-panel-details'
						/>
					</Tabs>
					<div
						role='tabpanel'
						id={`receiving-panel-${tab}`}
						aria-labelledby={`receiving-tab-${tab}`}>
						{tab === 'onboarding' && (
							<ConnectAccountOnboarding
								onLoadError={loadError}
								onExit={() => {
									void utils.billing.myRecipient.invalidate();
									router.refresh();
									setTab('payouts');
								}}
							/>
						)}
						{tab === 'payouts' && (
							<ConnectPayouts onLoadError={loadError} />
						)}
						{tab === 'details' && (
							<ConnectAccountManagement onLoadError={loadError} />
						)}
					</div>
					<RecipientDashboardButton />
					<div>
						<Button onClick={() => router.refresh()}>
							Refresh verification status
						</Button>
					</div>
				</ConnectComponentsProvider>
			}
		</div>
	);
}
