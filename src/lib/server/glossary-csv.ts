// IMPORTED DEP-MODULES
import Papa from 'papaparse';
// IMPORTED TYPES
import type { Gender, TermDraft } from '$lib/types';

// -- TYPES -- //

interface CsvRow {
	// NEW HEADERS (source/target) AND THE LEGACY ONES (raw/translation) ARE BOTH ACCEPTED ON IMPORT.
	source?: string;
	target?: string;
	raw?: string;
	translation?: string;
	context?: string;
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

// PARSE A `source,target,context,description` CSV (LEGACY `raw,translation` HEADERS ALSO ACCEPTED);
// DERIVE gender FROM #masculine/#feminine TAGS
export function parseGlossaryCsv(text: string): TermDraft[] {
	const parsed = Papa.parse<CsvRow>(text, {
		header: true,
		skipEmptyLines: true,
		transformHeader: (h) => h.trim().toLowerCase(),
	});
	// SURFACE A STRUCTURAL PARSE FAILURE (e.g. UNTERMINATED QUOTE) RATHER THAN SILENTLY KEEPING WHATEVER
	// ROWS HAPPENED TO PARSE. A MISSING source/target HEADER IS CAUGHT BY THE per-row CHECK BELOW.
	const fatal = parsed.errors.find((e) => e.type === 'Quotes' || e.type === 'Delimiter');
	if (fatal) throw new Error(`Malformed CSV: ${fatal.message}`);
	const out: TermDraft[] = [];
	for (const row of parsed.data) {
		if (out.length >= MAX_ROWS) throw new Error(`Too many rows (limit ${MAX_ROWS}).`);
		const source = (row.source ?? row.raw)?.trim();
		const target = (row.target ?? row.translation)?.trim();
		if (!source || !target) continue;
		const tags = (row.description ?? '')
			.split(/\s+/)
			.map((t) => t.trim().toLowerCase())
			.filter((t) => t.startsWith('#'));
		const gender = genderFromTags(tags);
		// PRESERVE NON-GENDER TAGS FOR LOSSLESS ROUND-TRIP
		const extra = tags.filter((t) => !['#masculine', '#male', '#feminine', '#female', '#neuter'].includes(t));
		const context = row.context?.trim() || null;
		out.push({ source, target, gender, context, tags: extra.length ? extra.join(' ') : null });
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

// SERIALISE TERMS BACK TO A `source,target,context,description` CSV (ROUND-TRIPS WITH IMPORT)
export function toGlossaryCsv(terms: TermDraft[]): string {
	const rows = terms.map((t) => ({
		source: t.source,
		target: t.target,
		context: t.context ?? '',
		description: descriptionFor(t),
	}));
	return Papa.unparse(rows, { columns: ['source', 'target', 'context', 'description'] });
}
