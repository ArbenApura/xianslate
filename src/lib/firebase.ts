// IMPORTED DEP-TYPES
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/public';
// IMPORTED DEP-MODULES
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// -- CONSTANTS -- //

// FIREBASE WEB CONFIG — ALL PUBLIC VALUES. READ VIA $env/dynamic/public SO A MISSING CONFIG NEVER BREAKS
// `vite build` / svelte-check (UNLIKE $env/static/public, WHICH ERRORS ON AN UNSET VAR). FOR THE CAPACITOR
// STATIC BUILD THESE ARE INLINED AT BUILD TIME.
const config = {
	apiKey: env.PUBLIC_FIREBASE_API_KEY,
	authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN,
	projectId: env.PUBLIC_FIREBASE_PROJECT_ID,
	appId: env.PUBLIC_FIREBASE_APP_ID,
};

// -- FUNCTIONS -- //

// THE FIREBASE WEB APP + Auth SINGLETONS (getApps() GUARDS HMR DOUBLE-INIT). initializeApp DOESN'T CONNECT
// EAGERLY, SO IMPORTING THIS MODULE IS CHEAP; ACTUAL SIGN-IN CALLS HAPPEN IN browser-ONLY EVENT HANDLERS.
export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(config);

export const firebaseAuth: Auth = getAuth(firebaseApp);
