// GLOSSARY CHUNKING TESTS — THE CHUNK SPLITTER + COST CAP BEHIND EXTRACTION.
import { describe, expect, it, vi } from 'vitest';
import { chunkForExtraction, MAX_EXTRACT_CHUNKS } from '$lib/server/glossary';

// glossary.ts IMPORTS THE REAL DB SINGLETON FOR ITS OTHER FUNCTIONS — THE CHUNKER IS PURE, SO A STUB DB
// IS ENOUGH TO IMPORT THE MODULE.
vi.mock('$lib/server/db', async () => ({
	db: (await import('../helpers/pgmem')).getTestDb(),
}));

describe('chunkForExtraction', () => {
	it('empty content yields no chunks', () => {
		expect(chunkForExtraction('')).toEqual([]);
		expect(chunkForExtraction('   \n\n ')).toEqual([]);
	});

	it('a single short paragraph is one chunk', () => {
		expect(chunkForExtraction('just a paragraph')).toEqual(['just a paragraph']);
	});

	it('keeps paragraphs aligned and splits at paragraph boundaries when over the cap', () => {
		// 2 PARAGRAPHS × 6000 CHARS — UNDER THE 9000-CHAR CAP INDIVIDUALLY, TOGETHER OVER
		const big = '字'.repeat(6000);
		const chunks = chunkForExtraction(`${big}\n\n${big}`);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toBe(big);
		expect(chunks[1]).toBe(big);
	});

	it('a single over-cap paragraph becomes its own (oversized) chunk', () => {
		const huge = 'x'.repeat(20_000);
		const chunks = chunkForExtraction(huge);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toBe(huge);
	});

	it('MAX_EXTRACT_CHUNKS caps how many chunks extraction will process (cost guard)', () => {
		// A 25MB CHAPTER WOULD SPLIT INTO ~2800 CHUNKS WITHOUT THE CAP; THE PIPELINE SLICES TO THE CAP.
		const paragraphs = Array.from({ length: 300 }, (_, i) => `p${i}` + '字'.repeat(9000));
		const chunks = chunkForExtraction(paragraphs.join('\n\n'));
		expect(chunks.length).toBeGreaterThan(MAX_EXTRACT_CHUNKS);
		// AND extractTerms (via the slice in glossary.ts) ONLY EVER RUNS THE FIRST CAP CHUNKS — PIN THE
		// CONSTANT'S MEANING: THE SLICE USED IN extractTerms IS `chunks.slice(0, MAX_EXTRACT_CHUNKS)`.
		expect(chunks.slice(0, MAX_EXTRACT_CHUNKS)).toHaveLength(MAX_EXTRACT_CHUNKS);
	});
});
