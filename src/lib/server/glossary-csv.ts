// IMPORTED DEP-MODULES
import Papa from 'papaparse';
// IMPORTED TYPES
import type { Gender, TermDraft } from '$lib/types';

// -- TYPES -- //

interface CsvRow {
	raw?: string;
	translation?: string;
	description?: string;
}

// -- CONSTANTS -- //

// HARD CAP ON IMPORTED ROWS — A 10 MB CSV COULD OTHERWISE MATERIALISE 100k+ DRAFTS IN MEMORY.
const MAX_ROWS = 100_000;

// -- FUNCTIONS -- //

function genderFromTags(tags: string[]): Gender {
	if (tags.includes('#masculine') || tags.includes('#male')) return 'masculine';
	if (tags.includes('#feminine') || tags.includes('#female')) return 'feminine';
	return 'neuter';
}

// PARSE A `raw,translation,description` CSV; DERIVE gender FROM #masculine/#feminine TAGS
export function parseGlossaryCsv(text: string): TermDraft[] {
	const parsed = Papa.parse<CsvRow>(text, {
		header: true,
		skipEmptyLines: true,
		transformHeader: (h) => h.trim().toLowerCase(),
	});
	// SURFACE A STRUCTURAL PARSE FAILURE (e.g. UNTERMINATED QUOTE) RATHER THAN SILENTLY KEEPING WHATEVER
	// ROWS HAPPENED TO PARSE. A MISSING raw/translation HEADER IS CAUGHT BY THE per-row CHECK BELOW.
	const fatal = parsed.errors.find((e) => e.type === 'Quotes' || e.type === 'Delimiter');
	if (fatal) throw new Error(`Malformed CSV: ${fatal.message}`);
	const out: TermDraft[] = [];
	for (const row of parsed.data) {
		if (out.length >= MAX_ROWS) throw new Error(`Too many rows (limit ${MAX_ROWS}).`);
		const raw = row.raw?.trim();
		const translation = row.translation?.trim();
		if (!raw || !translation) continue;
		const tags = (row.description ?? '')
			.split(/\s+/)
			.map((t) => t.trim().toLowerCase())
			.filter((t) => t.startsWith('#'));
		const gender = genderFromTags(tags);
		// PRESERVE NON-GENDER TAGS FOR LOSSLESS ROUND-TRIP
		const extra = tags.filter((t) => !['#masculine', '#male', '#feminine', '#female', '#neuter'].includes(t));
		out.push({ raw, translation, gender, tags: extra.length ? extra.join(' ') : null });
	}
	return out;
}

function descriptionFor(t: TermDraft): string {
	const parts: string[] = [];
	if (t.gender === 'masculine') parts.push('#masculine');
	else if (t.gender === 'feminine') parts.push('#feminine');
	if (t.tags) parts.push(t.tags);
	return parts.join(' ');
}

// SERIALISE TERMS BACK TO THE SAME `raw,translation,description` FORMAT (ROUND-TRIPS WITH IMPORT)
export function toGlossaryCsv(terms: TermDraft[]): string {
	const rows = terms.map((t) => ({ raw: t.raw, translation: t.translation, description: descriptionFor(t) }));
	return Papa.unparse(rows, { columns: ['raw', 'translation', 'description'] });
}
