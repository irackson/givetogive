import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
	...nextVitals,
	...nextTypeScript,
	{
		rules: {
			'@typescript-eslint/array-type': 'off',
			'@typescript-eslint/consistent-type-imports': [
				'warn',
				{
					prefer: 'type-imports',
					fixStyle: 'inline-type-imports',
				},
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					args: 'all',
					argsIgnorePattern: '^__',
					caughtErrors: 'all',
					caughtErrorsIgnorePattern: '^__',
					ignoreRestSiblings: true,
				},
			],
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'react',
							importNames: ['default'],
							message:
								"Use named imports from 'react' instead of the default import.",
						},
					],
				},
			],
		},
	},
	globalIgnores([
		'chrome-debug-profile/**',
		'.next/**',
		'drizzle/**',
		'next-env.d.ts',
	]),
]);
