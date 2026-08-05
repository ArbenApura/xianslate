// BUILD THE CAPACITOR STATIC SPA: SETS CAPACITOR_BUILD (→ adapter-static in vite.config.ts) AND EXPOSES
// THE PUBLIC_* VARS TO THE BUILD (adapter-static's generateEnvModule INLINES THEM — INCLUDING
// PUBLIC_API_BASE — INTO THE BUNDLE AT BUILD TIME). OUTPUT → build-capacitor/ (cap sync COPIES IT INTO THE
// ANDROID/iOS PROJECTS). CROSS-PLATFORM (no bash-only `VAR=x` prefix — works on Windows cmd/powershell too).
//
// ENV PRECEDENCE: SHELL > .env.capacitor > .env. PUBLIC_API_BASE LIVES IN .env.capacitor (GITIGNORED VIA
// `.env.*`) SO THE WEB BUILD / `vite dev` NEVER SEE IT — IT MUST NOT BE IN .env, OR LOCAL WEB DEV WOULD
// START CALLING THE LIVE API CROSS-ORIGIN INSTEAD OF SAME-ORIGIN.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const env = { ...process.env, CAPACITOR_BUILD: '1' };

// PARSE A .env-STYLE FILE INTO A MAP OF PUBLIC_ VARS ONLY (API KEYS, DB URLS, THE SERVICE ACCOUNT — THE
// NON-PUBLIC_ REST — MUST NEVER REACH THE CLIENT BUNDLE; THE STATIC SPA HAS NO SERVER TO HOLD THEM).
function loadPublicEnv(file) {
	const out = {};
	if (!existsSync(file)) return out;
	for (const raw of readFileSync(file, 'utf8').split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		if (!key.startsWith('PUBLIC_')) continue;
		out[key] = line
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, '');
	}
	return out;
}

// SHELL ENV WINS OVER FILES; .env.capacitor WINS OVER .env (MOBILE-SPECIFIC OVERRIDES, E.G. PUBLIC_API_BASE).
for (const [key, value] of Object.entries(loadPublicEnv('.env'))) {
	if (env[key] === undefined) env[key] = value;
}
for (const [key, value] of Object.entries(loadPublicEnv('.env.capacitor'))) {
	if (env[key] === undefined) env[key] = value;
}

const result = spawnSync('yarn', ['vite', 'build'], {
	stdio: 'inherit',
	env,
	shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
