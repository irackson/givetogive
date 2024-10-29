/** @type {import("eslint").Linter.Config} */
const config = {
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: true,
	},
	plugins: ['@typescript-eslint', 'drizzle'],
	extends: [
		'next/core-web-vitals',
		'plugin:@typescript-eslint/recommended-type-checked',
		'plugin:@typescript-eslint/stylistic-type-checked',
	],
	rules: {
		'@typescript-eslint/array-type': 'off',
		'@typescript-eslint/consistent-type-definitions': 'warn',
		'@typescript-eslint/consistent-type-imports': [
			'warn',
			{
				prefer: 'type-imports',
				fixStyle: 'inline-type-imports',
			},
		],
		'@typescript-eslint/no-unused-vars': [
			'warn',
			{
				args: 'all',
				argsIgnorePattern: '^__',
				caughtErrors: 'all',
				caughtErrorsIgnorePattern: '^__',
				// destructuredArrayIgnorePattern: '^_',
				// varsIgnorePattern: '^__',
				ignoreRestSiblings: true,
			},
		],
		'@typescript-eslint/require-await': 'off',
		'@typescript-eslint/no-misused-promises': [
			'error',
			{
				checksVoidReturn: {
					attributes: false,
				},
			},
		],
		'react/no-children-prop': [
			'warn',
			{
				allowFunctions: true,
			},
		],
		'drizzle/enforce-delete-with-where': [
			'error',
			{
				drizzleObjectName: ['db', 'ctx.db'],
			},
		],
		'drizzle/enforce-update-with-where': [
			'error',
			{
				drizzleObjectName: ['db', 'ctx.db'],
			},
		],
	},
};
module.exports = config;
