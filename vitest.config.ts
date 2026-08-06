// VITEST CONFIGURATION — THE SINGLE TEST HARNESS FOR THE WHOLE REPO.
//
// WHY NOT THE sveltekit() PLUGIN HERE: VITEST TRANSFORMS EVERYTHING THROUGH THE SSR PIPELINE, AND THE
// SVELTEKIT PLUGIN'S SVELTE COMPILER THEN COMPILES COMPONENTS IN SSR MODE — onMount/onDestroy NEVER FIRE,
// SO COMPONENT TESTS WOULD BE HOLLOW. THIS CONFIG USES @sveltejs/vite-plugin-svelte DIRECTLY (ITS TRANSFORM
// ALREADY RUNS WITH ssr:false UNDER VITEST — VERIFIED EMPIRICALLY), PLUS MANUAL ALIASES FOR WHAT THE APP
// RESOLVES VIA SVELTEKIT:
//   $lib                    → src/lib
//   $env/dynamic/private    → a live process.env DOUBLE (THE SVELTEKIT VIRTUAL MODULE IS A LITERAL {} IN
//                             TEST MODE — WITHOUT THIS, ENV-DEPENDENT MODULES SEE ONLY DEFAULTS)
//   $app/environment        → a browser:true stub
//
// KNOWN HARNESS LIMITATION (DOCUMENTED IN TESTING.md): SVELTE 4 LIFECYCLE HOOKS (onMount/onDestroy) DO NOT
// FIRE FOR COMPONENTS MOUNTED UNDER VITEST+jsdom (vitest SSR-REWRITES THE MODULE IMPORTS, WHICH BREAKS THE
// DEV-RUNTIME SCHEDULER). PURE-RENDER/INTERACTION COMPONENT TESTS WORK (Modal, TocDrawer); LIFECYCLE-DRIVEN
// COMPONENTS ARE COVERED BY THE PURE LOGIC SUITES + LIVE EMULATOR CHECKS INSTEAD.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		svelte({
			// generate IS CONTROLLED BY THE PLUGIN ITSELF (DOM EXCEPT IN SSR) — SETTING IT IS IGNORED
			// AND WARNED ABOUT. hot:false KEEPS THE DEV SERVER OUT OF THE TEST PIPELINE.
			hot: false,
		}),
	],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			'$env/dynamic/private': fileURLToPath(new URL('./tests/helpers/env-dynamic.ts', import.meta.url)),
			'$app/environment': fileURLToPath(new URL('./tests/helpers/app-environment.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
		// ONE WORKER PER TEST FILE IS ENOUGH HERE AND KEEPS pg-mem/fake-indexeddb INSTANCES ISOLATED.
		fileParallelism: false,
		// COVERAGE IS OPT-IN (yarn test:coverage) — CI GATES ON THE THRESHOLDS BELOW.
		coverage: {
			provider: 'v8',
			// NARROW TO THE MODULES THE SUITE ACTUALLY EXERCISES — THE FULL src/lib SET IS DRAGGED TO ~26% BY
			// CLIENT-ONLY FILES (firebase, api, markup, …) THAT UNIT TESTS DELIBERATELY DON'T IMPORT.
			include: [
				'src/lib/server/account-usage.ts',
				'src/lib/server/spend-guard.ts',
				'src/lib/server/deepseek.ts',
				'src/lib/server/glossary.ts',
				'src/lib/server/glossary-match.ts',
				'src/lib/server/fetcher.ts',
				'src/lib/server/site-parser.ts',
				'src/lib/server/charset.ts',
				'src/lib/server/ingest/**',
				'src/lib/offline/db.ts',
				'src/lib/offline/covers.ts',
				'src/lib/offline/gate.ts',
				'src/lib/offline/outbox-core.ts',
				'src/lib/offline/outbox.ts',
				'src/lib/reader-progress.ts',
			],
			reporter: ['text', 'json-summary'],
			// CI GATE (yarn test:coverage): LOCKS THE COVERAGE THE SUITE HAS TODAY — A REGRESSION IN ANY OF
			// THE COVERED MODULES FAILS THE BUILD. THE 65% TARGET FOR lib/server+lib/offline IS DOCUMENTED IN
			// TESTING.md AS THE GROWTH PATH (site-parser.ts / fetcher.ts ARE THE BIG REMAINING SURFACES).
			thresholds: { lines: 45, statements: 40, functions: 50, branches: 28 },
		},
	},
});
