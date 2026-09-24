import { SiteFooter } from '@/app/_components/SiteFooter';
import { SiteHeader } from '@/app/_components/SiteHeader';
import { ThemeRegistry } from '@/app/ThemeRegistry';
import { getServerAuthSession } from '@/server/auth';
import '@/styles/globals.css';
import { TRPCReactProvider } from '@/trpc/react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { GeistSans } from 'geist/font/sans';
import { type Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
	title: 'GiveToGive | Mutual aid, made neighborly',
	description: 'Ask for help. Offer what you can. Keep good things moving.',
	icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export default async function RootLayout({
	children,
}: Readonly<{ children: ReactNode }>) {
	const session = await getServerAuthSession();

	return (
		<html
			lang='en'
			className={`${GeistSans.variable}`}
			data-scroll-behavior='smooth'>
			<body>
				<AppRouterCacheProvider>
					<ThemeRegistry>
						<TRPCReactProvider>
							<div className='site-shell'>
								<SiteHeader
									memberName={session?.user?.name ?? null}
								/>
								<main className='site-main'>{children}</main>
								<SiteFooter />
							</div>
						</TRPCReactProvider>
					</ThemeRegistry>
				</AppRouterCacheProvider>
			</body>
		</html>
	);
}
