import type { CapacitorConfig } from '@capacitor/cli';

// CAPACITOR NATIVE CONFIG — THE MOBILE APP IS THE STATIC SPA FROM `yarn build:capacitor` (build-capacitor/),
// WHICH TALKS TO THE DEPLOYED API CROSS-ORIGIN (PUBLIC_API_BASE). webDir MUST MATCH THE ADAPTER-STATIC
// OUTPUT DIR IN vite.config.ts.
const config: CapacitorConfig = {
	appId: 'com.xianslate.app',
	appName: 'Xianslate',
	webDir: 'build-capacitor',
	// ANDROID SERVES THE SPA AT https://localhost (iOS WKWebView USES capacitor://localhost BY DEFAULT) —
	// BOTH ARE ALLOWED AS CORS ORIGINS BY THE SERVER (see src/hooks.server.ts).
	server: {
		androidScheme: 'https',
	},
	plugins: {
		FirebaseAuthentication: {
			// THE FIREBASE WEB SDK IS THE SINGLE SESSION SOURCE (EMAIL/PASSWORD + GOOGLE BRIDGED VIA
			// signInWithCredential IN src/lib/google-auth.ts). skipNativeAuth: true MAKES THE PLUGIN RETURN
			// THE ID TOKEN WITHOUT CREATING A SEPARATE NATIVE FIREBASE SESSION; google.com IS THE ONLY
			// PROVIDER THE APP USES.
			skipNativeAuth: true,
			providers: ['google.com'],
		},
	},
};

export default config;
