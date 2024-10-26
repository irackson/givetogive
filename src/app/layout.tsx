import 'code/styles/globals.css';

import { GeistSans } from 'geist/font/sans';
import { type Metadata } from 'next';

import { TRPCReactProvider } from 'code/trpc/react';
import { env } from 'code/env';

export const metadata: Metadata = {
	title:
		env.NODE_ENV === 'production'
			? 'Give to Give (PROD)'
			: 'Give to Give (DEV)',
	description: 'a site for giving',
	icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${GeistSans.variable}`}>
			<body>
				<TRPCReactProvider>{children}</TRPCReactProvider>
			</body>
		</html>
	);
}
