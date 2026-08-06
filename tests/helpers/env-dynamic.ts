// A TEST DOUBLE FOR `$env/dynamic/private`. IN VITEST THE SVELTEKIT PLUGIN DOES NOT WIRE THE VIRTUAL
// MODULE (IT RESOLVES TO A LITERAL {}), SO SERVER MODULES READING ENV (spend-guard, deepseek, site-stats)
// WOULD ALWAYS SEE DEFAULTS. THIS MODULE READS process.env LIVE, WHICH MAKES vi.stubEnv WORK IN TESTS.
// WIRED VIA resolve.alias IN vitest.config.ts.
export const env = process.env;
