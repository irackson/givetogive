/** @type {import("eslint").Linter.Config} */
const config = {
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: './tsconfig.json',
		extraFileExtensions: ['.json'],
	},
	plugins: [
		'@typescript-eslint',
		'drizzle',
		'deprecation',
		'react-hooks',
		'import',
		'react',
	],
	extends: [
		'next/core-web-vitals',
		'plugin:@typescript-eslint/recommended-type-checked',
		'plugin:@typescript-eslint/stylistic-type-checked',
		'plugin:react/recommended',
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
		'@typescript-eslint/strict-boolean-expressions': 'off',
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
		'react-hooks/exhaustive-deps': [
			'warn',
			{
				additionalHooks:
					'(useRecoilCallback|useRecoilValue|useTrpcMutation|useTrpcQuery|useQuery|useMutation|useInfiniteQuery|useQueries)',
			},
		],
		'no-restricted-imports': [
			'error',
			{
				paths: [
					{
						name: 'react',
						importNames: ['default', 'ReactNode'],
						message:
							"Use named imports for types like `{ type ReactNode }` from 'react' instead of using the default import.",
					},
				],
			},
		],
		'import/no-named-as-default': 'off',
		'import/no-duplicates': 'error',
		'import/order': [
			'warn',
			{
				'newlines-between': 'always',
				'groups': [
					['builtin', 'external', 'internal'],
					['parent', 'sibling', 'index'],
				],
				'warnOnUnassignedImports': true,
			},
		],
		'react/jsx-uses-react': 'off',
		'react/react-in-jsx-scope': 'off',
	},
	ignorePatterns: [
		'chrome-debug-profile',
		'package.json',
		'package-lock.json',
	],
};
module.exports = config;
