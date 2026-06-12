import type { CapacitorConfig } from '@capacitor/cli';

// CAPACITOR (ANDROID) CONFIG. THE WEB ASSETS ARE THE STATIC SPA FROM `BUILD_TARGET=capacitor npm run build`
// (svelte.config.js → adapter-static → build-capacitor/). androidScheme:'https' SERVES THE WEBVIEW FROM
// https://localhost SO FIREBASE AUTH + COOKIES BEHAVE; THE APP TALKS TO THE HOSTED https://xianslate.com/api
// CROSS-ORIGIN WITH A BEARER TOKEN (PUBLIC_API_BASE + apiFetch + the /api CORS handle).
const config: CapacitorConfig = {
	appId: 'com.xianslate.app',
	appName: 'Xianslate',
	webDir: 'build-capacitor',
	server: {
		// https (NOT a custom scheme) — custom schemes break routing as of WebView 117 (Capacitor docs).
		androidScheme: 'https',
	},
	plugins: {
		// @capacitor-firebase/authentication: native Google sign-in (skipNativeAuth=false syncs the web SDK
		// via the returned credential — see src/lib/native-auth.ts).
		FirebaseAuthentication: {
			skipNativeAuth: false,
			providers: ['google.com'],
		},
	},
};

export default config;
