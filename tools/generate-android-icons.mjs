// REGENERATE THE ANDROID LAUNCHER ICON (AND THE assets/ SOURCES) FROM static/logo.svg.
//
// DESIGN: FULL-BLEED — THE SEAL'S RED SQUARE IS SCALED TO COVER THE ENTIRE CANVAS, SO ANDROID'S LAUNCHER
// MASK (CIRCLE ON PIXEL, SQUIRCLE / ROUNDED SQUARE ELSEWHERE) SIMPLY CROPS RED, AND THE ICON READS AS A
// RED CIRCLE WITH THE CARVED 仙 CHARACTER — NO VISIBLE SHAPE EDGES, NOTHING "CUT" OR SQUARISH.
//
// LAYERS (ALL STANDARD MASKS COVER IT):
//   - FULL-RED BASE: THE SVG'S ROUNDED-CORNER RED RECT IS DRAWN OVER A SOLID #b23a2e CANVAS, SO THE
//     CORNER CUTOUTS BLEND INVISIBLY — THE ICON IS RED EDGE-TO-EDGE.
//   - CARVED FRAME + 仙: SCALED PROPORTIONALLY (FRAME AT ~11% INSET, GLYPH CENTERED AT 50%) — WELL INSIDE
//     THE 66dp MASK SAFE ZONE, SO NEITHER THE CIRCLE NOR THE CORNER-CUT MASKS TOUCH THEM.
//   - ADAPTIVE BACKGROUND: SOLID #b23a2e, FULL-BLEED (NO GAPS AT MASK EDGES).
// LEGACY (PRE-8) + ROUND ICONS USE THE SAME FULL-BLEED COMPOSITION (A RED SQUARE IS FINE — NO ROUNDED
// CORNERS NEEDED WHEN THE ART ITSELF IS FULL-BLEED).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = join(root, 'static/logo.svg');

// -- CONSTANTS -- //

// CINNABAR RED — THE SEAL'S FILL (static/logo.svg), NOW THE FULL ICON BACKGROUND.
const RED = { r: 178, g: 58, b: 46, alpha: 1 };

// LEGACY ICON SIZES PER DENSITY (48 = mdpi … 192 = xxxhdpi); ADAPTIVE LAYERS ARE 108dp PER DENSITY.
const LEGACY_SIZES = [48, 72, 96, 144, 192];
const ADAPTIVE_SIZES = [108, 162, 216, 324, 432];
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

const RES = join(root, 'android/app/src/main/res');
const ASSETS = join(root, 'assets');

// -- BUILD -- //

// THE SVG (RED ROUNDED RECT + FRAME + 仙) SCALED TO COVER A `canvas`-PIXEL SQUARE, COMPOSITED OVER A
// SOLID RED CANVAS SO THE ROUNDED-CORNER CUTOUTS ARE INVISIBLY FILLED — THE RESULT IS RED EDGE-TO-EDGE
// WITH THE CARVED MARKS CENTERED.
async function fullBleed(canvas) {
	const seal = await sharp(svg, { density: 600 })
		.resize(canvas, canvas, { fit: 'cover' })
		.png()
		.toBuffer();
	return sharp({ create: { width: canvas, height: canvas, channels: 4, background: RED } })
		.composite([{ input: seal, gravity: 'center' }])
		.png()
		.toBuffer();
}

function solid(canvas) {
	return sharp({ create: { width: canvas, height: canvas, channels: 4, background: RED } })
		.png()
		.toBuffer();
}

function write(path, buffer) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buffer);
}

const densityForSize = (sizes, size) => sizes.indexOf(size);

async function main() {
	// 1. SOURCE ASSETS (FOR FUTURE RE-RUNS / OTHER USES) — 1024px.
	write(join(ASSETS, 'icon.png'), await fullBleed(1024));
	write(join(ASSETS, 'icon-foreground.png'), await fullBleed(1024));
	write(join(ASSETS, 'icon-background.png'), await solid(1024));

	// 2. LEGACY + ROUND LAUNCHER ICONS (FULL-BLEED — NO SHAPE EDGES).
	for (const size of LEGACY_SIZES) {
		const d = DENSITIES[densityForSize(LEGACY_SIZES, size)];
		const png = await fullBleed(size);
		write(join(RES, `mipmap-${d}/ic_launcher.png`), png);
		write(join(RES, `mipmap-${d}/ic_launcher_round.png`), png);
	}

	// 3. ADAPTIVE LAYERS.
	for (const size of ADAPTIVE_SIZES) {
		const d = DENSITIES[densityForSize(ADAPTIVE_SIZES, size)];
		write(join(RES, `mipmap-${d}/ic_launcher_foreground.png`), await fullBleed(size));
		write(join(RES, `mipmap-${d}/ic_launcher_background.png`), await solid(size));
	}

	// 4. ADAPTIVE DEFINITIONS — FULL-BLEED LAYERS (NO INSET; THE ART ITSELF IS FULL-BLEED).
	const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
	write(join(RES, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive);
	write(join(RES, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive);

	console.log('Android launcher icons regenerated: full-bleed cinnabar seal (no shape edges).');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
