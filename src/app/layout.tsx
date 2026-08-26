import { env } from '@/env';
import '@/styles/globals.css';
import { TRPCReactProvider } from '@/trpc/react';
import {
	AppBar,
	Box,
	Button,
	Container,
	Toolbar,
	Typography,
} from '@mui/material';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { GeistSans } from 'geist/font/sans';
import { type Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
	title:
		env.NODE_ENV === 'production' ?
			'Give to Give (PROD)'
		:	'Give to Give (DEV)',
	description: 'A site for giving',
	icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export default function RootLayout({
	children,
}: Readonly<{ children: ReactNode }>) {
	return (
		<html
			lang='en'
			className={`${GeistSans.variable}`}>
			<body className='min-h-screen bg-gradient-to-b from-[#9284a6] to-[#4ce15d] text-white'>
				<AppRouterCacheProvider>
					<TRPCReactProvider>
						{/* Navbar */}
						<AppBar
							position='static'
							color='transparent'
							elevation={0}>
							<Container>
								<Toolbar disableGutters>
									<Typography
										variant='h6'
										color={'goldenrod'}
										sx={{ flexGrow: 1 }}>
										Giving Network
									</Typography>
									<Button
										href='/'
										color='inherit'>
										Home
									</Button>
									<Button
										href={'/asks'}
										color='inherit'>
										Asks
									</Button>
								</Toolbar>
							</Container>
						</AppBar>
						{/* Main Content */}
						<Container>
							<Box mt={4}>{children}</Box>
						</Container>
					</TRPCReactProvider>
				</AppRouterCacheProvider>
			</body>
		</html>
	);
}
