import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// BUILD_TARGET=capacitor → A STATIC SPA (adapter-static, SPA fallback) FOR THE ANDROID WEBVIEW; OTHERWISE
// THE adapter-node SERVER (web + translation-worker). THE CAPACITOR BUNDLE IS ssr=false (SEE +layout.ts),
// SO THE SPA FALLBACK SERVES /app/ AND EVERYTHING TALKS TO THE HOSTED /api CROSS-ORIGIN.
const isCapacitor = process.env.BUILD_TARGET === 'capacitor';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: isCapacitor
			? // SPA FALLBACK (index.html) — ANY IN-APP PATH RESOLVES TO THE CLIENT ROUTER. OUTPUT TO
				// build-capacitor/ (= capacitor.config.ts webDir), SEPARATE FROM THE node BUILD's build/.
				// strict:false BECAUSE THE SERVER-ONLY ROUTES (/admin, /api) AREN'T PART OF THE NATIVE BUNDLE.
				adapterStatic({
					pages: 'build-capacitor',
					assets: 'build-capacitor',
					fallback: 'index.html',
					precompress: false,
					strict: false,
				})
			: // precompress: SERVE PRE-BUILT .gz / .br FOR CLIENT ASSETS + PRERENDERED PAGES. NATIVE TO adapter-node.
				adapterNode({ precompress: true }),
	},
};

export default config;
