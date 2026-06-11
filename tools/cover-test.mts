// QUICK ITERATIVE TEST FOR extractCover AGAINST REAL BOOK-INDEX PAGES.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractCover } from '../src/lib/server/site-parser';
import { decodeTextBytes } from '../src/lib/server/charset';

const execFileAsync = promisify(execFile);
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHtml(url: string): Promise<string> {
	const { stdout } = await execFileAsync('curl', ['-sL', '-m', '25', '--compressed', '-A', UA, url], {
		maxBuffer: 64 * 1024 * 1024,
		encoding: 'buffer',
	});
	return decodeTextBytes(new Uint8Array(stdout as unknown as Buffer), true);
}

const sites: [string, string][] = [
	['uukanshu', 'https://www.uukanshu.cc/book/26445/'],
	['piaotia', 'https://www.piaotia.com/bookinfo/12/12507.html'],
	['shuhaige', 'https://www.shuhaige.net/441453/'],
	['biquguo', 'https://www.biquguo.com/45/45492/'],
	['jjwxc', 'https://www.jjwxc.net/onebook.php?novelid=6287584'],
];

for (const [name, url] of sites) {
	try {
		const html = await fetchHtml(url);
		console.log(`${name.padEnd(10)} → ${extractCover(html, url) ?? '(none)'}`);
	} catch (e) {
		console.log(`${name.padEnd(10)} ERR ${e instanceof Error ? e.message : e}`);
	}
}
