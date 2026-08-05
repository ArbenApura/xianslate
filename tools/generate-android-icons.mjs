// REGENERATE THE ANDROID LAUNCHER ICON (AND THE assets/ SOURCES) FROM static/logo.svg.
//
// WHY NOT @capacitor/assets: ITS DEFAULT ICON COMPOSITION FILLS THE ADAPTIVE-ICON FOREGROUND LAYER WITH THE
// SOURCE IMAGE, SO THE LAUNCHER MASK (CIRCLE / SQUIRCLE / ROUNDED SQUARE) CROPS THE SEAL — "OVERFLOW/CUT".
//
// THIS SCRIPT COMPOSES THE ICON EXPLICITLY:
//   - LEGACY (PRE-8) + ROUND ICONS: SEAL AT 80% ON THE WARM PAPER BACKGROUND (#f4ecd8 — THE APP'S THEME BG).
//   - ADAPTIVE FOREGROUND: SEAL AT 52% ON A TRANSPARENT CANVAS — WELL INSIDE THE 66dp SAFE ZONE, SO NO
//     LAUNCHER MASK CROPS IT (52% OF 108dp = 56dp < 66dp).
//   - ADAPTIVE BACKGROUND: SOLID PAPER, FULL-BLEED.
// THE anydpi-v26 XMLs ARE REWRITTEN WITHOUT INSETS (FULL-BLEED LAYERS — THE PADDING IS IN THE PNGs).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// -- CONSTANTS -- //

// THE APP'S LIGHT THEME BACKGROUND ("WARM INK ON PAPER") — SEE THEME_BG IN src/lib/stores/settings.ts.
const PAPER = { r: 244, g: 236, b: 216, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// LEGACY ICON SIZES PER DENSITY (48 = mdpi … 192 = xxxhdpi); ADAPTIVE LAYERS ARE 108dp PER DENSITY.
const LEGACY_SIZES = [48, 72, 96, 144, 192];
const ADAPTIVE_SIZES = [108, 162, 216, 324, 432];
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

const RES = join(root, 'android/app/src/main/res');
const ASSETS = join(root, 'assets');

// -- HELPERS -- //

// THE SEAL AT `pct` OF A `canvas`-PIXEL SQUARE, CENTERED (THE SVG HAS ITS OWN ROUNDED CORNERS + ALPHA).
async function sealAt(pct, canvas) {
	const px = Math.round(canvas * pct);
	return sharp(join(root, 'static/logo.svg'), { density: 600 })
		.resize(px, px, { fit: 'contain', background: TRANSPARENT })
		.png()
		.toBuffer();
}

async function compose(canvas, sealPct, background) {
	const img = sharp({ create: { width: canvas, height: canvas, channels: 4, background } });
	if (sealPct > 0) {
		const seal = await sealAt(sealPct, canvas);
		return img.composite([{ input: seal, gravity: 'center' }]).png().toBuffer();
	}
	return img.png().toBuffer();
}

function write(path, buffer) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buffer);
}

// -- BUILD -- //

const densityForSize = (sizes, size) => sizes.indexOf(size);

async function main() {
	// 1. SOURCE ASSETS (FOR FUTURE RE-RUNS / OTHER USES) — 1024px.
	write(join(ASSETS, 'icon.png'), await compose(1024, 0.8, PAPER));
	write(join(ASSETS, 'icon-foreground.png'), await compose(1024, 0.52, TRANSPARENT));
	write(join(ASSETS, 'icon-background.png'), await compose(1024, 0, PAPER)); // SOLID — NO SEAL

	// 2. LEGACY + ROUND LAUNCHER ICONS.
	for (const size of LEGACY_SIZES) {
		const d = DENSITIES[densityForSize(LEGACY_SIZES, size)];
		const png = await compose(size, 0.8, PAPER);
		write(join(RES, `mipmap-${d}/ic_launcher.png`), png);
		write(join(RES, `mipmap-${d}/ic_launcher_round.png`), png);
	}

	// 3. ADAPTIVE LAYERS.
	for (const size of ADAPTIVE_SIZES) {
		const d = DENSITIES[densityForSize(ADAPTIVE_SIZES, size)];
		write(join(RES, `mipmap-${d}/ic_launcher_foreground.png`), await compose(size, 0.52, TRANSPARENT));
		write(join(RES, `mipmap-${d}/ic_launcher_background.png`), await compose(size, 0, PAPER));
	}

	// 4. ADAPTIVE DEFINITIONS — FULL-BLEED LAYERS (NO INSET; THE SAFE-ZONE PADDING IS IN THE PNGs).
	const adaptive = (name) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
	write(join(RES, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive('ic_launcher'));
	write(join(RES, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive('ic_launcher_round'));

	console.log('Android launcher icons regenerated (legacy 80% seal on paper, adaptive 52% seal, no insets).');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
