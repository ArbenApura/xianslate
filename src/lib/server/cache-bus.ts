// IMPORTED MODULES
import { invalidateAllLocal, invalidateBookLocal } from './glossary-match';
import { INVALIDATION_CHANNEL, hasRedis, redisSubscriber } from './redis';
import { invalidateAdapterLocal } from './site-adapter';

// -- STATES -- //

let wired = false;

// -- FUNCTIONS -- //

// SUBSCRIBE THIS INSTANCE TO CROSS-INSTANCE CACHE INVALIDATIONS SO A GLOSSARY EDIT (OR A SITE-ADAPTER
// RE-LEARN) ON ANY INSTANCE DROPS THE STALE LOCAL CACHE ON ALL OTHERS. THE PUBLISHING INSTANCE ALREADY
// CLEARED ITS OWN CACHE LOCALLY, SO RE-PROCESSING ITS OWN MESSAGE IS A HARMLESS NO-OP. NO-OP WITHOUT REDIS.
export function startCacheBus(): void {
	if (!hasRedis() || wired) return;
	wired = true;
	const sub = redisSubscriber();
	sub.subscribe(INVALIDATION_CHANNEL).catch((e) => console.error('[cache-bus] subscribe failed:', e));
	sub.on('message', (channel: string, payload: string) => {
		if (channel !== INVALIDATION_CHANNEL) return;
		try {
			const msg = JSON.parse(payload) as { kind: string; bookId?: string; host?: string };
			if (msg.kind === 'glossary-book' && msg.bookId) invalidateBookLocal(msg.bookId);
			else if (msg.kind === 'glossary-all') invalidateAllLocal();
			else if (msg.kind === 'site-adapter' && msg.host) invalidateAdapterLocal(msg.host);
		} catch {
			// IGNORE A MALFORMED MESSAGE
		}
	});
}
