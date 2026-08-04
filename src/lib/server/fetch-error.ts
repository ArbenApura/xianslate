// A TYPED FAILURE FOR THE WEB-CHAPTER PIPELINE (TRANSPORT + AI PARSING). EVERY THROW CARRIES A `kind`
// SO THE API LAYER CAN PICK THE RIGHT HTTP STATUS AND A SPECIFIC, HUMAN MESSAGE — THE READER SHOULD
// SEE "THIS SITE BLOCKS AUTOMATED ACCESS", NOT A BARE 502. LIVES IN ITS OWN MODULE BECAUSE BOTH
// fetcher.ts (TRANSPORT) AND site-adapter.ts (PARSING) THROW IT, AND THEY IMPORT EACH OTHER.

// -- TYPES -- //

export type FetchErrorKind =
	| 'invalid_url' // MALFORMED URL OR A NON-http(s) SCHEME
	| 'blocked_private' // SSRF GUARD: LOOPBACK / PRIVATE / LINK-LOCAL / METADATA TARGET
	| 'unresolvable' // DNS DID NOT RESOLVE THE HOST
	| 'blocked_bot' // 403/503 EVEN AFTER THE curl FALLBACK (CLOUDFLARE / JS CHALLENGE)
	| 'not_found' // 404
	| 'http_error' // ANY OTHER NON-OK HTTP STATUS
	| 'network' // CONNECTION RESET / TIMEOUT / DNS FLAKE AT FETCH TIME
	| 'no_api_key' // A NEW HOST NEEDS AI MAPPING BUT DEEPSEEK_API_KEY IS NOT CONFIGURED
	| 'unsupported_site' // AI COULD NOT MAP THIS PAGE (e.g. JS-RENDERED — NO CONTENT IN THE HTML)
	| 'parse_failed' // STORED SELECTORS WENT STALE AND A RE-LEARN STILL COULD NOT EXTRACT A CHAPTER
	| 'too_large'; // THE UPSTREAM RESPONSE BODY EXCEEDED OUR SIZE CEILING (OOM GUARD)

// -- CONSTANTS -- //

const STATUS: Record<FetchErrorKind, number> = {
	invalid_url: 400,
	blocked_private: 400,
	unresolvable: 400,
	blocked_bot: 502,
	not_found: 404,
	http_error: 502,
	network: 502,
	no_api_key: 503,
	unsupported_site: 422,
	parse_failed: 422,
	too_large: 502,
};

// -- FUNCTIONS -- //

export class FetchError extends Error {
	readonly kind: FetchErrorKind;
	readonly status: number;
	readonly host?: string;

	constructor(kind: FetchErrorKind, message: string, host?: string) {
		super(message);
		this.name = 'FetchError';
		this.kind = kind;
		this.status = STATUS[kind];
		this.host = host;
	}
}

export function isFetchError(e: unknown): e is FetchError {
	return e instanceof FetchError;
}
