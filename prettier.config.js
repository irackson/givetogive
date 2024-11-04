/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
const config = {
	plugins: ['prettier-plugin-tailwindcss'],
	tabWidth: 4,
	useTabs: true,
	singleQuote: true,
	experimentalTernaries: true,
	arrowParens: 'always',
	printWidth: 80,
	bracketSameLine: true,
	htmlWhitespaceSensitivity: 'strict',
	jsxSingleQuote: true,
	bracketSpacing: true,
	quoteProps: 'consistent',
	singleAttributePerLine: true,
	trailingComma: 'all',
	overrides: [
		{
			files: '*.html',
			options: {
				htmlWhitespaceSensitivity: 'ignore',
			},
		},
	],
};

export default config;
