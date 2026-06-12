// See https://svelte.dev/docs/kit/types#app.d.ts
import type { AuthUser } from '$lib/server/auth/user';

declare global {
	// COMPILE-TIME FLAG INJECTED BY vite.config.ts `define` — true ONLY IN THE CAPACITOR STATIC-SPA BUILD.
	// READ AS A GLOBAL BY +layout.ts PAGE OPTIONS (ssr) AND THE NATIVE-vs-WEB apiFetch BRANCH.
	var __CAPACITOR_BUILD__: boolean;

	namespace App {
		// interface Error {}
		interface Locals {
			// THE AUTHENTICATED USER (POPULATED BY hooks.server.ts FROM A SESSION COOKIE OR BEARER TOKEN);
			// null WHEN SIGNED OUT.
			user: AuthUser | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
