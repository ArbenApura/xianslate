import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// precompress: SERVE PRE-BUILT .gz / .br FOR CLIENT ASSETS + PRERENDERED PAGES (SMALLER PAYLOADS,
		// NO RUNTIME COMPRESSION COST). NATIVE TO adapter-node — NO EXTRA DEPENDENCIES.
		adapter: adapter({ precompress: true }),
	},
};

export default config;
