// REGENERATE THE ANDROID LAUNCHER ICON (AND THE assets/ SOURCES) FROM static/logo-android.svg.
//
// DESIGN: FULL-BLEED RED + BORDERLESS GLYPH.
//   - THE CANVAS IS SOLID CINNABAR RED (#b23a2e) EDGE-TO-EDGE, SO ANDROID'S LAUNCHER MASK (CIRCLE ON
//     PIXEL, SQUIRCLE / ROUNDED SQUARE ELSEWHERE) ONLY CROPS RED — THE ICON READS AS A RED CIRCLE, NO
//     SHAPE EDGES, NOTHING "CUT" OR SQUARISH.
//   - THE SEAL IS THE BRAND MARK WITHOUT ITS CARVED INNER FRAME (static/logo-android.svg) — THE FRAME
//     READ AS A "ROUNDED SQUARE BORDER" ON THE LAUNCHER ICON AND WAS REMOVED FROM THIS VARIANT ONLY.
//     THE SEAL IS SCALED TO 72% AND CENTERED — PADDED SO THE 仙 GLYPH HAS CLEAR EDGE SPACE (DOWN FROM
//     88% → 80%, TWO ROUNDS OF USER REQUESTED PADDING). MEASURED ON THE OUTPUT: GLYPH INK MARGINS ARE
//     ~27-31% OF THE CANVAS ON EVERY SIDE, AND ITS FURTHEST INK PIXEL IS 27.1dp (25.1% OF THE 108dp
//     CANVAS SIDE) FROM CENTER — INSIDE THE 66dp SAFE-ZONE GUIDELINE (RADIUS 33dp), INSIDE PIXEL'S
//     CIRCLE MASK (RADIUS 36dp), AND WELL INSIDE THE LEGACY CIRCLE MASK (RADIUS 54dp = 50%). (THE SEAL'S
//     RED SQUARE BLENDS INTO THE RED CANVAS — THE VISIBLE RESULT IS A BORDERLESS CREAM 仙 ON RED.)
//   - FONT NOTE: THE GLYPH IS <text> RASTERIZED BY SHARP AT REGEN TIME, SO THE 仙 SHAPE DEPENDS ON THE
//     MACHINE HAVING A CJK FONT (LXGW WenKai TC / Noto Serif TC / Songti SC / SimSun, IN THAT ORDER).
//
// LAYERS:
//   - LEGACY (PRE-8) + ROUND ICONS: THE SAME COMPOSITION (RED CANVAS + 72% SEAL) — FULL-BLEED, NO
//     ROUNDED CORNERS NEEDED.
//   - ADAPTIVE FOREGROUND: RED CANVAS + 72% SEAL.
//   - ADAPTIVE BACKGROUND: SOLID #b23a2e, FULL-BLEED (NO GAPS AT MASK EDGES).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = join(root, 'static/logo-android.svg');

// -- CONSTANTS -- //

// CINNABAR RED — THE SEAL'S FILL (static/logo-android.svg), NOW THE FULL ICON BACKGROUND.
const RED = { r: 178, g: 58, b: 46, alpha: 1 };

// THE SEAL'S SCALE INSIDE THE CANVAS — THE "PADDING" THAT KEEPS THE WHOLE CHARACTER VISIBLE UNDER THE
// CIRCULAR MASK. 72% (DOWN FROM 80% → 88%) ADDS EVEN MORE EDGE SPACE AROUND THE GLYPH — "MORE PADDING"
// PER USER REQUEST (SEE THE DESIGN COMMENT ABOVE FOR THE MEASURED MARGINS).
const SEAL_SCALE = 0.72;

// LEGACY ICON SIZES PER DENSITY (48 = mdpi … 192 = xxxhdpi); ADAPTIVE LAYERS ARE 108dp PER DENSITY.
const LEGACY_SIZES = [48, 72, 96, 144, 192];
const ADAPTIVE_SIZES = [108, 162, 216, 324, 432];
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

const RES = join(root, 'android/app/src/main/res');
const ASSETS = join(root, 'assets');

// -- BUILD -- //

// THE RED CANVAS WITH THE SEAL AT SEAL_SCALE CENTERED (THE SVG'S ROUNDED CORNERS + THE CANVAS ARE THE
// SAME RED, SO THERE IS NO VISIBLE SEAM — JUST A PADDED SEAL ON RED).
async function paddedSeal(canvas) {
	const px = Math.round(canvas * SEAL_SCALE);
	const seal = await sharp(svg, { density: 600 })
		.resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
	write(join(ASSETS, 'icon.png'), await paddedSeal(1024));
	write(join(ASSETS, 'icon-foreground.png'), await paddedSeal(1024));
	write(join(ASSETS, 'icon-background.png'), await solid(1024));

	// 2. LEGACY + ROUND LAUNCHER ICONS (FULL-BLEED RED, PADDED SEAL).
	for (const size of LEGACY_SIZES) {
		const d = DENSITIES[densityForSize(LEGACY_SIZES, size)];
		const png = await paddedSeal(size);
		write(join(RES, `mipmap-${d}/ic_launcher.png`), png);
		write(join(RES, `mipmap-${d}/ic_launcher_round.png`), png);
	}

	// 3. ADAPTIVE LAYERS.
	for (const size of ADAPTIVE_SIZES) {
		const d = DENSITIES[densityForSize(ADAPTIVE_SIZES, size)];
		write(join(RES, `mipmap-${d}/ic_launcher_foreground.png`), await paddedSeal(size));
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

	console.log('Android launcher icons regenerated: borderless glyph (72%) on full-bleed cinnabar red.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
