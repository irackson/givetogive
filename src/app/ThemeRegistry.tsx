'use client';

import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { ReactNode } from 'react';

const theme = createTheme({
	palette: {
		primary: { main: '#1839ad', dark: '#11277c', light: '#dfe6ff' },
		secondary: { main: '#ef5b43', dark: '#c73c27', light: '#ffe1d9' },
		success: { main: '#16745a', dark: '#0d523f', light: '#d9f3e8' },
		warning: { main: '#bf7a12', light: '#fff0c4' },
		background: { default: '#f7f0e4', paper: '#fffdf8' },
		text: { primary: '#202642', secondary: '#5e6279' },
	},
	typography: {
		fontFamily: 'var(--font-geist-sans), Arial, sans-serif',
		h1: { fontFamily: 'Georgia, Times New Roman, serif', fontWeight: 700 },
		h2: { fontFamily: 'Georgia, Times New Roman, serif', fontWeight: 700 },
		h3: { fontFamily: 'Georgia, Times New Roman, serif', fontWeight: 700 },
		h4: { fontFamily: 'Georgia, Times New Roman, serif', fontWeight: 700 },
		h5: { fontFamily: 'Georgia, Times New Roman, serif', fontWeight: 700 },
		h6: { fontWeight: 750 },
		button: {
			fontWeight: 750,
			letterSpacing: '0.01em',
			textTransform: 'none',
		},
	},
	shape: { borderRadius: 18 },
	components: {
		MuiButton: {
			styleOverrides: {
				root: {
					borderRadius: 999,
					paddingInline: 20,
					boxShadow: 'none',
				},
				contained: { boxShadow: '0 5px 0 rgba(32, 38, 66, 0.18)' },
			},
		},
		MuiTextField: {
			styleOverrides: {
				root: {
					'& .MuiOutlinedInput-root': {
						backgroundColor: '#fffdf8',
						borderRadius: 14,
					},
				},
			},
		},
		MuiDialog: {
			styleOverrides: {
				paper: {
					backgroundImage: 'none',
					border: '2px solid #202642',
					boxShadow: '10px 10px 0 #202642',
				},
			},
		},
	},
});

export function ThemeRegistry({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			{children}
		</ThemeProvider>
	);
}
