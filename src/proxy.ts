import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
	const nonce = randomBytes(18).toString('base64');
	const development = process.env.NODE_ENV === 'development';
	const csp = [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://*.stripe.com https://*.link.com${development ? " 'unsafe-eval'" : ''}`,
		// MUI/Emotion and existing inline style properties need this; scripts do not.
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https://*.stripe.com https://*.link.com https://cdn.discordapp.com",
		"font-src 'self' data:",
		`connect-src 'self' https://*.stripe.com https://*.link.com${development ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
		"frame-src https://*.stripe.com https://*.link.com",
		"object-src 'none'", "base-uri 'self'", "form-action 'self' https://*.stripe.com",
		"frame-ancestors 'none'",
		...(request.nextUrl.protocol === 'https:' ? ['upgrade-insecure-requests'] : []),
	].join('; ');
	const headers = new Headers(request.headers);
	headers.set('x-nonce', nonce);
	headers.set('Content-Security-Policy', csp);
	const response = NextResponse.next({ request: { headers } });
	response.headers.set('Content-Security-Policy', csp);
	return response;
}

export const config = {
	matcher: [{
		source: '/((?!api|mcp|[.]well-known|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2)$).*)',
		missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }],
	}],
};
