import 'code/styles/globals.css';

import { GeistSans } from 'geist/font/sans';
import { type Metadata } from 'next';

import { env } from 'code/env';
import { TRPCReactProvider } from 'code/trpc/react';

import {
	AppBar,
	Box,
	Button,
	Container,
	Toolbar,
	Typography,
} from '@mui/material';
import Link from 'next/link';

export const metadata: Metadata = {
	title:
		env.NODE_ENV === 'production'
			? 'Give to Give (PROD)'
			: 'Give to Give (DEV)',
	description: 'A site for giving',
	icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${GeistSans.variable}`}>
			<body className="min-h-screen bg-gradient-to-b from-[#9284a6] to-[#4ce15d] text-white">
				<TRPCReactProvider>
					{/* Navbar */}
					<AppBar position="static" color="transparent" elevation={0}>
						<Container>
							<Toolbar disableGutters>
								<Typography variant="h6" sx={{ flexGrow: 1 }}>
									Giving Network
								</Typography>
								<Button
									component={Link}
									href="/"
									color="inherit"
								>
									Home
								</Button>
								<Button
									component={Link}
									href="/asks"
									color="inherit"
								>
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
			</body>
		</html>
	);
}
