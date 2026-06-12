// CHECK THE HEADING SHAPE OF EVERY SPINE/CONTENT DOC IN AN EPUB, SO WE CAN TELL WHETHER A DOC THAT STAYED
// ONE CHAPTER GENUINELY HAS NO CHAPTER HEADINGS (CORRECT) OR WE'RE MISSING A DIFFERENT DELIMITER.
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
const f = process.argv[2];
const all = unzipSync(new Uint8Array(readFileSync(f)));
const dec = (b) => (b ? new TextDecoder('utf-8').decode(b) : null);
for (const name of Object.keys(all).filter((n) => /\.x?html?$/i.test(n))) {
	const html = dec(all[name]);
	if (!html) continue;
	const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
	const textLen = body
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim().length;
	const hCounts = {};
	for (const m of body.matchAll(/<(h[1-6])\b/gi))
		hCounts[m[1].toLowerCase()] = (hCounts[m[1].toLowerCase()] ?? 0) + 1;
	// OTHER POSSIBLE CHAPTER DELIMITERS
	const sections = [...body.matchAll(/<section\b/gi)].length;
	const pageBreaks = [...body.matchAll(/page-break|class="[^"]*chapter/gi)].length;
	const chapterWords = [...body.replace(/<[^>]+>/g, ' ').matchAll(/\bCHAPTER\s+[IVXLC0-9]+\b/gi)].length;
	console.log(
		`${name}  text=${textLen}  h=${JSON.stringify(hCounts)} section=${sections} chapWordOccur=${chapterWords} pbHints=${pageBreaks}`,
	);
	// SHOW FIRST FEW HEADINGS IF ANY
	const heads = [...body.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 8);
	for (const h of heads)
		console.log(
			`      <${h[1]}> ${h[2]
				.replace(/<[^>]+>/g, '')
				.trim()
				.slice(0, 60)}`,
		);
}
