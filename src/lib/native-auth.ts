// IMPORTED DEP-TYPES
import type { UserCredential } from 'firebase/auth';
// IMPORTED DEP-MODULES
import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
// IMPORTED MODULES
import { firebaseAuth } from '$lib/firebase';

// GOOGLE SIGN-IN THAT WORKS IN BOTH TARGETS:
//  - WEB: the Firebase web-SDK popup.
//  - NATIVE (capacitor): the @capacitor-firebase/authentication plugin does the *native* Google flow (no
//    webview redirect), then we sign the web SDK in with the returned credential so firebaseAuth.currentUser
//    (which apiFetch reads for the bearer token) is populated. The plugin is dynamically imported so it's
//    only loaded in the native bundle.
export async function googleSignIn(): Promise<UserCredential> {
	if (!__CAPACITOR_BUILD__) {
		return signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
	}
	const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
	const result = await FirebaseAuthentication.signInWithGoogle();
	const credential = GoogleAuthProvider.credential(result.credential?.idToken, result.credential?.accessToken);
	return signInWithCredential(firebaseAuth(), credential);
}
