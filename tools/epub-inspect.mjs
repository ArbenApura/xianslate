// STRUCTURAL DIAGNOSTIC: dump container.xml, OPF spine/manifest, nav properties, and heading shape of
// the first content doc — so we can see WHY extraction misbehaves. USAGE: node tools/epub-inspect.mjs <file>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { unzipSync } from 'fflate';

function dec(bytes) {
	if (!bytes) return null;
	try {
		return new TextDecoder('utf-8').decode(bytes);
	} catch {
		return null;
	}
}
const f = process.argv[2];
console.log('FILE:', basename(f));
const bytes = new Uint8Array(readFileSync(f));
// LIST ALL ENTRIES (names only) — DON'T FILTER, SO WE SEE EVERYTHING
const all = unzipSync(bytes);
const names = Object.keys(all);
console.log('total entries:', names.length);
console.log('entry names:');
for (const n of names.slice(0, 60)) console.log('   ', n, `(${all[n].length}b)`);
if (names.length > 60) console.log('    ...', names.length - 60, 'more');

const container = dec(all['META-INF/container.xml']);
console.log('\n--- META-INF/container.xml ---');
console.log(container ? container.slice(0, 600) : '(MISSING)');

const opfName = names.find((n) => /\.opf$/i.test(n));
console.log('\nopf entry found by extension:', opfName);
const opf = dec(all[opfName]);
if (opf) {
	console.log('\n--- OPF <spine> ---');
	const spine = /<spine[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? '(no spine)';
	console.log(spine.slice(0, 800));
	console.log('\n--- OPF manifest items (id -> href [properties]) ---');
	let count = 0;
	for (const m of opf.matchAll(/<item\s+([^>]+?)\/?>/gi)) {
		const a = m[1];
		const id = /\bid="([^"]+)"/i.exec(a)?.[1];
		const href = /\bhref="([^"]+)"/i.exec(a)?.[1];
		const props = /\bproperties="([^"]+)"/i.exec(a)?.[1];
		const media = /\bmedia-type="([^"]+)"/i.exec(a)?.[1];
		if ((href && /x?html?$/i.test(href.split('#')[0])) || props) {
			console.log(`   ${id} -> ${href} ${props ? '[' + props + ']' : ''} ${media ?? ''}`);
			if (++count > 40) {
				console.log('   ...');
				break;
			}
		}
	}
	// FIRST CONTENT DOC HEADING SHAPE
	const firstHref = /<itemref\s+[^>]*idref="([^"]+)"/i.exec(opf)?.[1];
	const manifest = new Map();
	for (const m of opf.matchAll(/<item\s+([^>]+?)\/?>/gi)) {
		const a = m[1];
		const id = /\bid="([^"]+)"/i.exec(a)?.[1];
		const href = /\bhref="([^"]+)"/i.exec(a)?.[1];
		if (id && href) manifest.set(id, href);
	}
	const opfDir = opfName.includes('/') ? opfName.slice(0, opfName.lastIndexOf('/') + 1) : '';
	const resolve = (rel) => {
		const parts = (opfDir + rel.split('#')[0]).split('/');
		const out = [];
		for (const p of parts) {
			if (p === '' || p === '.') continue;
			if (p === '..') out.pop();
			else out.push(p);
		}
		return out.join('/');
	};
	const firstDoc = dec(all[resolve(manifest.get(firstHref) ?? '')]);
	if (firstDoc) {
		console.log('\n--- first spine doc: heading tags present ---');
		const hs = [...firstDoc.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 30);
		console.log('   heading count (h1-h6):', [...firstDoc.matchAll(/<h[1-6][^>]*>/gi)].length);
		for (const h of hs.slice(0, 20))
			console.log(
				`     <${h[1]}> ${h[2]
					.replace(/<[^>]+>/g, '')
					.trim()
					.slice(0, 60)}`,
			);
		// ALSO: count "Chapter N" textual markers
		const text = firstDoc.replace(/<[^>]+>/g, ' ');
		const chapMatches = [...text.matchAll(/\bChapter\s+\d+\b/gi)].length;
		console.log('   "Chapter N" textual occurrences:', chapMatches);
		console.log('   doc length (chars):', firstDoc.length);
	}
}
console.log('[done]');
