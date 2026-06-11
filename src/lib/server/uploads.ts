// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';

// -- CONSTANTS -- //

export const MB = 1024 * 1024;

// -- FUNCTIONS -- //

// REJECT AN OVERSIZED UPLOAD (413) BEFORE IT IS READ FULLY INTO MEMORY.
export function assertMaxSize(file: File, maxBytes: number): void {
	if (file.size > maxBytes) {
		throw error(413, `File too large — the limit is ${Math.round(maxBytes / MB)} MB.`);
	}
}
