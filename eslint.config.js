import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
			},
		},
	},
	{
		// ALLOW `_`-PREFIXED ARGS/VARS THAT EXIST ONLY FOR A SIGNATURE OR TO DECLARE A REACTIVE DEPENDENCY
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
			],
		},
	},
	{
		ignores: ['build/', '.svelte-kit/', 'package/', 'drizzle/', '*.db'],
	},
];
