import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapterStatic from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';

// CAPACITOR STATIC SPA CONFIG — USED ONLY WHEN CAPACITOR_BUILD=1 (yarn build:capacitor → a fully static
// build served by the native WebView, talking to the live API via PUBLIC_API_BASE). FOR EVERYTHING ELSE
// (yarn dev / yarn build — THE WEB APP) sveltekit() GETS undefined AND FALLS BACK TO svelte.config.js
// (adapter-node, SSR) — PASSING A CONFIG OBJECT HERE MAKES SVELTEKIT USE IT INSTEAD OF svelte.config.js.
const capacitorSvelteKitConfig =
	process.env.CAPACITOR_BUILD === '1'
		? {
				preprocess: vitePreprocess(),
				adapter: adapterStatic({
					pages: 'build-capacitor',
					assets: 'build-capacitor',
					// THE SPA FALLBACK — NAMED index.html BECAUSE CAPACITOR'S WebView LOADS index.html AS THE
					// APP ENTRY (AND THE CLIENT-SIDE ROUTER HANDLES EVERY PATH FROM THERE).
					fallback: 'index.html',
				}),
				// CAPACITOR-ONLY PAGE TEMPLATE: app.html PLUS THE __data.json INTERCEPTOR (THE WEBVIEW'S
				// LOCAL SERVER CANNOT SERVE SvelteKit'S DATA ENDPOINTS — SEE src/app-capacitor.html).
				files: {
					appTemplate: 'src/app-capacitor.html',
				},
			}
		: undefined;

export default defineConfig({
	plugins: [sveltekit(capacitorSvelteKitConfig)],
	// FORCE VITE TO PROCESS lucide-svelte'S .svelte ICON FILES INSTEAD OF EXTERNALIZING THEM,
	// WHICH NODE'S NATIVE ESM LOADER REJECTS (ERR_UNKNOWN_FILE_EXTENSION ".svelte") UNDER SSR.
	ssr: {
		noExternal: ['lucide-svelte'],
	},
});
