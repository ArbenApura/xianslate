// See https://svelte.dev/docs/kit/types#app.d.ts
import type { AuthUser } from '$lib/server/auth/user';

declare global {
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
