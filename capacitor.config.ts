import type { CapacitorConfig } from '@capacitor/cli';

// CAPACITOR NATIVE CONFIG — THE MOBILE APP IS THE STATIC SPA FROM `yarn build:capacitor` (build-capacitor/),
// WHICH TALKS TO THE DEPLOYED API CROSS-ORIGIN (PUBLIC_API_BASE). webDir MUST MATCH THE ADAPTER-STATIC
// OUTPUT DIR IN vite.config.ts.
const config: CapacitorConfig = {
	appId: 'dev.xianslate.app',
	appName: 'Xianslate',
	webDir: 'build-capacitor',
	// ANDROID SERVES THE SPA AT https://localhost (WKWebVIEW ON iOS USES capacitor://localhost BY DEFAULT) —
	// BOTH ARE ALLOWED AS CORS ORIGINS BY THE SERVER (see src/hooks.server.ts).
	androidScheme: 'https',
};

export default config;
