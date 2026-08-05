// IMPORTED DEP-TYPES
import type { UserCredential } from 'firebase/auth';
// IMPORTED DEP-MODULES
import { Capacitor } from '@capacitor/core';
import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
// IMPORTED MODULES
import { firebaseAuth } from '$lib/firebase';

// GOOGLE SIGN-IN. WEB: THE FIREBASE WEB-SDK POPUP (THE NORMAL BROWSER FLOW). NATIVE (CAPACITOR): A POPUP
// CANNOT OPEN INSIDE A WEBVIEW, SO WE USE THE NATIVE GOOGLE SIGN-IN AND BRIDGE ITS RESULT INTO THE FIREBASE
// WEB SDK (signInWithCredential) — THE SESSION THEN PERSISTS EXACTLY LIKE EMAIL/PASSWORD, AND THE ID TOKEN
// FLOWS TO THE SERVER AS THE USUAL Bearer. (THE PLUGIN IS DYNAMICALLY IMPORTED SO THE WEB BUNDLE STAYS
// FREE OF ITS NATIVE CODE.)
export async function googleSignIn(): Promise<UserCredential> {
	if (Capacitor.isNativePlatform()) {
		const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
		const result = await FirebaseAuthentication.signInWithGoogle();
		const idToken = result.credential?.idToken;
		// A GOOGLE SIGN-IN WITH NO ID TOKEN IS A FAILED FLOW — DON'T MINT A CREDENTIAL OUT OF NOTHING.
		if (!idToken) throw new Error('Google sign-in did not return an ID token.');
		const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken ?? undefined);
		return signInWithCredential(firebaseAuth(), credential);
	}
	return signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
}
