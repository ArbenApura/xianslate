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
		// build*/.svelte-kit/package/drizzle: generated. tools/: ad-hoc dev/test scripts (some gitignored).
		// android/ios: native Capacitor projects (incl. the synced web bundle) — not our lint domain.
		ignores: [
			'build/',
			'build-capacitor/',
			'.svelte-kit/',
			'package/',
			'drizzle/',
			'tools/',
			'android/',
			'ios/',
			'*.db',
		],
	},
];
