import { env } from 'code/env';
import type { NextConfig } from 'next';

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
console.info(
	`Loaded with environment: ${env.NODE_ENV} (from ${import.meta.url})`,
);
const config: NextConfig = {
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
	experimental: {
		typedRoutes: true,
		// reactCompiler: true, //! TODO: resolve emotion deps
		// ppr: true,
	},

	typescript: {
		ignoreBuildErrors: false,
	},
	logging: {
		fetches: {
			fullUrl: true,
		},
	},
	eslint: {
		ignoreDuringBuilds: false,
	},
	devIndicators: {
		buildActivity: true,
		buildActivityPosition: 'top-right',
	},
};

export default config;
