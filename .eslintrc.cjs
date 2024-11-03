/** @type {import("eslint").Linter.Config} */
const config = {
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: true,
	},
	plugins: ['@typescript-eslint', 'drizzle', 'deprecation', 'react-hooks'],
	extends: [
		'next/core-web-vitals',
		'plugin:@typescript-eslint/recommended-type-checked',
		'plugin:@typescript-eslint/stylistic-type-checked',
	],
	rules: {
		'@typescript-eslint/array-type': 'off',
		'@typescript-eslint/consistent-type-definitions': 'warn',
		'@typescript-eslint/dot-notation': 'off',
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
				ignoreRestSiblings: true,
			},
		],
		'@typescript-eslint/require-await': 'off',
		'@typescript-eslint/no-explicit-any': 'warn',
		'@typescript-eslint/consistent-indexed-object-style': [
			'warn',
			'record',
		],
		'@typescript-eslint/strict-boolean-expressions': 'warn',
		'@typescript-eslint/no-floating-promises': 'warn',
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
		'deprecation/deprecation': 'warn',
		'react-hooks/rules-of-hooks': 'error',
		'react-hooks/exhaustive-deps': 'warn',
	},
};
module.exports = config;
