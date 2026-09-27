import { env } from '@/env';
import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
console.info(
	`Loaded with environment: ${env.NODE_ENV} (from ${import.meta.url})`,
);
const config: NextConfig = {
	async headers() {
		return [{ source: '/(.*)', headers: [
			{ key: 'X-Content-Type-Options', value: 'nosniff' },
			{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
			{ key: 'X-Frame-Options', value: 'DENY' },
			...(env.APP_ENV === 'staging' || env.APP_ENV === 'test' ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }] : []),
		] }];
	},
	compiler: {
		// Enables the styled-components SWC transform
		styledComponents: true,
	},

	modularizeImports: {
		'@mui/icons-material': {
			transform: '@mui/icons-material/{{member}}',
		},
	},

	reactStrictMode: true,
	typedRoutes: true,
	experimental: {
		// reactCompiler: true, //! TODO: resolve emotion deps
		// ppr: true,
	},

	typescript: {
		ignoreBuildErrors: false,
	},
	logging: {
		fetches: {
			fullUrl: false,
		},
	},
	devIndicators: {
		position: 'top-right',
	},
};

export default withWorkflow(config);
