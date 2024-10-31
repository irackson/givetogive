//@ts-check
/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import('./src/env.js');

/** @type {import("next").NextConfig} */
const config = {
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
