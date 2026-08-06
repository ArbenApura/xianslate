import { readdirSync, statSync, existsSync } from 'node:fs';

for (const fam of ['lxgw-wenkai-tc', 'noto-serif-tc', 'noto-sans-tc', 'inter', 'literata', 'lora', 'opendyslexic']) {
  const dir = `node_modules/@fontsource/${fam}/files`;
  if (!existsSync(dir)) { console.log(fam, ': NO FILES DIR'); continue; }
  const files = readdirSync(dir);
  const subsets = [...new Set(
    files
      .map((f) => {
        const m = f.match(/^[a-z0-9-]+?-(chinese-simplified|chinese-traditional|japanese|korean|latin|latin-ext|greek|cyrillic|vietnamese|math|symbols|lisu|japanese)-400-normal\.(woff2|woff)$/);
        return m ? m[1] : null;
      })
      .filter(Boolean),
  )];
  const woff2 = files.filter((f) => f.endsWith('.woff2')).length;
  const woff = files.filter((f) => f.endsWith('.woff')).length;
  const size = files.reduce((s, f) => s + statSync(`${dir}/${f}`).size, 0);
  console.log(fam, '| files:', files.length, `(woff2:${woff2} woff:${woff})`, '| total:', (size / 1e6).toFixed(2) + 'MB');
  console.log('  subsets found:', subsets.join(', '));
  // SHOW A SAMPLE OF THE WANTED SUBSETS' EXACT FILE NAMES
  for (const want of ['chinese-simplified', 'chinese-traditional', 'japanese', 'korean', 'latin']) {
    const hit = files.find((f) => f.includes(want) && f.endsWith('.woff2') && f.includes('-400-'));
    if (hit) console.log('   sample:', hit);
  }
}
