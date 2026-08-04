// IMPORTED DEP-TYPES
import type { UserCredential } from 'firebase/auth';
// IMPORTED DEP-MODULES
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
// IMPORTED MODULES
import { firebaseAuth } from '$lib/firebase';

// GOOGLE SIGN-IN (WEB): THE FIREBASE WEB-SDK POPUP.
export async function googleSignIn(): Promise<UserCredential> {
	return signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
}
